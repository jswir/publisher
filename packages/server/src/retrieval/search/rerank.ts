// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Box 5, rerank: the model (the box's one outside system) chooses, for each
 * kept source, which of the fields search found on it answer each target,
 * and puts the kept sources in order. It chooses and orders; it never adds a
 * field search did not find.
 *
 * - One PICK call per kept source, all started together (at most
 *   `retrieval.llm.concurrency` in flight), each shown that one source
 *   (judge.ts, renderPickPrompt). A source keeps its own call's picks and
 *   reasons.
 * - One ORDERING call, started with the picks when two or more sources are
 *   kept, shown every kept source's doc and what search found on it. Its
 *   reply orders the sources; a reply that is late, failed or unusable
 *   leaves box 4's order (judge.ts, orderSources).
 *
 * Bounded and degrading. Each pick call gets {@link PICK_ATTEMPTS} attempts
 * of {@link RerankBounds.attemptMs} under one stage deadline. A source whose
 * call fails or is late is left out of the result. If EVERY pick call fails,
 * the box serves each target's top few hits ({@link unjudged}) on box 4's
 * sources, with a warning ({@link DEGRADED_WARNING}): the request never fails here.
 * (Box 6's field limits apply to this answer too.)
 * The ordering call gets one attempt, and {@link ORDER_GRACE_MS} after the
 * last pick call ends before it is cut.
 *
 * With no model configured, or the package's `retrieval.fcj.judge: false`,
 * the box serves box 4's sources the same way, without the warning.
 */

import { DEFAULT_RETRY, type RetryPolicy } from "../../service/http_retry";
import type { ChatModel } from "../llm/types";
import type { FcjIndex } from "../index/index_build";
import type { Target } from "./find";
import type { Grouped, SourceGroup } from "./group";
import {
   judgeMaxTokens,
   judgeOptions,
   orderMaxTokens,
   orderSources,
   orderSystemPrompt,
   pickSystemPrompt,
   renderOrderPrompt,
   renderPickPrompt,
   validateOrder,
   validateVerdict,
   valueLabels,
   type JudgePick,
   type OrderOutcome,
} from "./judge";

/** Attempts one pick call gets. */
export const PICK_ATTEMPTS = 2;
/** How long one pick attempt may take with the default `retrieval.llm.timeoutMs`. */
export const PICK_ATTEMPT_MS = 6_000;
/** How long the ordering call may run on once every pick call has ended. */
export const ORDER_GRACE_MS = 300;
/** The stage deadline never passes this, so a request stays inside its own 90 s deadline. */
export const MAX_RERANK_DEADLINE_MS = 60_000;

/** The time box 5 may take. */
export interface RerankBounds {
   /** One pick attempt's limit. */
   attemptMs: number;
   /** The whole stage's limit: every pick call, and the ordering call. */
   deadlineMs: number;
   /** How long the ordering call may outlive the last pick call. */
   graceMs: number;
}

/**
 * The bounds under the operator's `retrieval.llm.timeoutMs` (one chat call's
 * limit, 30 s by default). An attempt may take a fifth of it, but never less
 * than {@link PICK_ATTEMPT_MS} and never more than the setting itself: 6 s
 * at the default, 24 s for a slow model given 120 s, 3 s at 3 s. The stage
 * deadline is two attempts' worth (12 s at the default), at most
 * {@link MAX_RERANK_DEADLINE_MS}.
 */
export function rerankBounds(timeoutMs: number): RerankBounds {
   const attemptMs = Math.min(
      timeoutMs,
      Math.max(PICK_ATTEMPT_MS, Math.round(timeoutMs / 5)),
   );
   return {
      attemptMs,
      deadlineMs: Math.min(MAX_RERANK_DEADLINE_MS, PICK_ATTEMPTS * attemptMs),
      graceMs: ORDER_GRACE_MS,
   };
}

/** Caller-visible: names no internal step, and says how to get what may be missing. */
export const DEGRADED_WARNING =
   "The final ranking step was unavailable, so these results are the top few search matches without it. If a field you need is missing, call get_context again with `scopes` set to its source and one target per missing concept.";

/** One attempt per call here: the attempts are this box's, not the client's retry ladder. */
const ONE_TRY: RetryPolicy = { ...DEFAULT_RETRY, maxAttempts: 1 };

/** One kept source as box 5 serves it. */
export interface RankedSource {
   source: string;
   /** Per target: the fields this source's call picked, best first, with its reason. */
   picks: JudgePick[];
   /** Its call's caveats. */
   caveats: string[];
}

/** One pick call, for the trace. */
export interface PickCall {
   source: string;
   outcome: "answered" | "failed";
   attempts: number;
   error?: string;
}

/** Box 5's answer. */
export interface Reranked {
   /** The sources in served order. A source whose call failed is left out. */
   sources: RankedSource[];
   /** `judged`: the calls chose; `unjudged`: no model; `degraded`: every pick call failed. */
   mode: "judged" | "unjudged" | "degraded";
   order: OrderOutcome;
   calls: PickCall[];
   warnings: string[];
}

/** How many of a target's top hits are served when no call chose, by target type. */
export const UNJUDGED_HITS: Readonly<Record<string, number>> = {
   measure: 2,
   dimension: 5,
};
const UNJUDGED_HITS_DEFAULT = 3;

/**
 * The answer when no call chose: each target's top few hits on the kept
 * sources ({@link UNJUDGED_HITS}, by search rank), each on its own source,
 * the sources in box 4's order.
 */
export function unjudged(
   grouped: Grouped,
   targets: readonly Target[],
): RankedSource[] {
   const top = new Map<number, Set<string>>();
   for (const t of targets) {
      const all = grouped.sources
         .flatMap((g) => g.offers.get(t.index) ?? [])
         .sort((a, b) => a.rank - b.rank)
         .slice(0, UNJUDGED_HITS[t.type] ?? UNJUDGED_HITS_DEFAULT);
      top.set(t.index, new Set(all.map((o) => o.hit.key)));
   }
   return grouped.sources.map((g) => ({
      source: g.source,
      picks: [...g.offers].map(([target, offers]) => ({
         target,
         keys: offers
            .map((o) => o.hit.key)
            .filter((k) => top.get(target)?.has(k)),
      })),
      caveats: [],
   }));
}

/** The targets one source's call is asked about: those it holds a hit for, in the Call's order. */
function targetsOf(group: SourceGroup, targets: readonly Target[]): Target[] {
   return targets.filter((t) => group.offers.has(t.index));
}

function errorText(error: unknown): string {
   return (error instanceof Error ? error.message : String(error)).slice(
      0,
      300,
   );
}

/** Box 5. Never throws for a model failure. */
export async function rerank(args: {
   index: FcjIndex;
   grouped: Grouped;
   targets: readonly Target[];
   /** The caller's `user_prompt`, read by both calls. */
   question?: string;
   /** The model; null means no call is made (no LLM, or the judge off). */
   chat: ChatModel | null;
   /** The package's own pick instructions (`retrieval.prompts.judge`). */
   instructions?: string;
   /** Most pick calls in flight at once. */
   concurrency: number;
   bounds: RerankBounds;
   /** The request's own signal: its deadline or the client's cancel. */
   signal?: AbortSignal;
}): Promise<Reranked> {
   const { index, grouped, targets, chat, bounds } = args;
   const groups = grouped.sources;
   if (!chat || groups.length === 0) {
      return {
         sources: unjudged(grouped, targets),
         mode: "unjudged",
         order: groups.length > 1 ? "box4" : "one_source",
         calls: [],
         warnings: [],
      };
   }
   const stage = new AbortController();
   const timer = setTimeout(
      () => stage.abort(new Error("the ranking step ran out of time")),
      bounds.deadlineMs,
   );
   const stageSignal = args.signal
      ? AbortSignal.any([args.signal, stage.signal])
      : stage.signal;

   // The ordering call: started with the picks, cut after the grace.
   const orderCut = new AbortController();
   const ordering: Promise<number[] | undefined> =
      groups.length > 1
         ? chat
              .completeJson({
                 system: orderSystemPrompt(),
                 prompt: renderOrderPrompt(
                    index,
                    groups,
                    targets,
                    args.question,
                 ),
                 maxTokens: orderMaxTokens(groups.length),
                 validate: validateOrder,
                 retry: ONE_TRY,
                 signal: AbortSignal.any([stageSignal, orderCut.signal]),
              })
              .then((r) => r.value)
              .catch(() => undefined)
         : Promise.resolve(undefined);

   const pickOne = async (
      group: SourceGroup,
   ): Promise<{ call: PickCall; ranked?: RankedSource }> => {
      const asked = targetsOf(group, targets);
      const options = judgeOptions(group, asked);
      const request = {
         system: pickSystemPrompt(asked, args.instructions),
         prompt: renderPickPrompt(index, group, asked, options, args.question),
         maxTokens: judgeMaxTokens(asked.length, options.length),
         validate: validateVerdict(
            asked,
            options,
            valueLabels(group, asked, options),
         ),
         retry: ONE_TRY,
      };
      let error: unknown;
      let attempts = 0;
      while (attempts < PICK_ATTEMPTS && !stageSignal.aborted) {
         attempts += 1;
         try {
            const reply = await chat.completeJson({
               ...request,
               signal: AbortSignal.any([
                  stageSignal,
                  AbortSignal.timeout(bounds.attemptMs),
               ]),
            });
            return {
               call: { source: group.source, outcome: "answered", attempts },
               ranked: { source: group.source, ...reply.value },
            };
         } catch (e) {
            error = e;
         }
      }
      return {
         call: {
            source: group.source,
            outcome: "failed",
            attempts,
            error: errorText(error ?? stageSignal.reason),
         },
      };
   };

   let results: Array<{ call: PickCall; ranked?: RankedSource }>;
   let reply: number[] | undefined;
   try {
      results = await pool(groups, Math.max(1, args.concurrency), pickOne);
      reply = await Promise.race([
         ordering,
         new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), bounds.graceMs),
         ),
      ]);
   } finally {
      clearTimeout(timer);
      orderCut.abort(new Error("the ordering call was cut after the picks"));
   }
   const calls = results.map((r) => r.call);
   const answered = new Map(
      results.flatMap((r) => (r.ranked ? [[r.ranked.source, r.ranked]] : [])),
   );
   if (answered.size === 0) {
      return {
         sources: unjudged(grouped, targets),
         mode: "degraded",
         order: "box4",
         calls,
         warnings: [DEGRADED_WARNING],
      };
   }
   const { order, outcome } = orderSources(
      groups.map((g) => g.source),
      reply,
   );
   return {
      sources: order.flatMap((s) => answered.get(s) ?? []),
      mode: "judged",
      order: outcome,
      calls,
      warnings: [],
   };
}

/** `fn` over `items`, at most `concurrency` at a time, results in item order. `fn` must not throw. */
async function pool<T, R>(
   items: readonly T[],
   concurrency: number,
   fn: (item: T) => Promise<R>,
): Promise<R[]> {
   const out = new Array<R>(items.length);
   let next = 0;
   const worker = async () => {
      while (next < items.length) {
         const i = next++;
         out[i] = await fn(items[i]);
      }
   };
   await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, worker),
   );
   return out;
}
