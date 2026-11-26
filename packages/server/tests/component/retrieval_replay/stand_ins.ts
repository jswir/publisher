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
 *   recording. The judge's rule is in {@link standInJudgeReply}. Index-time
 *   prompts (doc parts, questions, source summaries) get rule replies too,
 *   so the index is built the way it is on a server with an LLM.
 *
 * Rules rather than a recorded model: a recording keyed by the prompt goes
 * missing the moment a change touches the prompt, which is exactly the change
 * the replay is for. A rule always answers, and the prompt's hash and text in
 * the snapshot show that the prompt moved.
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
import {
   embedText,
   NO_WAIT_RETRY,
   summaryReply,
} from "../../../src/test_helpers/get_context_llm_harness";

export function sha256(text: string): string {
   return createHash("sha256").update(text).digest("hex");
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
   reply: string;
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

/** The embedding provider of the replay: real client, stub endpoint. */
export function replayEmbeddingProvider(traffic: Traffic): EmbeddingProvider {
   const fetchStub = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      traffic.embeddingCalls += 1;
      traffic.embeddedTexts.push(...body.input);
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

/** The numbered lines of a batch prompt, as [number, text]. */
function numbered(prompt: string): Array<[number, string]> {
   return [...prompt.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => [
      Number(m[1]),
      m[2],
   ]);
}

/** Doc parts: the engine's own rule split of each doc. */
function docPartsReply(prompt: string): string {
   return JSON.stringify({
      results: numbered(prompt).map(([index, doc]) => ({
         index,
         ...splitDocByRules(doc),
      })),
   });
}

/** Questions: the right number of plain rewordings of each field's line. */
function questionsReply(prompt: string): string {
   const slots = /"questions": \[([^\]]*)\]/.exec(prompt)?.[1] ?? "";
   const perNode = Math.max(1, (slots.match(/"\.\.\."/g) ?? []).length);
   return JSON.stringify({
      results: numbered(prompt).map(([index, line]) => {
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
   "of",
   "per",
   "how",
   "many",
   "much",
   "does",
   "item",
   "line",
   "lines",
]);

/** Lower-case content words of a text, a trailing "s" dropped. */
function contentWords(text: string): Set<string> {
   return new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
         .filter((w) => w.length >= 3 && !STOP.has(w))
         .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
   );
}

/** Most candidates the stand-in judge picks per target, by target type. */
const PICKS_BY_TYPE: Record<string, number> = {
   measure: 2,
   dimension: 3,
   dimensional_value: 1,
};
const DEFAULT_PICKS = 2;

/**
 * The stand-in judge. For each target in the prompt, it walks the candidates
 * listed under that target in the order the engine listed them (route lines,
 * indented under their field, are skipped) and picks those whose line shares
 * a content word with the target's text, up to {@link PICKS_BY_TYPE}. The
 * first pick is `best`. A target with no such candidate gets an empty pick:
 * that is how a not-found target looks to the engine.
 *
 * A value target (`dimensional_value`) is picked by its values instead: the
 * first candidate shown with a stored value the engine matched by spelling
 * (`exact`, `words` or `typo`), or equal to the target's text ignoring case,
 * naming those value labels in `values`; a value matched only by `meaning`
 * is not picked. When the target's
 * only candidate is shown with no stored values (a dimension the caller
 * pinned), that candidate is picked. No caveats and no `readings`, ever.
 *
 * This is not a model and is not meant to agree with one: it is a fixed
 * function of the prompt, so the replay shows what the engine does with a
 * judge's answer, and a change to what the judge is shown changes the picks.
 */
export function standInJudgeReply(prompt: string): string {
   const picks: Array<{
      target: number;
      candidates: number[];
      best?: number;
      values?: string[];
      reason: string;
   }> = [];
   let current:
      | {
           target: number;
           type: string;
           text: string;
           words: Set<string>;
           chosen: number[];
           /** Value labels named for a value target. */
           values: string[];
           /** Candidates listed under the target (routes not counted). */
           listed: number;
           /** Value-target candidates shown with no stored values. */
           bare: number[];
        }
      | undefined;
   const close = () => {
      if (!current) return;
      // A value target whose one candidate has no indexed values is a
      // dimension the caller pinned (scopes[].entity_name): take it, as a
      // model reading the field's doc against the value would.
      if (
         current.type === "dimensional_value" &&
         current.chosen.length === 0 &&
         current.listed === 1 &&
         current.bare.length === 1
      ) {
         current.chosen.push(current.bare[0]);
      }
      picks.push({
         target: current.target,
         candidates: current.chosen,
         ...(current.chosen.length > 0 ? { best: current.chosen[0] } : {}),
         ...(current.values.length > 0 ? { values: current.values } : {}),
         reason:
            current.type === "dimensional_value"
               ? current.chosen.length > 0
                  ? "stand-in: a value matched by spelling, or the one pinned field"
                  : "stand-in: no value matched by spelling"
               : current.chosen.length > 0
                 ? "stand-in: listed candidates sharing a word with the target"
                 : "stand-in: no listed candidate shares a word with the target",
      });
      current = undefined;
   };
   let inTargets = false;
   for (const line of prompt.split("\n")) {
      if (line === "<targets>") {
         inTargets = true;
         continue;
      }
      if (line === "</targets>") {
         close();
         inTargets = false;
         continue;
      }
      if (!inTargets) continue;
      const target = /^Target (\d+) \(([a-z_]+)[;)].*?: (".*")$/.exec(line);
      if (target) {
         close();
         const text = JSON.parse(target[3]) as string;
         current = {
            target: Number(target[1]),
            type: target[2],
            text,
            words: contentWords(text),
            chosen: [],
            values: [],
            listed: 0,
            bare: [],
         };
         continue;
      }
      const candidate = /^( +)\[(\d+)\] (.*)$/.exec(line);
      // Route options sit eight spaces in, under their field.
      if (!candidate || !current || candidate[1].length >= 8) continue;
      current.listed += 1;
      const number = Number(candidate[2]);
      if (current.type === "dimensional_value") {
         if (/\| no stored values$/.test(candidate[3])) {
            current.bare.push(number);
            continue;
         }
         // `3a "Jeans" (exact, 1.00)`: the labels of the values matched by
         // spelling (exact, words or typo), or equal to the target ignoring
         // case; a value matched only by meaning is a look-alike.
         const same = [
            ...candidate[3].matchAll(
               /(\d+[a-z]) ("(?:[^"\\]|\\.)*") \(([a-z]+), [\d.]+\)/g,
            ),
         ]
            .filter(
               ([, , v, how]) =>
                  how !== "meaning" ||
                  (JSON.parse(v) as string).toLowerCase() ===
                     current!.text.toLowerCase(),
            )
            .map(([, label]) => label);
         if (same.length > 0 && current.chosen.length < 1) {
            current.chosen.push(number);
            current.values.push(...same);
         }
         continue;
      }
      const cap = PICKS_BY_TYPE[current.type] ?? DEFAULT_PICKS;
      if (current.chosen.length >= cap) continue;
      const text = candidate[3].replace(/_/g, " ");
      const shared = [...contentWords(text)].some((w) => current!.words.has(w));
      if (shared) current.chosen.push(number);
   }
   close();
   return JSON.stringify({ picks, caveats: [] });
}

/**
 * A case steers the stand-in through its `user_prompt`, which both box 5
 * prompts quote: `[replay: fail pick <source>]` fails that source's pick
 * call, `[replay: fail every pick]` fails them all, `[replay: order invalid]`
 * answers the ordering call with no kept source, and `[replay: order late]`
 * holds the ordering reply until the call is cut.
 */
function directives(prompt: string): string[] {
   return [...prompt.matchAll(/\[replay: ([^\]]+)\]/g)].map((m) => m[1]);
}

/** The source a pick prompt shows: the name on its `Source:` line. */
function pickSource(prompt: string): string | undefined {
   return /^Source: ([^\s]+)/m.exec(prompt)?.[1];
}

/**
 * The stand-in ordering call: the sources by how many of the targets'
 * content words their block (name, doc and the fields search found) holds,
 * most first; a tie keeps the order they were listed in.
 */
export function standInOrderReply(prompt: string): string {
   if (directives(prompt).includes("order invalid")) {
      return JSON.stringify({ sources: [99] });
   }
   const wanted = new Set<string>();
   for (const m of prompt.matchAll(/^ {2}[a-z_]+: (".*")$/gm)) {
      for (const w of contentWords(JSON.parse(m[1]) as string)) wanted.add(w);
   }
   const blocks = prompt
      .slice(prompt.indexOf("<sources>"), prompt.indexOf("</sources>"))
      .split(/^(?=\[\d+\] )/m)
      .filter((b) => /^\[\d+\] /.test(b));
   const scored = blocks.map((b, i) => ({
      n: Number(/^\[(\d+)\]/.exec(b)![1]),
      score: [...contentWords(b.replace(/_/g, " "))].filter((w) =>
         wanted.has(w),
      ).length,
      i,
   }));
   scored.sort((a, b) => b.score - a.score || a.i - b.i);
   return JSON.stringify({ sources: scored.map((s) => s.n) });
}

function replyFor(kind: ChatKind, prompt: string): string {
   switch (kind) {
      case "judge": {
         const said = directives(prompt);
         if (
            said.includes("fail every pick") ||
            said.includes(`fail pick ${pickSource(prompt)}`)
         ) {
            throw new Error(
               "replay stand-in: this pick call fails, as the case asks",
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
         // Fails the call, so a new kind of prompt shows up in a snapshot
         // as a failure rather than as a made-up answer.
         throw new Error(
            "replay stand-in: a chat prompt of a kind it does not recognize",
         );
   }
}

/** The chat model of the replay: real ChatModelImpl, rule replies. */
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
         if (
            kind === "order" &&
            directives(req.prompt).includes("order late")
         ) {
            // Never answers: the call is cut, ORDER_GRACE_MS after the picks.
            call.reply = JSON.stringify({ error: "cut before it answered" });
            await new Promise<never>((_, reject) => {
               const cut = () => reject(req.signal.reason);
               if (req.signal.aborted) cut();
               else req.signal.addEventListener("abort", cut, { once: true });
            });
         }
         try {
            call.reply = replyFor(kind, req.prompt);
         } catch (error) {
            call.reply = JSON.stringify({ error: (error as Error).message });
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
