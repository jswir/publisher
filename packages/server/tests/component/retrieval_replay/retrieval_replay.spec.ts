// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The retrieval replay: a fixed corpus of get_context calls (cases.ts) over
 * committed synthetic packages and a frozen copy of the bundled `storefront`
 * example, each compared, whole, with a committed snapshot under
 * `tests/goldens/retrieval_replay/`. A change to the engine that changes what
 * any caller receives, how many calls it makes to the embedding provider or
 * the judge, or what the judge is asked, changes a snapshot, so a pull
 * request shows exactly which.
 *
 * What runs is the production path below the MCP transport: the get_context
 * tool's handler (registerGetContextTool) behind its input schema and its
 * instrumentation, the RetrievalService, the real index build into a real
 * DuckDB catalog, and each package loaded with Package.create. Only the two
 * providers are stood in for, offline and deterministic (stand_ins.ts): the
 * embedding endpoint and the chat model, called with the production default
 * concurrency.
 *
 * Re-record after an INTENDED change, then read the diff in review:
 *
 *    cd packages/server
 *    UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay
 *
 * Re-recording refuses to run in CI, and writes nothing unless every case
 * ran (so never with a test-name filter).
 * docs/retrieval-replay.md has the rest.
 */

import {
   afterAll,
   beforeAll,
   describe,
   expect,
   it,
   setDefaultTimeout,
} from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod/v3";
import type { RequestExtra } from "../../../src/mcp/request_extra";
import { registerGetContextTool } from "../../../src/mcp/tools/get_context_tool";
import { DEFAULT_LLM_CONCURRENCY } from "../../../src/retrieval/defaults";
import { fcjStateOf } from "../../../src/retrieval/index/engine_state";
import {
   _clearEmbeddingProviderForTests,
   _setEmbeddingProviderForTests,
} from "../../../src/retrieval/llm/embedding_provider";
import { RetrievalRegistry } from "../../../src/retrieval/registry";
import { RetrievalService } from "../../../src/retrieval/service";
import type { EnvironmentCatalog } from "../../../src/service/environment_ports";
import { DuckDBConnection } from "../../../src/storage/duckdb/DuckDBConnection";
import {
   createCatalogTables,
   createSourceSummariesTable,
} from "../../../src/storage/duckdb/schema";
import { pollFor } from "../../../src/test_helpers/poll";
import {
   loadPackageCopy,
   type LoadedTempPackage,
} from "../../../src/test_helpers/temp_package";
import { lineDiff } from "../materialization_goldens/golden_files";
import {
   CASES,
   ENVIRONMENT,
   LISTED_ONLY,
   PACKAGES,
   type ReplayCase,
} from "./cases";
import {
   replayChat,
   replayEmbeddingProvider,
   sha256,
   Traffic,
   type ChatCall,
} from "./stand_ins";

setDefaultTimeout(200_000);

const FIXTURES = path.resolve(__dirname, "../../fixtures");
const SNAPSHOTS = path.resolve(__dirname, "../../goldens/retrieval_replay");
/** The judge's system prompts, one file each, named by their hash. */
const SYSTEMS_DIR = "judge_system_prompts";
const UPDATING = process.env.UPDATE_GOLDENS === "1";
/** Every CI provider this repo runs on sets CI; GitHub Actions sets it to "true". */
const IN_CI = Boolean(process.env.CI) && process.env.CI !== "false";
/**
 * A re-record's snapshots, by file, written only once every case ran: a run
 * narrowed with `-t` writes nothing (see afterAll).
 */
const pending = new Map<string, string>();
const RERECORD =
   "cd packages/server && UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay";

/** Snapshots that are not a case's: each package's index build, and the texts it embedded and the prompts it sent. */
const BUILD_SNAPSHOT = "_index_build.json";
const inputsSnapshot = (pkg: string) => `_index_inputs.${pkg}.json`;

/** Text as stored: LF line endings and one trailing newline. */
function canonical(text: string): string {
   return `${text.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`;
}

/** `value` with every key named `ms` (a timing) removed, at any depth. */
function withoutTimings(value: unknown): unknown {
   if (Array.isArray(value)) return value.map(withoutTimings);
   if (value && typeof value === "object") {
      return Object.fromEntries(
         Object.entries(value)
            .filter(([k]) => k !== "ms")
            .map(([k, v]) => [k, withoutTimings(v)]),
      );
   }
   return value;
}

/** Compare `text` with snapshot `file`, or write it when re-recording. */
function expectText(file: string, text: string): void {
   const target = path.join(SNAPSHOTS, file);
   const actual = canonical(text);
   if (UPDATING) {
      pending.set(file, actual);
      return;
   }
   if (!fs.existsSync(target)) {
      throw new Error(`snapshot ${file} is missing. Record it: ${RERECORD}`);
   }
   const expected = canonical(fs.readFileSync(target, "utf8"));
   if (expected !== actual) {
      throw new Error(
         `snapshot ${file} differs from this run.\n${lineDiff(expected, actual)}\n` +
            `If the change is intended, re-record and commit the snapshots, ` +
            `saying why in the pull request: ${RERECORD}`,
      );
   }
}

function expectSnapshot(file: string, actual: unknown): void {
   expectText(file, JSON.stringify(actual, null, 2));
}

/** A judge system prompt's file, by the first 16 hex digits of its hash. */
function systemFile(sha: string): string {
   return `${SYSTEMS_DIR}/${sha.slice(0, 16)}.txt`;
}

type ToolHandler = (
   params: unknown,
   extra: RequestExtra,
) => Promise<{ content: unknown[]; isError?: boolean }>;

const traffic = new Traffic();
const loaded = new Map<string, LoadedTempPackage>();
let db: DuckDBConnection | undefined;
let dbDir = "";
let registry: RetrievalRegistry;
let handler: ToolHandler;
let inputSchema: z.ZodObject<z.ZodRawShape>;
/** Each package's index build, taken in beforeAll and compared in its own test. */
const builds: Record<string, unknown> = {};
const buildInputs: Record<string, unknown> = {};
/** Names of the cases this process recorded, and whether the build was: a re-record writes only a whole run. */
const ran = new Set<string>();
let builtChecked = false;

/** The embedding provider for a package: none for a lexical one. */
function useEmbeddingsFor(pkg: string | undefined): void {
   if (pkg && PACKAGES[pkg]?.lexical) _clearEmbeddingProviderForTests();
   else _setEmbeddingProviderForTests(replayEmbeddingProvider(traffic));
}

/**
 * Send `params` as an MCP client would: through the tool's input schema
 * (zod validation, unknown keys stripped), then the instrumented handler,
 * with the extra a request carries.
 */
async function call(params: Record<string, unknown>) {
   const parsed = inputSchema.safeParse(params);
   if (!parsed.success) {
      return {
         parsed: undefined,
         result: {
            isError: true,
            content: [
               {
                  type: "text",
                  text: `Input validation error: ${parsed.error.message}`,
               },
            ],
         },
      };
   }
   const controller = new AbortController();
   const result = await handler(parsed.data, {
      signal: controller.signal,
      requestInfo: { headers: {} },
   });
   return { parsed: parsed.data, result };
}

function payloadOf(result: { content: unknown[] }): unknown {
   const content = result.content[0] as {
      resource?: { text: string };
      text?: string;
   };
   const text = content.resource?.text ?? content.text ?? "";
   try {
      return JSON.parse(text);
   } catch {
      return text;
   }
}

/** Fail loudly on a prompt the stand-in could not read. */
function assertStandInsRead(calls: readonly ChatCall[], during: string): void {
   const bad = calls.filter((c) => c.standInError);
   if (bad.length > 0) {
      throw new Error(
         `${during}: the stand-in chat model could not read ${bad.length} prompt(s), so the engine's answer is not a judgement of the engine. Update stand_ins.ts for the new prompt format.\n` +
            bad.map((c) => `- ${c.kind}: ${c.error}`).join("\n"),
      );
   }
}

beforeAll(async () => {
   if (UPDATING && IN_CI) {
      throw new Error(
         "UPDATE_GOLDENS=1 re-records the retrieval replay's snapshots, which " +
            "CI must never do: a snapshot is changed by a person, in a commit, " +
            "with a reason. Re-record locally and commit the diff.",
      );
   }
   for (const [name, p] of Object.entries(PACKAGES)) {
      loaded.set(
         name,
         await loadPackageCopy(path.join(FIXTURES, p.fixture), {
            name,
            environmentName: ENVIRONMENT,
            // The same docs on a Windows checkout as on any other.
            lf: true,
            ...(p.manifest ? { manifest: p.manifest } : {}),
            ...(p.files ? { files: p.files } : {}),
         }),
      );
   }
   dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-replay-"));
   db = new DuckDBConnection(path.join(dbDir, "catalog.db"));
   await db.initialize();
   await createCatalogTables(db);
   await createSourceSummariesTable(db);

   registry = new RetrievalRegistry();
   // The production default: the engine's parallel calls run in parallel,
   // and the stand-in answers them out of order.
   registry.chat.override(replayChat(traffic), {
      concurrency: DEFAULT_LLM_CONCURRENCY,
   });

   const environments: Record<string, Record<string, string | undefined>> = {
      [ENVIRONMENT]: {},
   };
   for (const [name, pkg] of loaded) {
      environments[ENVIRONMENT][name] = (
         pkg.pkg as { getPackageMetadata?: () => { description?: string } }
      ).getPackageMetadata?.()?.description;
   }
   for (const [env, listed] of Object.entries(LISTED_ONLY)) {
      environments[env] = { ...(environments[env] ?? {}), ...listed };
   }
   const environmentOf = (name: string) => ({
      getPackage: async (pkgName: string) => {
         const pkg = name === ENVIRONMENT ? loaded.get(pkgName) : undefined;
         if (pkg) return pkg.pkg;
         throw new Error(
            `retrieval replay: ${name}/${pkgName} is listed, not loaded`,
         );
      },
      listPackages: async () =>
         Object.entries(environments[name] ?? {})
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([p, description]) => ({ name: p, description })),
      getStaleCompileErrors: () => new Map(),
      getFailedPackages: () => new Map(),
      // No memory governor: every value read is admitted.
      assertCanAdmitQuery: () => undefined,
      listApiConnections: () => [],
   });
   const store = {
      getEnvironment: async (name: string) => {
         if (!(name in environments)) throw new Error(`no environment ${name}`);
         return environmentOf(name);
      },
      listEnvironments: async () =>
         Object.keys(environments).map((name) => ({ name })),
   } as unknown as EnvironmentCatalog;
   registerGetContextTool(
      {
         registerTool: (
            name: string,
            config: { inputSchema: z.ZodRawShape },
            h: ToolHandler,
         ) => {
            if (name !== "get_context") return;
            handler = h;
            inputSchema = z.object(config.inputSchema);
         },
      } as never,
      store,
      new RetrievalService(store, { getDuckDbConnection: () => db! }, registry),
   );

   // The first ranked call on a package starts its index build and answers
   // "indexing"; wait for each build to finish before the next starts, so
   // their calls never mix.
   for (const name of Object.keys(PACKAGES)) {
      traffic.reset();
      useEmbeddingsFor(name);
      const warmUp = {
         search_targets: [{ target_type: "measure", search_text: "warm up" }],
         scopes: [{ environment: ENVIRONMENT, package: name }],
      };
      const { result } = await call(warmUp);
      const pkg = loaded.get(name)!.pkg;
      const state = await pollFor(
         async () => fcjStateOf(registry, pkg),
         (s) => s?.status === "ready" || s?.status === "error",
         180_000,
      );
      assertStandInsRead(traffic.chatCalls, `the ${name} index build`);
      if (state?.status !== "ready") {
         throw new Error(
            `the ${name} index did not build: ${JSON.stringify(state)}`,
         );
      }
      const kinds: Record<string, number> = {};
      for (const c of traffic.chatCalls) {
         kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      }
      const texts = [...traffic.embeddedTexts].sort();
      const prompts = traffic.chatCalls
         .map((c) => ({
            kind: c.kind,
            sha256: sha256(`${c.system}\n\n${c.prompt}`),
            system_sha256: sha256(c.system),
            prompt: c.prompt.split("\n"),
         }))
         .sort((a, b) =>
            `${a.kind} ${a.sha256}` < `${b.kind} ${b.sha256}` ? -1 : 1,
         );
      builds[name] = {
         warm_up: {
            request: warmUp,
            response: {
               is_error: result.isError === true,
               payload: payloadOf(result),
            },
         },
         report: withoutTimings(state.index.report),
         // What publisher.json's retrieval block said at load: a key a
         // release no longer reads loads with one warning naming it.
         ...(() => {
            const warnings = (pkg.getPackageMetadata().warnings ?? [])
               .map((w) => w.message)
               .filter((m): m is string => Boolean(m?.includes(" retrieval.")));
            return warnings.length > 0
               ? { retrieval_load_warnings: warnings.sort() }
               : {};
         })(),
         traffic: {
            embedding_calls: traffic.embeddingCalls,
            embedded_texts: texts.length,
            embedded_texts_sha256: sha256(texts.join("\n")),
            chat_calls_by_kind: Object.fromEntries(
               Object.entries(kinds).sort(([a], [b]) => (a < b ? -1 : 1)),
            ),
            chat_prompts_sha256: prompts.map((p) => `${p.kind} ${p.sha256}`),
         },
      };
      const systems = Object.fromEntries(
         [
            ...new Map(
               traffic.chatCalls.map((c) => [sha256(c.system), c.system]),
            ),
         ]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([sha, text]) => [sha, text.split("\n")]),
      );
      const inputs = {
         embedded_texts: texts,
         chat_calls: prompts,
         system_prompts: systems,
      };
      // A package built from another's model under the same index settings
      // sends the same inputs: say so rather than repeat them.
      const twin = Object.entries(buildInputs).find(
         ([, other]) =>
            JSON.stringify((other as { inputs?: unknown }).inputs) ===
            JSON.stringify(inputs),
      );
      buildInputs[name] = twin
         ? {
              about: `The ${name} index build sent the same inputs as ${twin[0]}'s.`,
              same_as: twin[0],
           }
         : {
              about: `What the ${name} index build sent the stand-in providers, sorted: every text it embedded, and every chat prompt, and each distinct system prompt by its hash (the replies are the stand-in's rules of these prompts).`,
              inputs,
           };
   }
   useEmbeddingsFor(undefined);
});

afterAll(async () => {
   registry?.chat.reset();
   _clearEmbeddingProviderForTests();
   for (const pkg of loaded.values()) await pkg.cleanup();
   loaded.clear();
   await db?.close();
   if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
   if (!UPDATING) return;
   // A re-record writes only a whole run: a run narrowed with `-t` (or one
   // where a case threw) would leave the snapshots the cases share (the
   // index builds, the judge system prompts) and the clean-up of stale ones
   // to a run that did not happen.
   const missing = CASES.filter((c) => !ran.has(c.id)).map((c) => c.id);
   if (!builtChecked || missing.length > 0) {
      throw new Error(
         `UPDATE_GOLDENS=1 wrote nothing: ${missing.length} case(s) did not record (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""})${builtChecked ? "" : " and the index build did not"}. ` +
            `A re-record must run every case, with no test-name filter: ${RERECORD}`,
      );
   }
   for (const [file, text] of pending) {
      const target = path.join(SNAPSHOTS, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
   }
   // Then delete what no case records any more.
   const keep = expectedFiles();
   for (const f of snapshotFiles()) {
      if (!keep.has(f)) fs.rmSync(path.join(SNAPSHOTS, f));
   }
});

/** Every snapshot file on disk, relative to SNAPSHOTS. */
function snapshotFiles(): string[] {
   if (!fs.existsSync(SNAPSHOTS)) return [];
   const top = fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith(".json"));
   const dir = path.join(SNAPSHOTS, SYSTEMS_DIR);
   const systems = fs.existsSync(dir)
      ? fs.readdirSync(dir).map((f) => `${SYSTEMS_DIR}/${f}`)
      : [];
   return [...top, ...systems].sort();
}

/**
 * The files the committed snapshots call for: one per case, the index
 * build's, each package's inputs, and every judge system prompt a case
 * snapshot cites. Read from disk, so it is the same in any order and subset.
 */
function expectedFiles(): Set<string> {
   const out = new Set<string>([
      BUILD_SNAPSHOT,
      ...Object.keys(PACKAGES).map(inputsSnapshot),
      ...CASES.map((c) => `${c.id}.json`),
   ]);
   for (const c of CASES) {
      const file = path.join(SNAPSHOTS, `${c.id}.json`);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/"system_sha256": "([0-9a-f]{64})"/g)) {
         out.add(systemFile(m[1]));
      }
   }
   return out;
}

/** One judge call as the snapshot records it. */
function judgeRecord(c: ChatCall) {
   let reply: unknown;
   if (c.error !== undefined) {
      reply = { stand_in_threw: c.error };
   } else {
      try {
         reply = JSON.parse(c.reply) as unknown;
      } catch {
         reply = { not_json: c.reply };
      }
   }
   return {
      call: c.kind === "order" ? "order" : "pick",
      system_sha256: sha256(c.system),
      prompt_sha256: sha256(c.prompt),
      prompt: c.prompt.split("\n"),
      reply,
   };
}

/** Send one request and record what came back and what went out. */
async function step(params: Record<string, unknown>) {
   traffic.reset();
   const { parsed, result } = await call(params);
   assertStandInsRead(traffic.chatCalls, "this request");
   // Box 5's calls: one pick call per kept source, and the ordering call.
   const isJudge = (c: ChatCall) => c.kind === "judge" || c.kind === "order";
   const judge = traffic.chatCalls.filter(isJudge);
   const other = traffic.chatCalls.filter((c) => !isJudge(c));
   // Calls sent together complete in any order: record them by content.
   const judged = judge
      .map(judgeRecord)
      .sort((a, b) =>
         `${a.prompt_sha256}${JSON.stringify(a.reply)}` <
         `${b.prompt_sha256}${JSON.stringify(b.reply)}`
            ? -1
            : 1,
      );
   for (const c of judge) {
      expectText(systemFile(sha256(c.system)), c.system);
   }
   const dropped =
      parsed &&
      Object.keys(params)
         .filter((k) => !(k in (parsed as object)))
         .sort();
   return {
      request: params,
      ...(dropped && dropped.length > 0
         ? { request_keys_the_schema_dropped: dropped }
         : {}),
      response: {
         is_error: result.isError === true,
         // A judge-step error carries the stage trace, timings included,
         // whatever trace the request asked for: the timings are removed.
         payload: withoutTimings(payloadOf(result)),
      },
      traffic: {
         embedding_calls: traffic.embeddingCalls,
         embedded_texts: [...traffic.embeddedTexts].sort(),
         judge_calls: judge.length,
         judge: judged,
         ...(other.length > 0
            ? { other_chat_calls: other.map((c) => c.kind).sort() }
            : {}),
      },
   };
}

/** The package a request searches or lists, if it names one. */
function packageOf(params: Record<string, unknown>): string | undefined {
   const scopes = params.scopes as Array<{ package?: string }> | undefined;
   return scopes?.[0]?.package;
}

async function replay(c: ReplayCase) {
   // Each case starts with no held result, so it means the same alone, in
   // any order, and repeated.
   registry.heldResults.clear();
   const steps = c.steps ?? [c.params ?? {}];
   const records = [];
   try {
      for (const params of steps) {
         useEmbeddingsFor(packageOf(params));
         records.push(await step(params));
      }
   } finally {
      useEmbeddingsFor(undefined);
   }
   return c.steps
      ? { case: c.id, about: c.about, steps: records }
      : { case: c.id, about: c.about, ...records[0] };
}

describe("retrieval replay", () => {
   it("index build", () => {
      expectSnapshot(BUILD_SNAPSHOT, {
         about: "Each package's index build under the stand-in providers, with the warm-up call that started it, which answers while the build runs. Timings are removed. The texts and prompts themselves are in _index_inputs.<package>.json.",
         ...builds,
      });
      for (const [name, inputs] of Object.entries(buildInputs)) {
         expectSnapshot(inputsSnapshot(name), inputs);
      }
      builtChecked = true;
   });

   for (const c of CASES) {
      it(c.id, async () => {
         expectSnapshot(`${c.id}.json`, await replay(c));
         ran.add(c.id);
      });
   }

   it("has a snapshot for every case and no other", () => {
      expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
      for (const c of CASES) {
         expect(Boolean(c.params) !== Boolean(c.steps)).toBe(true);
      }
      if (UPDATING) return;
      const expected = expectedFiles();
      const present = snapshotFiles();
      expect(present.filter((f) => !expected.has(f))).toEqual([]);
      expect([...expected].filter((f) => !present.includes(f)).sort()).toEqual(
         [],
      );
   });
});
