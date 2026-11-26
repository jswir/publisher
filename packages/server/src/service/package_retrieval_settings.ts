// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The `retrieval` block of a package's publisher.json: how THIS package is
 * searched and indexed. The server operator's side (credentials, egress,
 * ceilings) is publisher.config.json; see ../retrieval/config.ts. A package
 * can switch a feature on, never past what the operator allows.
 *
 * Only keys whose code exists are accepted. Any other key is an error naming
 * the valid ones, so a typo (or a key from a later release) does not silently
 * do nothing. The one exception is a key an earlier release read and this one
 * does not (see {@link IGNORED_RETRIEVAL_KEYS}): it loads, is ignored, and
 * {@link ignoredRetrievalWarnings} says so, so a package written for the
 * earlier release keeps serving.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { PackageManifestError } from "../errors";
import { stepsOutside } from "../path_safety";
import { confinedPackagePath, ImportOutsidePackageError } from "../utils";
import { pathToFileURL } from "url";
import { callerVisibleText } from "../package_relative_text";

/**
 * The variants of the prompt the fcj index build sends to write a node's
 * search rows (`retrieval.fcj.questionsPrompt`); the text of each is in
 * retrieval/llm/prompts/questions.ts. Declared here, with the rest of the
 * manifest settings, so validating publisher.json needs no retrieval code.
 */
export const QUESTIONS_PROMPTS = ["questions", "phrases", "values"] as const;
export type QuestionsPrompt = (typeof QUESTIONS_PROMPTS)[number];

/** Rows a node gets by default; also the count the default text was written for. */
export const DEFAULT_QUESTIONS_PER_NODE = 3;

/**
 * `auto`: on when the operator has an LLM configured, off otherwise.
 * `true`: always on; a package that says so on a server with no LLM does not
 * load. `false`: off.
 */
export type StageEnabled = "auto" | boolean;

const RETRIEVAL_KEYS = ["sourceSummary", "prompts", "fcj"] as const;
const PROMPT_KEYS = [
   "sourceSummary",
   "judge",
   "docParts",
   "questions",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];
const SOURCE_SUMMARY_KEYS = ["enabled"] as const;

/**
 * Keys of `retrieval` that an earlier release read and this one does not: the
 * search it configured is gone, so there is one engine (`retrieval.fcj`). Each
 * still loads, whatever its value, and is reported by
 * {@link ignoredRetrievalWarnings}. The value is the sentence that says what
 * took its place.
 */
const IGNORED_RETRIEVAL_KEYS: Readonly<Record<string, string>> = {
   representation:
      "the search index no longer keeps a per-entity text representation.",
   keyphrases: "the search index no longer writes keyphrases.",
   refine:
      "the engine's judge step replaces it (retrieval.fcj.judge turns that step off).",
   rerank:
      "the engine's judge step replaces it (retrieval.fcj.judge turns that step off).",
   sourceMatch:
      "the engine's judge step replaces it (retrieval.fcj.judge turns that step off).",
};

/** Keys of `retrieval.prompts` that an earlier release read and this one does not. */
const IGNORED_PROMPT_KEYS: Readonly<Record<string, string>> = {
   keyphrase: "the search index no longer writes keyphrases.",
   refine:
      "the refine step is gone; retrieval.prompts.judge replaces the judge's instructions.",
   rerank:
      "the rerank step is gone; retrieval.prompts.judge replaces the judge's instructions.",
   sourceMatch:
      "the source match step is gone; retrieval.prompts.judge replaces the judge's instructions.",
};

/** A prompt a package overrides: the text, read at package load. */
export interface PackagePrompt {
   /** The path as written in publisher.json, for messages. */
   path: string;
   text: string;
   /** sha256 of the text; part of the key that invalidates stored output. */
   hash: string;
}

export interface SourceSummaryConfig {
   enabled: StageEnabled;
}

/**
 * A package's search settings, from `retrieval.fcj`. Every key is optional
 * and has a default; see DEFAULT_FCJ_SETTINGS. Each is something a package
 * author has a reason to set: what the index build may send to the LLM or
 * the embedding provider, how many values it reads, and whether the final
 * ranking step runs.
 */
export interface FcjSettings {
   /** Index-time questions written by the LLM, embedded as extra rows. */
   questions: StageEnabled;
   /** Index-time split of a long doc by the LLM; a rule-based split otherwise. */
   docParts: StageEnabled;
   /** The value index of `#(index)` dimensions and doc value lists. */
   values: boolean;
   /** Most distinct values indexed per dimension, the most frequent kept. */
   valueCap: number;
   /**
    * On by default. With `values` on, the stored values are also embedded at
    * index time (`value_embeddings`), and search ranks dimensions by the
    * meaning of a value target's text as a fourth list, beside the spelling
    * match. A gated source's values are embedded only when it is keyed by
    * the givens `retrieval.dimensionValues.givens` lists
    * (CatalogSource.partitionKey). Off: spelling only, and no stored value
    * is sent to the embedding provider.
    */
   valueEmbeddings: boolean;
   /** The final ranking step's model calls (box 5). Off: search's order. */
   judge: StageEnabled;
}

/**
 * Keys of `retrieval.fcj` that an earlier release read and this one does
 * not: the connect modes, their tuning and the experiments around them are
 * gone, so there is one engine (docs/retrieval.md). Each still loads,
 * whatever its value, and is reported by {@link ignoredRetrievalWarnings}.
 */
const IGNORED_FCJ_KEYS: readonly string[] = [
   "perTarget",
   "hopDiscount",
   "coverFraction",
   "measureWeight",
   "maxClusters",
   "clusterTopK",
   "reachDepth",
   "keyword",
   "contenderShare",
   "collapseCopies",
   "connect",
   "listTopK",
   "questionsPrompt",
   "questionsPerNode",
   "alsoLikely",
   "alsoLikelyTwins",
   "joinedCopies",
   "listRoutes",
   "dropRoutesAt",
   "unservedCopies",
   "splitBundles",
   "splitItemPicks",
   "dateRange",
   "listUnion",
   "readingsRule",
   "twinRule",
   "judgeLlm",
];

export const DEFAULT_FCJ_SETTINGS: FcjSettings = {
   questions: "auto",
   docParts: "auto",
   values: true,
   valueCap: 5_000,
   valueEmbeddings: true,
   judge: "auto",
};

export interface PackageRetrievalSettings {
   /** The engine's knobs; absent means DEFAULT_FCJ_SETTINGS. */
   fcj?: FcjSettings;
   /**
    * Absent means the default: `{ enabled: "auto" }`. An index-time stage: the
    * search index build writes each source's summary, so it runs only on a
    * server that has an LLM.
    */
   sourceSummary?: SourceSummaryConfig;
   prompts: { [K in PromptKey]?: PackagePrompt };
}

export const DEFAULT_PACKAGE_RETRIEVAL: PackageRetrievalSettings = {
   prompts: {},
};

/** The source-summary settings in force: the package's, or the defaults. */
export function sourceSummaryConfigOf(
   retrieval: PackageRetrievalSettings,
): SourceSummaryConfig {
   return retrieval.sourceSummary ?? { enabled: "auto" };
}

/** The fcj knobs in force: the package's, or the defaults. */
export function fcjSettingsOf(
   retrieval: PackageRetrievalSettings | undefined,
): FcjSettings {
   return retrieval?.fcj ?? DEFAULT_FCJ_SETTINGS;
}

function fail(message: string): never {
   throw new PackageManifestError(message);
}

function describe(value: unknown): string {
   return JSON.stringify(value) ?? "nothing";
}

/**
 * `rel` as a path inside `packageRoot`, or a PackageManifestError. Rejects an
 * absolute path, a NUL byte, and anything that resolves outside the package
 * directory, including through a symlink: the check runs on the real paths
 * once the file exists.
 */
export function resolvePromptPath(
   packageRoot: string,
   rel: string,
   promptKey: PromptKey = "judge",
): string {
   const key = `retrieval.prompts.${promptKey}`;
   const fix = `Fix: use a path inside the package, e.g. "prompts/${promptKey}.md".`;
   if (
      rel.includes("\0") ||
      path.isAbsolute(rel) ||
      /^[A-Za-z]:[\\/]/.test(rel) ||
      rel.startsWith("\\")
   ) {
      fail(
         `Invalid publisher.json ${key}: ${describe(rel)} is an absolute path. ${fix}`,
      );
   }
   const root = path.resolve(packageRoot);
   const resolved = path.resolve(root, rel);
   const within = path.relative(root, resolved);
   if (within === "" || stepsOutside(within)) {
      fail(
         `Invalid publisher.json ${key}: ${describe(rel)} resolves outside the package directory. ${fix}`,
      );
   }
   return resolved;
}

function objectBlock(
   raw: unknown,
   key: string,
   valid: readonly string[],
   fix: string,
): Record<string, unknown> {
   if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(
         `Invalid publisher.json ${key}: expected an object, got ${describe(raw)}. Fix: ${fix}`,
      );
   }
   const obj = raw as Record<string, unknown>;
   const unknown = Object.keys(obj).filter((k) => !valid.includes(k));
   if (unknown.length > 0) {
      fail(
         `Invalid publisher.json ${key}: unknown key ${unknown.map((k) => `'${k}'`).join(", ")}. ` +
            `Valid keys: ${valid.join(", ")}.`,
      );
   }
   return obj;
}

function parseEnabled(value: unknown, key: string): StageEnabled {
   if (value === undefined || value === null) return "auto";
   if (value === "auto" || value === true || value === false) return value;
   return fail(
      `Invalid publisher.json ${key}: expected "auto", true or false, got ${describe(value)}. ` +
         `Fix: "enabled": "auto" (on when the server has an LLM), true (require one) or false.`,
   );
}

function parseSourceSummary(raw: unknown): SourceSummaryConfig {
   const obj = objectBlock(
      raw,
      "retrieval.sourceSummary",
      SOURCE_SUMMARY_KEYS,
      `"sourceSummary": { "enabled": "auto" }`,
   );
   return {
      enabled: parseEnabled(obj.enabled, "retrieval.sourceSummary.enabled"),
   };
}

const FCJ_KEYS = Object.keys(DEFAULT_FCJ_SETTINGS);

/** A number setting of `retrieval.fcj`, with a message that says what fits. */
function fcjNumber(
   obj: Record<string, unknown>,
   key: keyof FcjSettings,
   check: { min: number; max: number; integer: boolean },
): number {
   const value = obj[key] ?? DEFAULT_FCJ_SETTINGS[key];
   const ok =
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= check.min &&
      value <= check.max &&
      (!check.integer || Number.isSafeInteger(value));
   if (!ok) {
      fail(
         `Invalid publisher.json retrieval.fcj.${key}: expected ${check.integer ? "an integer" : "a number"} from ${check.min} to ${check.max}, got ${describe(obj[key])}. ` +
            `Fix: "${key}": ${JSON.stringify(DEFAULT_FCJ_SETTINGS[key])}`,
      );
   }
   return value as number;
}

function fcjBoolean(
   obj: Record<string, unknown>,
   key: keyof FcjSettings,
): boolean {
   const value = obj[key] ?? DEFAULT_FCJ_SETTINGS[key];
   if (typeof value !== "boolean") {
      fail(
         `Invalid publisher.json retrieval.fcj.${key}: expected true or false, got ${describe(obj[key])}. ` +
            `Fix: "${key}": ${JSON.stringify(DEFAULT_FCJ_SETTINGS[key])}`,
      );
   }
   return value as boolean;
}

function parseFcj(raw: unknown): FcjSettings {
   const obj = objectBlock(
      raw,
      "retrieval.fcj",
      [...FCJ_KEYS, ...IGNORED_FCJ_KEYS],
      `"fcj": { "values": true }`,
   );
   const int = (key: keyof FcjSettings, min: number, max: number) =>
      fcjNumber(obj, key, { min, max, integer: true });
   return {
      // Unset means the default, which for these three is "auto".
      questions: parseEnabled(obj.questions, "retrieval.fcj.questions"),
      docParts: parseEnabled(obj.docParts, "retrieval.fcj.docParts"),
      values: fcjBoolean(obj, "values"),
      valueCap: int("valueCap", 1, 1_000_000),
      valueEmbeddings: fcjBoolean(obj, "valueEmbeddings"),
      judge: parseEnabled(obj.judge, "retrieval.fcj.judge"),
   };
}

/**
 * Validate the block's shape and return what it says, with the prompt path
 * still unread. Throws a PackageManifestError (424: the package is not served
 * until the author fixes the file) naming the key and a fix. A key an earlier
 * release read ({@link IGNORED_RETRIEVAL_KEYS}) is not validated and never
 * throws.
 */
export function parsePackageRetrieval(raw: unknown): {
   fcj?: FcjSettings;
   sourceSummary?: SourceSummaryConfig;
   promptPaths: { [K in PromptKey]?: string };
} {
   if (raw === undefined || raw === null) {
      return { promptPaths: {} };
   }
   if (typeof raw !== "object" || Array.isArray(raw)) {
      fail(
         `Invalid publisher.json retrieval: expected an object, got ${describe(raw)}. ` +
            `Fix: "retrieval": { "fcj": { "values": true } }`,
      );
   }
   const obj = raw as Record<string, unknown>;
   const unknown = Object.keys(obj).filter(
      (k) =>
         !(RETRIEVAL_KEYS as readonly string[]).includes(k) &&
         !(k in IGNORED_RETRIEVAL_KEYS),
   );
   if (unknown.length > 0) {
      fail(
         `Invalid publisher.json retrieval: unknown key ${unknown.map((k) => `'${k}'`).join(", ")}. ` +
            `Valid keys: ${RETRIEVAL_KEYS.join(", ")}.`,
      );
   }

   const sourceSummary =
      obj.sourceSummary === undefined || obj.sourceSummary === null
         ? undefined
         : parseSourceSummary(obj.sourceSummary);
   const fcj =
      obj.fcj === undefined || obj.fcj === null ? undefined : parseFcj(obj.fcj);

   const promptPaths: { [K in PromptKey]?: string } = {};
   if (obj.prompts !== undefined && obj.prompts !== null) {
      if (typeof obj.prompts !== "object" || Array.isArray(obj.prompts)) {
         fail(
            `Invalid publisher.json retrieval.prompts: expected an object, got ${describe(obj.prompts)}. ` +
               `Fix: "prompts": { "judge": "prompts/judge.md" }`,
         );
      }
      const prompts = obj.prompts as Record<string, unknown>;
      const badPrompt = Object.keys(prompts).filter(
         (k) =>
            !(PROMPT_KEYS as readonly string[]).includes(k) &&
            !(k in IGNORED_PROMPT_KEYS),
      );
      if (badPrompt.length > 0) {
         fail(
            `Invalid publisher.json retrieval.prompts: unknown key ${badPrompt.map((k) => `'${k}'`).join(", ")}. ` +
               `Valid keys: ${PROMPT_KEYS.join(", ")}.`,
         );
      }
      for (const key of PROMPT_KEYS) {
         const value = prompts[key];
         if (value === undefined || value === null) continue;
         if (typeof value !== "string" || value.trim() === "") {
            fail(
               `Invalid publisher.json retrieval.prompts.${key}: expected a file path inside the package, got ${describe(value)}. ` +
                  `Fix: "${key}": "prompts/${key}.md"`,
            );
         }
         promptPaths[key] = value;
      }
   }
   return {
      ...(fcj ? { fcj } : {}),
      ...(sourceSummary ? { sourceSummary } : {}),
      promptPaths,
   };
}

/**
 * One warning for each key of a package's `retrieval` block that an earlier
 * release read and this one ignores, naming the key and saying it no longer
 * does anything. Empty for a block with none. Never throws: the block's shape
 * is checked by {@link parsePackageRetrieval}.
 */
export function ignoredRetrievalWarnings(raw: unknown): string[] {
   if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
   const obj = raw as Record<string, unknown>;
   const warnings: string[] = [];
   for (const [key, why] of Object.entries(IGNORED_RETRIEVAL_KEYS)) {
      if (obj[key] !== undefined && obj[key] !== null) {
         warnings.push(ignoredKeyWarning(`retrieval.${key}`, why));
      }
   }
   const fcj = obj.fcj;
   if (typeof fcj === "object" && fcj !== null && !Array.isArray(fcj)) {
      for (const key of IGNORED_FCJ_KEYS) {
         if ((fcj as Record<string, unknown>)[key] !== undefined) {
            warnings.push(
               ignoredKeyWarning(
                  `retrieval.fcj.${key}`,
                  "the search engine it tuned is gone; get_context now ranks by source with one judge call per source.",
               ),
            );
         }
      }
   }
   const prompts = obj.prompts;
   if (typeof prompts === "object" && prompts !== null) {
      for (const [key, why] of Object.entries(IGNORED_PROMPT_KEYS)) {
         const value = (prompts as Record<string, unknown>)[key];
         if (value !== undefined && value !== null) {
            warnings.push(ignoredKeyWarning(`retrieval.prompts.${key}`, why));
         }
      }
   }
   return warnings;
}

function ignoredKeyWarning(key: string, why: string): string {
   return `publisher.json ${key} no longer does anything and is ignored: ${why} Fix: remove the key.`;
}

async function readPromptFile(
   packageRoot: string,
   key: PromptKey,
   rel: string,
): Promise<PackagePrompt> {
   const file = resolvePromptPath(packageRoot, rel, key);
   const at = `retrieval.prompts.${key}`;
   let text: string;
   try {
      // Resolved by the package's own walk, which never looks outside it: a
      // symlink in the package can point anywhere, and one that leads out is
      // refused the same whether or not what it names exists.
      let realFile: string;
      try {
         realFile = await confinedPackagePath(packageRoot, pathToFileURL(file));
      } catch (error) {
         if (!(error instanceof ImportOutsidePackageError)) throw error;
         return fail(
            `Invalid publisher.json ${at}: ${describe(rel)} resolves outside the package directory through a link. ` +
               `Fix: copy the file into the package.`,
         );
      }
      text = await fs.promises.readFile(realFile, "utf8");
   } catch (error) {
      if (error instanceof PackageManifestError) throw error;
      return fail(
         `Invalid publisher.json ${at}: cannot read ${describe(rel)} (${callerVisibleText((error as Error).message, packageRoot)}). ` +
            `Fix: create the file inside the package or remove the key.`,
      );
   }
   if (text.trim() === "") {
      fail(
         `Invalid publisher.json ${at}: ${describe(rel)} is empty. ` +
            `Fix: write the prompt, or remove the key to use the built-in one.`,
      );
   }
   return {
      path: rel,
      text,
      hash: createHash("sha256").update(text).digest("hex"),
   };
}

/**
 * Parse the block and read the prompt files it names. Called when the package
 * loads, so an edit takes effect on reload and a bad path stops the load with
 * a message naming the file.
 */
export async function readPackageRetrieval(
   packageRoot: string,
   raw: unknown,
): Promise<PackageRetrievalSettings> {
   const parsed = parsePackageRetrieval(raw);
   const prompts: PackageRetrievalSettings["prompts"] = {};
   for (const key of PROMPT_KEYS) {
      const rel = parsed.promptPaths[key];
      if (rel !== undefined) {
         prompts[key] = await readPromptFile(packageRoot, key, rel);
      }
   }
   return {
      ...(parsed.fcj ? { fcj: parsed.fcj } : {}),
      ...(parsed.sourceSummary ? { sourceSummary: parsed.sourceSummary } : {}),
      prompts,
   };
}

/**
 * A package that sets the summary stage to `true` needs the operator's LLM.
 * With none configured the package does not load, with a message that names
 * both fixes, rather than serving answers that quietly skip the stage it
 * asked for. `auto` and `false` never fail here.
 */
export function assertRequiredStagesAvailable(
   retrieval: PackageRetrievalSettings,
   llmConfigured: boolean,
): void {
   if (llmConfigured) return;
   if (retrieval.sourceSummary?.enabled === true) {
      fail(
         `Invalid publisher.json retrieval.sourceSummary.enabled: true needs an LLM, and this server has none configured. ` +
            `Fix: set retrieval.llm in publisher.config.json and LLM_API_KEY in the server's environment, ` +
            `or set "enabled": "auto" (on only when an LLM is configured) or false.`,
      );
   }
}
