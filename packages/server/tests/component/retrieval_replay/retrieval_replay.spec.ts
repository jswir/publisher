// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The retrieval replay: a fixed corpus of get_context calls (cases.ts) over a
 * copy of the bundled `storefront` example, each compared, whole, with a
 * committed snapshot under `tests/goldens/retrieval_replay/`. A change to the
 * engine that changes what any caller receives, how many calls it makes to
 * the embedding provider or the judge, or what the judge is asked, changes a
 * snapshot, so a pull request shows exactly which.
 *
 * What runs is the production path below the MCP transport: the get_context
 * tool's handler (registerGetContextTool), the RetrievalService, the real
 * index build into a real DuckDB catalog, and the package loaded with
 * Package.create. Only the two providers are stood in for, offline and
 * deterministic (stand_ins.ts): the embedding endpoint and the chat model.
 *
 * Re-record after an INTENDED change, then read the diff in review:
 *
 *    cd packages/server
 *    UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay
 *
 * Re-recording refuses to run in CI. docs/retrieval-replay.md has the rest.
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
import { registerGetContextTool } from "../../../src/mcp/tools/get_context_tool";
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
import type { Handler } from "../../../src/test_helpers/get_context_llm_harness";
import { pollFor } from "../../../src/test_helpers/poll";
import {
   loadPackageCopy,
   type LoadedTempPackage,
} from "../../../src/test_helpers/temp_package";
import { lineDiff } from "../materialization_goldens/golden_files";
import {
   CASES,
   ENVIRONMENT,
   PACKAGE,
   VALUES_PACKAGE,
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

const EXAMPLES = path.resolve(__dirname, "../../../../../examples");
const SNAPSHOTS = path.resolve(__dirname, "../../goldens/retrieval_replay");
const UPDATING = process.env.UPDATE_GOLDENS === "1";
/** Every CI provider this repo runs on sets CI; GitHub Actions sets it to "true". */
const IN_CI = Boolean(process.env.CI) && process.env.CI !== "false";
const RERECORD =
   "cd packages/server && UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay";

/** Snapshots that are not a case's: the index build and the judge's system prompts. */
const BUILD_SNAPSHOT = "_index_build.json";
const SYSTEMS_SNAPSHOT = "_system_prompts.json";

/**
 * The server's catalog of environments, as listings see it. storefront and
 * the synthetic replay-values package are loaded and searched; the other
 * names (and their descriptions) come from the bundled examples'
 * publisher.json and are only listed, so a listing has more than one
 * environment and package to list and a search with no package has more than
 * one to choose from.
 */
const LISTED: Record<string, string[]> = {
   [ENVIRONMENT]: [PACKAGE, VALUES_PACKAGE, "html-data-app"],
   governed: ["governed-analytics"],
};

/** Where each package comes from: copied and loaded with Package.create. */
const LOADED_FROM: Record<string, string> = {
   [PACKAGE]: path.join(EXAMPLES, PACKAGE),
   [VALUES_PACKAGE]: path.resolve(
      __dirname,
      "../../fixtures/retrieval-replay-values",
   ),
};

function descriptionOf(pkg: string): string | undefined {
   const dir = LOADED_FROM[pkg] ?? path.join(EXAMPLES, pkg);
   const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "publisher.json"), "utf8"),
   ) as { description?: string };
   return manifest.description;
}

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

/** Compare `actual` with snapshot `file`, or write it when re-recording. */
function expectSnapshot(file: string, actual: unknown): void {
   const text = canonical(JSON.stringify(actual, null, 2));
   const target = path.join(SNAPSHOTS, file);
   if (UPDATING) {
      fs.mkdirSync(SNAPSHOTS, { recursive: true });
      fs.writeFileSync(target, text);
      return;
   }
   if (!fs.existsSync(target)) {
      throw new Error(`snapshot ${file} is missing. Record it: ${RERECORD}`);
   }
   const expected = canonical(fs.readFileSync(target, "utf8"));
   if (expected !== text) {
      throw new Error(
         `snapshot ${file} differs from this run.\n${lineDiff(expected, text)}\n` +
            `If the change is intended, re-record and commit the snapshots, ` +
            `saying why in the pull request: ${RERECORD}`,
      );
   }
}

const traffic = new Traffic();
/** Each distinct system prompt a judge call carried, by its hash. */
const systems = new Map<string, string>();
const loaded = new Map<string, LoadedTempPackage>();
let db: DuckDBConnection | undefined;
let dbDir = "";
let registry: RetrievalRegistry;
let handler: Handler;
/** The index build's snapshot, taken in beforeAll and compared in its own test. */
let buildRecord: unknown;

beforeAll(async () => {
   if (UPDATING && IN_CI) {
      throw new Error(
         "UPDATE_GOLDENS=1 re-records the retrieval replay's snapshots, which " +
            "CI must never do: a snapshot is changed by a person, in a commit, " +
            "with a reason. Re-record locally and commit the diff.",
      );
   }
   for (const [name, dir] of Object.entries(LOADED_FROM)) {
      loaded.set(
         name,
         await loadPackageCopy(dir, { name, environmentName: ENVIRONMENT }),
      );
   }
   dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-replay-"));
   db = new DuckDBConnection(path.join(dbDir, "catalog.db"));
   await db.initialize();
   await createCatalogTables(db);
   await createSourceSummariesTable(db);

   registry = new RetrievalRegistry();
   _setEmbeddingProviderForTests(replayEmbeddingProvider(traffic));
   // One call at a time, so the order of calls is the same on every run.
   registry.chat.override(replayChat(traffic), { concurrency: 1 });

   const environmentOf = (name: string) => ({
      getPackage: async (pkgName: string) => {
         const pkg = name === ENVIRONMENT ? loaded.get(pkgName) : undefined;
         if (pkg) return pkg.pkg;
         throw new Error(
            `retrieval replay: ${name}/${pkgName} is listed, not loaded`,
         );
      },
      listPackages: async () =>
         (LISTED[name] ?? []).map((p) => ({
            name: p,
            description: descriptionOf(p),
         })),
      getStaleCompileErrors: () => new Map(),
      getFailedPackages: () => new Map(),
      // No memory governor: every value read is admitted.
      assertCanAdmitQuery: () => undefined,
      listApiConnections: () => [],
   });
   const store = {
      getEnvironment: async (name: string) => {
         if (!(name in LISTED)) throw new Error(`no environment ${name}`);
         return environmentOf(name);
      },
      listEnvironments: async () =>
         Object.keys(LISTED).map((name) => ({ name })),
   } as unknown as EnvironmentCatalog;
   registerGetContextTool(
      {
         registerTool: (name: string, _config: unknown, h: Handler) => {
            if (name === "get_context") handler = h;
         },
      } as never,
      store,
      new RetrievalService(store, { getDuckDbConnection: () => db! }, registry),
   );

   // The first ranked call on a package starts its index build; wait for
   // each build to finish before the next starts, so their calls never mix.
   const builds: Record<string, unknown> = {};
   for (const name of Object.keys(LOADED_FROM)) {
      traffic.reset();
      await handler({
         search_targets: [{ target_type: "measure", search_text: "warm up" }],
         scopes: [{ environment: ENVIRONMENT, package: name }],
      });
      const pkg = loaded.get(name)!.pkg;
      const state = await pollFor(
         async () => fcjStateOf(registry, pkg),
         (s) => s?.status === "ready" || s?.status === "error",
         180_000,
      );
      if (state?.status !== "ready") {
         throw new Error(
            `the ${name} index did not build: ${JSON.stringify(state)}`,
         );
      }
      const kinds: Record<string, number> = {};
      for (const call of traffic.chatCalls) {
         kinds[call.kind] = (kinds[call.kind] ?? 0) + 1;
      }
      builds[name] = {
         report: withoutTimings(state.index.report),
         traffic: {
            embedding_calls: traffic.embeddingCalls,
            embedded_texts: traffic.embeddedTexts.length,
            embedded_texts_sha256: sha256(
               [...traffic.embeddedTexts].sort().join("\n"),
            ),
            chat_calls_by_kind: Object.fromEntries(
               Object.entries(kinds).sort(([a], [b]) => (a < b ? -1 : 1)),
            ),
            chat_prompts_sha256: traffic.chatCalls
               .map((c) => `${c.kind} ${sha256(`${c.system}\n\n${c.prompt}`)}`)
               .sort(),
         },
      };
   }
   buildRecord = {
      about: "Each package's index build under the stand-in providers, with the warm-up call that started it (one query embedding). Timings are removed.",
      ...builds,
   };
});

afterAll(async () => {
   registry?.chat.reset();
   _clearEmbeddingProviderForTests();
   for (const pkg of loaded.values()) await pkg.cleanup();
   await db?.close();
   if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
});

/** One judge call as the snapshot records it. */
function judgeRecord(call: ChatCall) {
   const systemSha = sha256(call.system);
   systems.set(systemSha, call.system);
   return {
      system_sha256: systemSha,
      prompt_sha256: sha256(call.prompt),
      prompt: call.prompt.split("\n"),
      reply: JSON.parse(call.reply) as unknown,
   };
}

/** Send one case and record what came back and what went out. */
async function replay(c: ReplayCase) {
   traffic.reset();
   const result = await handler(c.params);
   const content = result.content[0] as {
      resource?: { text: string };
      text?: string;
   };
   const text = content.resource?.text ?? content.text ?? "";
   let payload: unknown;
   try {
      payload = JSON.parse(text);
   } catch {
      payload = text;
   }
   const judge = traffic.chatCalls.filter((call) => call.kind === "judge");
   const other = traffic.chatCalls.filter((call) => call.kind !== "judge");
   return {
      case: c.id,
      about: c.about,
      request: c.params,
      response: {
         is_error: result.isError === true,
         payload,
      },
      traffic: {
         embedding_calls: traffic.embeddingCalls,
         embedded_texts: traffic.embeddedTexts,
         judge_calls: judge.length,
         judge: judge.map(judgeRecord),
         ...(other.length > 0
            ? { other_chat_calls: other.map((call) => call.kind) }
            : {}),
      },
   };
}

describe("retrieval replay over storefront", () => {
   it("index build", () => {
      expectSnapshot(BUILD_SNAPSHOT, buildRecord);
   });

   // In order, one at a time: a case never runs beside another.
   for (const c of CASES) {
      it(c.id, async () => {
         expectSnapshot(`${c.id}.json`, await replay(c));
      });
   }

   it("records each judge system prompt once", () => {
      expectSnapshot(
         SYSTEMS_SNAPSHOT,
         Object.fromEntries(
            [...systems.entries()]
               .sort(([a], [b]) => (a < b ? -1 : 1))
               .map(([sha, text]) => [sha, text.split("\n")]),
         ),
      );
   });

   it("has a snapshot for every case and no other", () => {
      const expected = new Set([
         BUILD_SNAPSHOT,
         SYSTEMS_SNAPSHOT,
         ...CASES.map((c) => `${c.id}.json`),
      ]);
      expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
      const present = fs.existsSync(SNAPSHOTS)
         ? fs.readdirSync(SNAPSHOTS).filter((f) => f.endsWith(".json"))
         : [];
      if (UPDATING) {
         for (const f of present) {
            if (!expected.has(f)) fs.rmSync(path.join(SNAPSHOTS, f));
         }
         return;
      }
      expect(present.filter((f) => !expected.has(f)).sort()).toEqual([]);
   });
});
