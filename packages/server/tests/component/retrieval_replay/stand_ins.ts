// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The retrieval replay's stand-ins for the two providers get_context calls
 * out to: an embedding endpoint and a chat model. Both are deterministic and
 * offline, and both record what the engine sent them, so a snapshot can say
 * how many calls a request made and what the judge was asked.
 *
 * - Embeddings: the real OpenAI-compatible EmbeddingProvider over a stub
 *   fetch that answers each text with the harness's bag-of-words vector
 *   (test_helpers/get_context_llm_harness.ts, `embedText`). Texts that share
 *   words land close together, which is enough for the engine's ranking to
 *   mean something without any network.
 * - Chat: the real ChatModelImpl (JSON extraction, the one repair re-ask,
 *   usage counts) over a RawChat whose reply is a RULE of the prompt, not a
 *   recording. The judge's rule is {@link standInJudgeReply}. Index-time
 *   prompts (doc parts, questions, source summaries) get rule replies too,
 *   so the index is built the way it is on a server with an LLM.
 *
 * Rules rather than a recorded model: a recording keyed by the prompt goes
 * missing the moment a change touches the prompt, which is exactly the change
 * the replay is for. A rule always answers, and the prompt's text in the
 * snapshot shows that the prompt moved.
 *
 * A rule reads its prompt through an explicit grammar. A prompt the grammar
 * does not match throws a {@link StandInError}, and the spec fails that case
 * naming the line, rather than letting the engine read an empty reply as a
 * target nothing answered.
 */

import { createHash } from "crypto";
import { DEFAULT_EMBEDDING_MIN_SIMILARITY } from "../../../src/config";
import {
   ChatModelImpl,
   type RawChat,
} from "../../../src/retrieval/llm/chat_model";
import { EmbeddingProvider } from "../../../src/retrieval/llm/embedding_provider";
import type { ChatModel } from "../../../src/retrieval/llm/types";
import { splitDocByRules } from "../../../src/retrieval/index/doc_parts";
import { QUESTION_HEADER } from "../../../src/retrieval/llm/prompts/judge";
import { PERIOD_TARGET_TEXT } from "../../../src/retrieval/search/rerank";
import {
   embedText,
   NO_WAIT_RETRY,
} from "../../../src/test_helpers/get_context_llm_harness";

export function sha256(text: string): string {
   return createHash("sha256").update(text).digest("hex");
}

/**
 * The stand-in could not read a prompt: its format changed, or a part the
 * rule relies on is missing. Not an engine failure: the replay's stand-in
 * needs updating with the prompt.
 */
export class StandInError extends Error {
   constructor(message: string) {
      super(`retrieval replay stand-in: ${message}`);
      this.name = "StandInError";
   }
}

/** What kind of call a chat prompt is, from its shape. */
export type ChatKind =
   | "judge"
   | "order"
   | "doc_parts"
   | "questions"
   | "source_summary"
   | "unrecognized";

export interface ChatCall {
   kind: ChatKind;
   system: string;
   prompt: string;
   /** The reply sent; empty when the call threw. */
   reply: string;
   /** Why the call threw, when it did. */
   error?: string;
   /** The call threw because the stand-in could not read the prompt. */
   standInError?: boolean;
}

/** Every outbound call since the last {@link Traffic.reset}. */
export class Traffic {
   embeddingCalls = 0;
   embeddedTexts: string[] = [];
   chatCalls: ChatCall[] = [];

   reset(): void {
      this.embeddingCalls = 0;
      this.embeddedTexts = [];
      this.chatCalls = [];
   }
}

/**
 * A delay of a few milliseconds that depends on the text, so concurrent
 * calls complete in an order other than the one they were sent in. With
 * `REPLAY_JITTER_SEED` set, the seed moves every delay: a run under another
 * seed completes the calls in another order, and must record the same
 * snapshots.
 */
async function jitter(text: string): Promise<void> {
   const seed = process.env.REPLAY_JITTER_SEED ?? "";
   const ms = parseInt(sha256(`${seed}\u0000${text}`).slice(0, 4), 16) % 7;
   await new Promise((resolve) => setTimeout(resolve, ms));
}

/** The embedding provider of the replay: real client, stub endpoint. */
export function replayEmbeddingProvider(traffic: Traffic): EmbeddingProvider {
   const fetchStub = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      traffic.embeddingCalls += 1;
      traffic.embeddedTexts.push(...body.input);
      await jitter(body.input.join("\n"));
      const data = body.input.map((text, index) => ({
         index,
         embedding: embedText(text),
      }));
      return new Response(JSON.stringify({ data }), { status: 200 });
   }) as typeof fetch;
   return new EmbeddingProvider(
      {
         apiKey: "replay",
         model: "replay-bag-of-words",
         baseUrl: "https://embeddings.replay.invalid/v1",
         minSimilarity: DEFAULT_EMBEDDING_MIN_SIMILARITY,
      },
      fetchStub,
   );
}

function kindOf(system: string, prompt: string): ChatKind {
   if (prompt.includes("\n<targets>\n") && prompt.includes('"picks"')) {
      return "judge";
   }
   if (prompt.includes("\n<sources>\n") && prompt.includes('{"sources": [')) {
      return "order";
   }
   if (prompt.startsWith("<docs>\n")) return "doc_parts";
   if (prompt.startsWith("<fields>\n") && prompt.includes('"questions"')) {
      return "questions";
   }
   if (/^Source name: /m.test(prompt) || /source summar/i.test(system)) {
      return "source_summary";
   }
   return "unrecognized";
}

/** The numbered lines of a batch prompt, as [number, text]; at least one. */
function numbered(prompt: string, kind: ChatKind): Array<[number, string]> {
   const lines = [...prompt.matchAll(/^\[(\d+)\] (.*)$/gm)].map(
      (m) => [Number(m[1]), m[2]] as [number, string],
   );
   if (lines.length === 0) {
      throw new StandInError(
         `a ${kind} prompt has no numbered "[n] ..." lines to answer`,
      );
   }
   return lines;
}

/** Doc parts: the engine's own rule split of each doc. */
function docPartsReply(prompt: string): string {
   return JSON.stringify({
      results: numbered(prompt, "doc_parts").map(([index, doc]) => ({
         index,
         ...splitDocByRules(doc),
      })),
   });
}

/** Questions: the right number of plain rewordings of each field's line. */
function questionsReply(prompt: string): string {
   const slots = /"questions": \[([^\]]*)\]/.exec(prompt)?.[1];
   if (slots === undefined) {
      throw new StandInError(
         'a questions prompt has no "questions": [...] reply shape to count the questions per field from',
      );
   }
   const perNode = Math.max(1, (slots.match(/"\.\.\."/g) ?? []).length);
   return JSON.stringify({
      results: numbered(prompt, "questions").map(([index, line]) => {
         // "(dimension, string) name: doc" -> the words after the kind.
         const words = line
            .replace(/^\([^)]*\)\s*/, "")
            .toLowerCase()
            .match(/[a-z0-9]+/g)
            ?.slice(0, 10) ?? ["field"];
         const stems = [
            `what is the ${words.join(" ")}`,
            `break it down by ${words.slice(0, 5).join(" ")}`,
            `show me ${words.slice(-5).join(" ")}`,
         ];
         return {
            index,
            questions: Array.from(
               { length: perNode },
               (_, i) => stems[i % stems.length],
            ),
         };
      }),
   });
}

/** A source summary: the doc, then the field names, as the harness writes it. */
function summaryReply(prompt: string): string {
   const source = /^Source name: (.*)$/m.exec(prompt)?.[1];
   const doc = /^Source documentation:\n(.*)$/m.exec(prompt)?.[1];
   if (source === undefined || doc === undefined) {
      throw new StandInError(
         'a source summary prompt has no "Source name:" line or no "Source documentation:" block',
      );
   }
   const fields = [...prompt.matchAll(/^\s*- ([^ :(]+)/gm)].map((m) => m[1]);
   const oneLine =
      doc === "No source docs."
         ? `The \`${source}\` source.`
         : (doc.split(". ")[0].replace(/\.$/, "") + ".").slice(0, 120);
   return JSON.stringify({
      summary: `${doc} Fields: ${fields.map((f) => `\`${f}\``).join(", ")}.`,
      one_line_summary: oneLine,
   });
}

// ---------------------------------------------------------------------------
// The judge prompt's grammar
// ---------------------------------------------------------------------------

/** One stored value shown under a candidate. */
export interface ShownValue {
   /** `3a`; only a dimensional_value target's values carry one. */
   label?: string;
   value: string;
   how: "exact" | "words" | "typo" | "meaning";
}

/** One numbered line the judge may pick. */
export interface JudgeCandidate {
   number: number;
   /** The field's name as listed (a joined copy's is dotted). */
   name: string;
   kind: string;
   dataType?: string;
   source: string;
   /** The field's doc; empty when the line says it has none. */
   doc: string;
   /** The stored values shown (`stored values matching the target`). */
   values?: ShownValue[];
   /** Shown with `no stored values`. */
   bare?: boolean;
   /** An extra (`Also in this group`), with its reason. */
   extra?: string;
}

export interface JudgeTarget {
   number: number;
   type: string;
   text: string;
   candidates: JudgeCandidate[];
}

export interface JudgePrompt {
   /** The one source a source-first pick call shows (its `Source:` line). */
   source?: string;
   /** The caller's question, when the prompt quotes it. */
   question?: string;
   targets: JudgeTarget[];
   extras: JudgeCandidate[];
   /** The prompt is the repair re-ask of an earlier reply. */
   repair: boolean;
}

const NAME = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";
const TARGET_LINE = /^Target (\d+) \(([a-z_]+)((?:; [^;)]+)*)\): (".*")$/;
const HEAD = new RegExp(
   `^\\[(\\d+)\\] (${NAME}) \\(([a-z_]+)(?:, ([^;)]+))?; source ([A-Za-z_][A-Za-z0-9_]*)`,
);
const REPLY_FORMAT_START = "Reply with one JSON object and nothing else:";
const REPAIR_START = "Your previous reply was:";

/**
 * The end of a `(...)` group that starts at `at` (the `(`), skipping JSON
 * strings and nested parentheses. -1 when it does not close.
 */
function closingParen(text: string, at: number): number {
   let depth = 0;
   for (let i = at; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
         i++;
         while (i < text.length && text[i] !== '"') {
            if (text[i] === "\\") i++;
            i++;
         }
         continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") {
         depth--;
         if (depth === 0) return i;
      }
   }
   return -1;
}

const VALUE_ITEM =
   /^(?:(\d+[a-z]) )?("(?:[^"\\]|\\.)*") \((exact|words|typo|meaning), \d+\.\d\d\)/;

/** `3a "Jeans" (exact, 1.00), 3b ... , and 2 more not shown`. */
function parseValues(text: string, line: string): ShownValue[] {
   const out: ShownValue[] = [];
   let rest = text;
   for (;;) {
      const m = VALUE_ITEM.exec(rest);
      if (!m) {
         throw new StandInError(
            `cannot read the stored values of a candidate line: ${JSON.stringify(line)}`,
         );
      }
      out.push({
         ...(m[1] ? { label: m[1] } : {}),
         value: JSON.parse(m[2]) as string,
         how: m[3] as ShownValue["how"],
      });
      rest = rest.slice(m[0].length);
      if (rest === "" || /^, and \d+ more not shown$/.test(rest)) return out;
      if (!rest.startsWith(", ")) {
         throw new StandInError(
            `cannot read the stored values of a candidate line: ${JSON.stringify(line)}`,
         );
      }
      rest = rest.slice(2);
   }
}

/**
 * One candidate line, after its indent:
 * `[n] name (kind[, type]; source S[; how it is reached]): doc[ | values][ | added because: why]`.
 */
export function parseCandidateLine(line: string): JudgeCandidate {
   const head = HEAD.exec(line);
   if (!head) {
      throw new StandInError(
         `cannot read a judge candidate line: ${JSON.stringify(line)}`,
      );
   }
   // The `(` of the kind group; the group may go on with how the field is
   // reached, which can quote docs holding parentheses.
   const open = line.indexOf(" (", head[1].length + head[2].length + 3) + 1;
   const close = closingParen(line, open);
   if (close < 0 || line.slice(close, close + 3) !== "): ") {
      throw new StandInError(
         `a judge candidate line has no "(...): " after its name: ${JSON.stringify(line)}`,
      );
   }
   let body = line.slice(close + 3);
   const candidate: JudgeCandidate = {
      number: Number(head[1]),
      name: head[2],
      kind: head[3],
      ...(head[4] ? { dataType: head[4] } : {}),
      source: head[5],
      doc: "",
   };
   const extraAt = body.lastIndexOf(" | added because: ");
   if (extraAt >= 0) {
      candidate.extra = body.slice(extraAt + " | added because: ".length);
      body = body.slice(0, extraAt);
   }
   if (body.endsWith(" | no stored values")) {
      candidate.bare = true;
      body = body.slice(0, -" | no stored values".length);
   } else {
      const marker = " | stored values matching the target: ";
      const at = body.lastIndexOf(marker);
      if (at >= 0) {
         candidate.values = parseValues(body.slice(at + marker.length), line);
         body = body.slice(0, at);
      }
   }
   if (body.startsWith("(no doc; name in words: ")) {
      if (!body.endsWith(")")) {
         throw new StandInError(
            `a judge candidate line has an unclosed "(no doc; ...)": ${JSON.stringify(line)}`,
         );
      }
      candidate.doc = "";
   } else {
      candidate.doc = body;
   }
   return candidate;
}

/** A line that must be one JSON string. */
function jsonString(line: string | undefined, what: string): string {
   try {
      const v = JSON.parse(line ?? "") as unknown;
      if (typeof v === "string") return v;
   } catch {
      // Thrown below.
   }
   throw new StandInError(
      `${what} is not one JSON string: ${JSON.stringify(line)}`,
   );
}

/**
 * The header of a pick call, which shows one source:
 *
 *    Source: name[ - one-line description]
 *    Its doc: "<the source's doc, as JSON>"      (when it has one)
 *
 * Returns the source's name; anything else above `<targets>` throws.
 */
function parsePickHeader(header: readonly string[]): string | undefined {
   const lines = header.filter((l) => l !== "");
   if (lines.length === 0) {
      throw new StandInError("a judge prompt has no header above <targets>");
   }
   const m = /^Source: ([A-Za-z_][A-Za-z0-9_]*)(?: - .*)?$/.exec(lines[0]);
   if (!m) {
      throw new StandInError(
         `cannot read a pick call's source line: ${JSON.stringify(lines[0])}`,
      );
   }
   for (const line of lines.slice(1)) {
      if (!line.startsWith("Its doc: ")) {
         throw new StandInError(
            `a pick call's header has a line the stand-in cannot read: ${JSON.stringify(line)}`,
         );
      }
      jsonString(line.slice("Its doc: ".length), "a pick call's source doc");
   }
   return m[1];
}

/**
 * Read a pick call's prompt through its grammar: the source it shows
 * ({@link parsePickHeader}), then
 *
 *    <targets>
 *    Target 1 (measure): "total revenue"
 *      [1] name (kind, type; source s[; through the join j]): doc
 *      (no candidates in this group)
 *    </targets>
 *
 *    <the question header>                          (when there is one)
 *    "<the question, as JSON>"
 *
 * (The readers for the old engine's list lines, `From s:` headers and
 * `Also in this group:` extras are kept; the source-first engine sends none
 * of them.)
 *
 *    Reply with one JSON object and nothing else: ...
 *    [the repair re-ask's "Your previous reply was: ..." tail]
 *
 * Every line between the targets tags must be one of those; anything else,
 * a candidate before the first target, or no target at all, throws.
 */
export function parseJudgePrompt(prompt: string): JudgePrompt {
   const lines = prompt.split("\n");
   const open = lines.indexOf("<targets>");
   const close = lines.indexOf("</targets>");
   if (open < 0 || close < open) {
      throw new StandInError(
         "a judge prompt has no <targets> ... </targets> block",
      );
   }
   const formatAt = lines.findIndex(
      (l, i) => i > close && l === REPLY_FORMAT_START,
   );
   if (formatAt < 0) {
      throw new StandInError(
         `a judge prompt has no "${REPLY_FORMAT_START}" line after </targets>`,
      );
   }
   const source = parsePickHeader(lines.slice(0, open));
   const targets: JudgeTarget[] = [];
   let current: JudgeTarget | undefined;
   for (const line of lines.slice(open + 1, close)) {
      const t = TARGET_LINE.exec(line);
      if (t) {
         let text: string;
         try {
            text = JSON.parse(t[4]) as string;
         } catch {
            throw new StandInError(
               `a judge target's text is not a JSON string: ${JSON.stringify(line)}`,
            );
         }
         current = {
            number: Number(t[1]),
            type: t[2],
            text,
            candidates: [],
         };
         if (current.number !== targets.length + 1) {
            throw new StandInError(
               `judge targets are not numbered 1, 2, ... in order: ${JSON.stringify(line)}`,
            );
         }
         targets.push(current);
         continue;
      }
      if (!current) {
         throw new StandInError(
            `a judge prompt has a line before its first target: ${JSON.stringify(line)}`,
         );
      }
      if (line === "  (no candidates in this group)") continue;
      if (
         /^ {2}From [A-Za-z_][A-Za-z0-9_]*( \(its doc: ".*"\))?:$/.test(line)
      ) {
         continue;
      }
      const field = /^( {2}| {4})(\[.*)$/.exec(line);
      if (!field) {
         throw new StandInError(
            `a judge prompt has a line the stand-in cannot read: ${JSON.stringify(line)}`,
         );
      }
      current.candidates.push(parseCandidateLine(field[2]));
   }
   if (targets.length === 0) {
      throw new StandInError("a judge prompt lists no target");
   }
   const extras: JudgeCandidate[] = [];
   let question: string | undefined;
   const tail = lines.slice(close + 1, formatAt).filter((l) => l !== "");
   let inExtras = false;
   for (let i = 0; i < tail.length; i++) {
      const line = tail[i];
      if (line === QUESTION_HEADER && question === undefined) {
         // The question: one JSON string on the next line.
         question = jsonString(tail[i + 1], "the question of a judge prompt");
         i += 1;
         inExtras = false;
         continue;
      }
      if (line === "Also in this group:") {
         inExtras = true;
         continue;
      }
      const m = /^ {2}(\[.*)$/.exec(line);
      if (!inExtras || !m) {
         throw new StandInError(
            `a judge prompt has a line the stand-in cannot read after </targets>: ${JSON.stringify(line)}`,
         );
      }
      extras.push(parseCandidateLine(m[1]));
   }
   const repair = lines.slice(formatAt).includes(REPAIR_START);
   return {
      ...(source ? { source } : {}),
      ...(question !== undefined ? { question } : {}),
      targets,
      extras,
      repair,
   };
}

// ---------------------------------------------------------------------------
// The judge's decision rule
// ---------------------------------------------------------------------------

/** Words that never decide a judge pick on their own. */
const STOP = new Set([
   "the",
   "and",
   "for",
   "with",
   "that",
   "this",
   "from",
   "each",
   "what",
   "which",
   "per",
   "how",
   "many",
   "much",
   "does",
   "item",
   "line",
   "lines",
   "were",
   "was",
   "are",
   "its",
   "one",
   "row",
   "all",
   "any",
   "not",
   "only",
   "every",
]);

/**
 * Reserved words a case puts in a target's search_text to ask the stand-in
 * judge for a harder reply. They never count as words of the target.
 */
export const MARKERS = {
   /** `best` is the second candidate of the pick, not the first. */
   best2: "zzbest2",
   /** The reply carries a caveat naming the target's best field. */
   caveat: "zzcaveat",
   /** The first reply names a candidate that was not offered; the repair re-ask gets a valid one. */
   badPick: "zzbadpick",
   /** Every reply is not JSON, so the judge fails after its repair re-ask. */
   fail: "zzjudgefail",
   /**
    * `zzname_<field>`: the reply carries a caveat naming `<field>`, which
    * need not be picked (`zzname_order_count`).
    */
   name: "zzname_",
} as const;

/** A target's text without its markers: what its words are read from. */
function unmarked(text: string): string {
   return text.replace(/\bzz[a-z0-9_]*/gi, " ");
}

/** Words read as another word: a target's "number of" is a field's "count". */
const SYNONYMS: Readonly<Record<string, string>> = { number: "count" };

/**
 * Lower-case content words of a text: split on anything not a letter or
 * digit (so `total_amount` is two words), a plural "s" or a past "ed"
 * dropped, then stop words out and {@link SYNONYMS} applied.
 */
export function contentWords(text: string): Set<string> {
   return new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
         .filter((w) => w.length >= 3)
         .map((w) =>
            w.length > 5 && w.endsWith("ed")
               ? w.slice(0, -2)
               : w.length > 4 && w.endsWith("s")
                 ? w.slice(0, -1)
                 : w,
         )
         .filter((w) => !STOP.has(w))
         .map((w) => SYNONYMS[w] ?? w),
   );
}

/** Data types the period target's stand-in pick reads as a date. */
const DATE_TYPES = new Set(["date", "timestamp", "timestamptz"]);

/** A name word counts this many times a doc word. */
export const NAME_WEIGHT = 2;
/** The lowest score that picks a field: one target word in its name, or two in its doc. */
export const PICK_THRESHOLD = 2;

/**
 * A field's score for a target: {@link NAME_WEIGHT} for each target word in
 * its name, 1 for each other target word in its doc. A function of the
 * target's text and the field's own name and doc only.
 */
export function fieldScore(
   target: ReadonlySet<string>,
   name: string,
   doc: string,
): number {
   const nameWords = contentWords(name);
   const docWords = contentWords(doc);
   let score = 0;
   for (const w of target) {
      if (nameWords.has(w)) score += NAME_WEIGHT;
      else if (docWords.has(w)) score += 1;
   }
   return score;
}

/** The value labels a value target names on one candidate, by spelling. */
function namedValues(
   targetText: string,
   values: readonly ShownValue[],
): ShownValue[] {
   const spelled = values.filter(
      (v) =>
         v.how !== "meaning" ||
         v.value.toLowerCase() === targetText.trim().toLowerCase(),
   );
   // Values holding every word of the target as a whole word, when any do:
   // "Springfield" names "West Springfield", not "Springfeld Heights".
   const words = targetText.toLowerCase().match(/[a-z0-9]+/g) ?? [];
   const whole = spelled.filter((v) => {
      const own = new Set(v.value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      return words.length > 0 && words.every((w) => own.has(w));
   });
   return whole.length > 0 ? whole : spelled;
}

interface Pick {
   target: number;
   candidates: number[];
   best?: number;
   values?: string[];
   reason: string;
}

/** Best first: score, then name, then source. */
function byScore(
   a: { score: number; c: JudgeCandidate },
   b: { score: number; c: JudgeCandidate },
): number {
   const key = (c: JudgeCandidate) => `${c.name}\u0000${c.source}`;
   return b.score - a.score || (key(a.c) < key(b.c) ? -1 : 1);
}

/**
 * The stand-in judge: a fixed function of the prompt, so the replay shows
 * what the engine does with a judge's answer. For each target, independently
 * of every other candidate line and of the order they are listed in:
 *
 * - A field is picked when its {@link fieldScore} for the target is at least
 *   {@link PICK_THRESHOLD}. Picks are listed by score, then name, then
 *   source; the first is `best`. There is no cap per call, so the same field
 *   gets the same decision in one big call or in a call per source.
 * - The implicit period target box 4 adds when the question names a period
 *   ({@link PERIOD_TARGET_TEXT}) picks the source's first date or timestamp
 *   dimension listed under it.
 * - A value target (`dimensional_value`) picks every candidate shown with a
 *   stored value matched by spelling (`exact`, `words`, `typo`) or equal to
 *   the target ignoring case, naming in `values` those of its values that
 *   hold every word of the target, or all of them when none does. A
 *   candidate shown with `no stored values` is picked only when it is the
 *   target's only candidate (a dimension the caller pinned).
 * - Extras (`Also in this group`) are never picked.
 *
 * {@link MARKERS} in a target's text change the reply for that target.
 */
export function standInJudgeReply(prompt: string): string {
   const parsed = parseJudgePrompt(prompt);
   const picks: Pick[] = [];
   const caveats: string[] = [];
   for (const t of parsed.targets) {
      const marked = new Set(t.text.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
      if (marked.has(MARKERS.fail)) {
         return `stand-in: no JSON here, as ${MARKERS.fail} asks`;
      }
      const words = contentWords(unmarked(t.text));
      const aside = /\bzzname_([a-z0-9_]+)/i.exec(t.text)?.[1];
      const pick: Pick = { target: t.number, candidates: [], reason: "" };
      if (t.type === "dimensional_value") {
         const named: string[] = [];
         const fields = t.candidates;
         for (const c of fields) {
            const values = namedValues(t.text, c.values ?? []);
            if (values.length > 0) {
               pick.candidates.push(c.number);
               named.push(...values.map((v) => v.label ?? v.value));
            } else if (c.bare && fields.length === 1) {
               pick.candidates.push(c.number);
            }
         }
         if (named.length > 0) pick.values = named;
         pick.reason =
            pick.candidates.length > 0
               ? "stand-in: a stored value matched by spelling, or the one pinned field"
               : "stand-in: no stored value matched by spelling";
      } else if (t.text === PERIOD_TARGET_TEXT) {
         const date = t.candidates.find(
            (c) => c.kind === "dimension" && DATE_TYPES.has(c.dataType ?? ""),
         );
         if (date) pick.candidates.push(date.number);
         pick.reason = date
            ? "stand-in: the first date or timestamp dimension listed"
            : "stand-in: no date or timestamp dimension listed";
      } else {
         const chosen = t.candidates
            .map((c) => ({ c, score: fieldScore(words, c.name, c.doc) }))
            .filter((x) => x.score >= PICK_THRESHOLD)
            .sort(byScore);
         pick.candidates = chosen.map((x) => x.c.number);
         pick.reason =
            chosen.length > 0
               ? `stand-in: ${chosen.length} candidate(s) scored ${PICK_THRESHOLD} or more`
               : "stand-in: no candidate scored high enough";
         if (chosen.length > 0 && marked.has(MARKERS.caveat)) {
            caveats.push(
               `stand-in caveat: ${chosen[0].c.name} on ${chosen[0].c.source} was a close call for target ${t.number}.`,
            );
         }
      }
      if (aside) {
         caveats.push(
            `stand-in caveat: ${aside} may answer target ${t.number} too.`,
         );
      }
      if (pick.candidates.length > 0) {
         pick.best =
            marked.has(MARKERS.best2) && pick.candidates.length > 1
               ? pick.candidates[1]
               : pick.candidates[0];
      }
      if (marked.has(MARKERS.badPick) && !parsed.repair) {
         const numbers = [
            ...parsed.targets.flatMap((x) => x.candidates.map((c) => c.number)),
            ...parsed.extras.map((c) => c.number),
         ];
         pick.candidates = [...pick.candidates, Math.max(0, ...numbers) + 100];
      }
      picks.push(pick);
   }
   return JSON.stringify({ picks, caveats });
}

/** One source of an ordering prompt: its number, name and the field names listed under each target. */
export interface OrderSource {
   number: number;
   name: string;
   /** Per target text: the field names search found on the source. */
   fields: Map<string, string[]>;
}

export interface OrderPrompt {
   question?: string;
   targets: Array<{ type: string; text: string }>;
   sources: OrderSource[];
}

/**
 * Read an ordering prompt through its grammar:
 *
 *    Question: "<the question, as JSON>"            (when there is one)
 *    What the caller is looking for:
 *      measure: "total revenue"
 *
 *    <sources>
 *    [1] name - "<its doc, as JSON>"                 (or `[1] name[ - description]`)
 *      Fields search found here:
 *        for "total revenue": total_sales, margin_rate
 *        for "customer state": (nothing found)
 *    </sources>
 *
 *    Reply with one JSON object and nothing else: ...
 *
 * Anything else throws.
 */
export function parseOrderPrompt(prompt: string): OrderPrompt {
   const lines = prompt.split("\n");
   let i = 0;
   let question: string | undefined;
   if (lines[i]?.startsWith("Question: ")) {
      question = jsonString(
         lines[i].slice("Question: ".length),
         "the question of an ordering prompt",
      );
      i += 1;
   }
   if (lines[i] !== "What the caller is looking for:") {
      throw new StandInError(
         `an ordering prompt does not say what the caller is looking for: ${JSON.stringify(lines[i])}`,
      );
   }
   i += 1;
   const targets: OrderPrompt["targets"] = [];
   for (; i < lines.length && lines[i] !== ""; i++) {
      const m = /^ {2}([a-z_]+): (".*")$/.exec(lines[i]);
      if (!m) {
         throw new StandInError(
            `cannot read an ordering prompt's target line: ${JSON.stringify(lines[i])}`,
         );
      }
      targets.push({
         type: m[1],
         text: jsonString(m[2], "an ordering target"),
      });
   }
   if (targets.length === 0 || lines[i + 1] !== "<sources>") {
      throw new StandInError(
         "an ordering prompt has no targets, or no <sources> block after them",
      );
   }
   const sources: OrderSource[] = [];
   for (i += 2; i < lines.length && lines[i] !== "</sources>"; i++) {
      const line = lines[i];
      const head = /^\[(\d+)\] ([A-Za-z_][A-Za-z0-9_]*)(?: - (.*))?$/.exec(
         line,
      );
      if (head) {
         if (head[3]?.startsWith('"')) jsonString(head[3], "a source's doc");
         sources.push({
            number: Number(head[1]),
            name: head[2],
            fields: new Map(),
         });
         continue;
      }
      const current = sources[sources.length - 1];
      if (line === "  Fields search found here:" && current) continue;
      const f = /^ {4}for (".*?"): (.*)$/.exec(line);
      if (!f || !current) {
         throw new StandInError(
            `an ordering prompt has a line the stand-in cannot read: ${JSON.stringify(line)}`,
         );
      }
      const names =
         f[2] === "(nothing found)"
            ? []
            : f[2].split(", ").map((n) => n.trim());
      current.fields.set(
         jsonString(f[1], "an ordering field line's target"),
         names,
      );
   }
   if (lines[i] !== "</sources>" || sources.length === 0) {
      throw new StandInError(
         "an ordering prompt has no sources, or no </sources>",
      );
   }
   if (!lines.slice(i).includes(REPLY_FORMAT_START)) {
      throw new StandInError(
         `an ordering prompt has no "${REPLY_FORMAT_START}" line`,
      );
   }
   sources.forEach((src, n) => {
      if (src.number !== n + 1) {
         throw new StandInError(
            "an ordering prompt's sources are not numbered 1, 2, ... in order",
         );
      }
   });
   return { ...(question !== undefined ? { question } : {}), targets, sources };
}

/**
 * Steering a case cannot put in a target's text, read from its `user_prompt`
 * (which both box 5 prompts quote): `[replay: fail pick <source>]` fails
 * that source's pick call, `[replay: order invalid]` answers the ordering
 * call with no kept source, `[replay: order late]` holds the ordering reply
 * until the call is cut.
 */
export function directives(question: string | undefined): string[] {
   return [...(question ?? "").matchAll(/\[replay: ([^\]]+)\]/g)].map(
      (m) => m[1],
   );
}

/**
 * The stand-in ordering call: each source scores, for each target, the
 * stand-in judge's name score ({@link fieldScore}, docs not shown) of the
 * fields listed under it, summed; most first, ties by source name. Not box
 * 4's order, so a reordering shows in the replay.
 */
export function standInOrderReply(prompt: string): string {
   const parsed = parseOrderPrompt(prompt);
   if (parsed.targets.some((t) => /\bzzjudgefail\b/i.test(t.text))) {
      return `stand-in: no JSON here, as ${MARKERS.fail} asks`;
   }
   if (directives(parsed.question).includes("order invalid")) {
      return JSON.stringify({ sources: [parsed.sources.length + 90] });
   }
   const scored = parsed.sources.map((src) => {
      let score = 0;
      for (const t of parsed.targets) {
         const words = contentWords(unmarked(t.text));
         for (const name of src.fields.get(t.text) ?? []) {
            score += fieldScore(words, name, "");
         }
      }
      return { src, score };
   });
   scored.sort(
      (a, b) =>
         b.score - a.score ||
         (a.src.name < b.src.name ? -1 : a.src.name > b.src.name ? 1 : 0),
   );
   return JSON.stringify({ sources: scored.map((x) => x.src.number) });
}

function replyFor(kind: ChatKind, prompt: string): string {
   switch (kind) {
      case "judge": {
         const parsed = parseJudgePrompt(prompt);
         if (
            directives(parsed.question).includes(`fail pick ${parsed.source}`)
         ) {
            throw new Error(
               `replay stand-in: the pick call for ${parsed.source} fails, as the case asks`,
            );
         }
         return standInJudgeReply(prompt);
      }
      case "order":
         return standInOrderReply(prompt);
      case "doc_parts":
         return docPartsReply(prompt);
      case "questions":
         return questionsReply(prompt);
      case "source_summary":
         return summaryReply(prompt);
      case "unrecognized":
         throw new StandInError(
            `a chat prompt of a kind it does not recognize, starting ${JSON.stringify(prompt.slice(0, 120))}`,
         );
   }
}

/** An ordering prompt whose case asks for a late reply (`[replay: order late]`). */
function orderIsLate(prompt: string): boolean {
   try {
      return directives(parseOrderPrompt(prompt).question).includes(
         "order late",
      );
   } catch {
      return false;
   }
}

/**
 * The chat model of the replay: real ChatModelImpl, rule replies. Each call
 * waits a few milliseconds (see {@link jitter}) before it answers, so calls
 * the engine sends together complete out of order.
 */
export function replayChat(traffic: Traffic): ChatModel {
   const raw: RawChat = {
      async send(req) {
         const system = req.system ?? "";
         const kind = kindOf(system, req.prompt);
         const call: ChatCall = {
            kind,
            system,
            prompt: req.prompt,
            reply: "",
         };
         traffic.chatCalls.push(call);
         if (kind === "order" && orderIsLate(req.prompt)) {
            // Never answers: the call is cut once the pick calls are done.
            call.error = "cut before it answered, as the case asks";
            await new Promise<never>((_, reject) => {
               const cut = () => reject(req.signal.reason);
               if (req.signal.aborted) cut();
               else req.signal.addEventListener("abort", cut, { once: true });
            });
         }
         await jitter(req.prompt);
         try {
            call.reply = replyFor(kind, req.prompt);
         } catch (error) {
            call.error = error instanceof Error ? error.message : String(error);
            call.standInError = error instanceof StandInError;
            throw error;
         }
         return {
            text: call.reply,
            usage: { inputTokens: 0, outputTokens: 0 },
         };
      },
   };
   return new ChatModelImpl("openai-compatible", "replay-rules", raw, {
      timeoutMs: 30_000,
      retry: NO_WAIT_RETRY,
   });
}
