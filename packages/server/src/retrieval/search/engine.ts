// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * A ranked get_context call: the only engine for a request with search text.
 * A listing (no search text) is answered from the package's entity index in
 * get_context_tool.ts.
 *
 * The call passes through six boxes, in order ({@link runBoxes}). Each reads
 * one value and returns one, and talks to at most one outside system:
 *
 *   1. authorize       the Call and the caller -> the scope, the package's
 *                      model, the stored-value filter (authorize.ts)
 *   2. build queries   targets -> one Query per target, one embedding call
 *                      (queries.ts)
 *   3. search          Queries -> each target's Hits, from the index (find.ts)
 *   4. group by source Hits -> the kept sources, at most seven, each with
 *                      the fields it offers each target (group.ts)
 *   5. rerank          kept sources + the question -> the sources in order,
 *                      each with the fields its own call picked (rerank.ts)
 *   6. format          ordered sources -> the response cards (format.ts),
 *                      paged (pages.ts)
 *
 * Each box is timed: one row per box in the trace (the
 * `X-Publisher-Retrieval-Trace: summary` header, or `mcp.trace=retrieval`
 * in the log; `full` adds what each box kept) and one value of the
 * `publisher_get_context_box_duration_ms` histogram.
 *
 * The boxes return the complete result, and only the response is paged
 * (pages.ts): a result longer than one page carries `next_offset`, and a
 * call with the same arguments and that `offset` gets the next page of the
 * same held result, with no box run again. When the held result is gone
 * (held 10 minutes, or the index was rebuilt), the boxes run again and a
 * warning says the page is from a new run.
 */

import type {
   CatalogDatabase,
   EnvironmentPeek,
   PackageLookup,
} from "../../service/environment_ports";
import { logger } from "../../logger";
import { settings } from "../../settings";
import { LlmMeter } from "../llm/llm_calls";
import type { ChatModel } from "../llm/types";
import { embeddingConfigured } from "../llm/embedding_provider";
import { skillsFor } from "./response";
import {
   searchAnswer,
   searchFailure,
   type SearchResult,
   type PackageIndex,
   type ResolvedRequest,
} from "../model/types";
import { fcjStateOf, kickFcjBuild } from "../index/engine_state";
import type { AccessIdentity } from "../../service/access_record";
import type { FcjIndex } from "../index/index_build";
import type { RetrievalRegistry } from "../registry";
import { FCJ_RESULT_TTL_MS, type HeldResult } from "./held_results";
import { FCJ_MAX_CHARS, FCJ_RESERVE_CHARS, pageAt, resultKey } from "./pages";
import { valueFetcherFor } from "./values";
import { routesOf } from "./routes";
import { authorize, targetsOf } from "./authorize";
import { buildQueries } from "./queries";
import { search, type Hits } from "./find";
import { groupBySource, type Grouped } from "./group";
import { rerank, rerankBounds, type Reranked } from "./rerank";
import { format } from "./format";
import {
   recordGetContextBox,
   type GetContextBox,
} from "../../get_context_metrics";
import { DEFAULT_LLM_TIMEOUT_MS } from "../defaults";

export type TraceMode = "none" | "summary" | "full";

/**
 * `PUBLISHER_MCP_TRACE=retrieval` writes each ranked call's box rows to the
 * server log, one line per call, and adds nothing to any response.
 */
function traceToLog(): boolean {
   return settings.get("mcp.trace") === "retrieval";
}

/** One row of the trace: one box. */
interface StageRow {
   name: GetContextBox;
   status: "ran" | "skipped" | "failed";
   ms: number;
   in: number;
   out: number;
   llm_calls: number;
   tokens: { input: number; output: number };
}

/** How long one get_context search may run before its targets are answered as unresolved. */
const FCJ_REQUEST_DEADLINE_MS = 90_000;
export type FcjQueryArgs = {
   /** Aborted when the deadline passes or the client cancels; set by runFcjQuery. */
   signal?: AbortSignal;
   /** Aborted when the MCP client cancels the call. */
   clientSignal?: AbortSignal;
   request: ResolvedRequest;
   /** Retrieval's state: index builds, held pages, the chat model, value lookups. */
   registry: RetrievalRegistry;
   environmentStore: PackageLookup & Partial<EnvironmentPeek>;
   /** Where a search that starts an index build has it write. */
   catalog: CatalogDatabase;
   pkgIndex: PackageIndex;
   warnings: string[];
   traceMode: TraceMode;
   /** Who asked, for the access record of each gated value lookup. */
   identity?: AccessIdentity;
};

/**
 * Answer a ranked request within {@link FCJ_REQUEST_DEADLINE_MS}. A search
 * that runs out of time answers every target as unresolved, with a warning
 * naming the narrower scope to retry with; it never falls back to a cheaper
 * search. At the deadline, or when the client cancels the call, the search is
 * aborted: its model calls are cancelled and no gated value lookup starts, so
 * a client's retry does not queue behind work nobody will read. (The
 * embedding of the search text and a lookup already running finish on their
 * own.)
 */
export async function runFcjQuery(args: FcjQueryArgs): Promise<SearchResult> {
   // Already cancelled: start no search for an answer nobody reads.
   if (args.clientSignal?.aborted) return cancelledResult(args);
   const ms = args.registry.searchDeadlineMs ?? FCJ_REQUEST_DEADLINE_MS;
   const controller = new AbortController();
   const search = runFcjSearch({ ...args, signal: controller.signal });
   // Once it is abandoned nobody awaits it; a later failure is not unhandled.
   search.catch(() => undefined);
   let timer: ReturnType<typeof setTimeout> | undefined;
   const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), ms);
   });
   const client = args.clientSignal;
   let onCancel: (() => void) | undefined;
   const cancelled = new Promise<"cancelled">((resolve) => {
      onCancel = () => resolve("cancelled");
      if (client?.aborted) onCancel();
      else client?.addEventListener("abort", onCancel, { once: true });
   });
   let out: Awaited<typeof search> | "late" | "cancelled";
   try {
      out = await Promise.race([search, late, cancelled]);
      if (out !== "late" && out !== "cancelled") return out;
   } finally {
      clearTimeout(timer);
      if (onCancel) client?.removeEventListener("abort", onCancel);
   }
   if (out === "cancelled") {
      controller.abort(new Error("the get_context call was cancelled"));
      return cancelledResult(args);
   }
   controller.abort(new Error("the get_context search ran out of time"));
   return unansweredResult(
      args,
      `The search ran out of time after ${ms / 1000} seconds, so no target was answered. Search again with a narrower scope: name the source in scopes[].source, and for a value its field in scopes[].entity_name, or send fewer targets.`,
   );
}

function cancelledResult(args: FcjQueryArgs): SearchResult {
   return unansweredResult(
      args,
      "The call was cancelled before the search finished, so no target was answered.",
   );
}

/** Every target answered as unresolved, with `warning` saying why. */
function unansweredResult(args: FcjQueryArgs, warning: string): SearchResult {
   const state = fcjStateOf(args.registry, args.pkgIndex.pkg);
   const index = state?.status === "ready" ? state.index : undefined;
   return searchAnswer({
      sources: [],
      ranking: "relevance" as const,
      total_available: 0,
      returned: 0,
      retrieval:
         index && index.vectors.size > 0
            ? ("semantic" as const)
            : ("lexical" as const),
      clusters: [],
      unresolved_targets: targetsOf(args.request).map((t) => ({
         target_index: t.index,
         target_type: t.type,
         search_text: t.text,
      })),
      ...skillsFor({ pkgIndex: args.pkgIndex }),
      warnings: [...args.warnings, warning],
   });
}

/** The hits' part of the full trace. */
export function hitsTrace(index: FcjIndex, hits: readonly Hits[]) {
   return hits.map((r) => ({
      target_index: r.target.index,
      target_type: r.target.type,
      text: r.target.text,
      lists: r.lists,
      value_phrases: r.valuePhrases,
      ...(r.meaningPhrases.length > 0
         ? { meaning_phrases: r.meaningPhrases }
         : {}),
      candidates: r.candidates.map((c, rank) => {
         const node = index.catalog.nodes.get(c.key)!;
         return {
            rank: rank + 1,
            id: node.id,
            key: c.key,
            score: Math.round(c.score * 1e6) / 1e6,
            ranks: c.ranks,
            ...(c.cosine !== undefined
               ? { cosine: c.cosine, facet: c.facet }
               : {}),
            ...(c.bm25 !== undefined ? { bm25: c.bm25 } : {}),
            ...(c.values
               ? { values: c.values.slice(0, 3).map((v) => v.value) }
               : {}),
            routes: routesOf(index.catalog, node),
         };
      }),
   }));
}

/** A box's row: timed from `started`, recorded in the histogram. */
function row(
   name: GetContextBox,
   started: number,
   counts: Partial<Omit<StageRow, "name" | "ms">> = {},
): StageRow {
   const ms = Math.round(performance.now() - started);
   recordGetContextBox(name, ms);
   return {
      name,
      status: counts.status ?? "ran",
      ms,
      in: counts.in ?? 0,
      out: counts.out ?? 0,
      llm_calls: counts.llm_calls ?? 0,
      tokens: counts.tokens ?? { input: 0, output: 0 },
   };
}

/** The search's request first, then the held page, then the six boxes. */
async function runFcjSearch(args: FcjQueryArgs): Promise<SearchResult> {
   const { request, registry, pkgIndex, traceMode } = args;
   const pkg = pkgIndex.pkg;
   // Starts a build when there is none, and on a ready index rebuilds one
   // whose value reads failed once its cool-down is over; otherwise a no-op.
   kickFcjBuild({
      registry,
      environmentStore: args.environmentStore,
      catalog: args.catalog,
      environmentName: request.environmentName,
      packageName: request.packageName,
      pkg,
   });
   const state = fcjStateOf(registry, pkg);
   const held = registry.heldResults;
   const key = resultKey(request);
   const leading = [...args.warnings];
   if (request.offset > 0 && state?.status === "ready") {
      const kept = held.get(key, state.index);
      if (kept) {
         return pageResponse({
            pkgIndex,
            result: kept,
            request,
            leading,
            traceMode,
         });
      }
      leading.push(
         `No held result matched this offset, so the search ran again. A result is held for ${FCJ_RESULT_TTL_MS / 60_000} minutes, for the same arguments and givens only. This page is from the new run and can differ from pages you already have; for a consistent set, start again without offset.`,
      );
   }
   return runBoxes({ ...args, warnings: leading }, key);
}

/** The six boxes, in order. */
async function runBoxes(
   args: FcjQueryArgs,
   key: string,
): Promise<SearchResult> {
   const { request, registry, pkgIndex, traceMode } = args;
   const stages: StageRow[] = [];

   // 1. Authorize.
   let started = performance.now();
   const auth = await authorize({
      request,
      pkgIndex,
      state: fcjStateOf(registry, pkgIndex.pkg),
      warnings: args.warnings,
   });
   if ("refusal" in auth) {
      row("authorize", started, { status: "failed" });
      return auth.refusal;
   }
   const { index, targets, allow, callerKey } = auth;
   stages.push(
      row("authorize", started, { in: targets.length, out: targets.length }),
   );

   // 2. Build queries.
   started = performance.now();
   let queries;
   try {
      queries = await buildQueries({
         targets,
         provider: embeddingConfigured() ? index.provider : null,
      });
   } catch (error) {
      row("queries", started, { status: "failed" });
      logger.warn("[get_context] The search text could not be embedded", {
         error: error instanceof Error ? error.message : String(error),
      });
      return searchFailure(
         {
            message: `The embedding provider failed to embed the search text: ${error instanceof Error ? error.message : String(error)}`,
            suggestions: ["Try again in a minute."],
         },
         {
            sources: [],
            retrieval: "error",
            retrieval_reason: "provider-error",
         },
      );
   }
   const embedded = queries.some((q) => q.vector !== undefined);
   stages.push(
      row("queries", started, { in: targets.length, out: queries.length }),
   );

   // 3. Search.
   started = performance.now();
   const values = auth.settings.values;
   const hits = search({
      index,
      queries,
      allow,
      values,
      valueMeaning: values && auth.settings.valueEmbeddings,
      callerKey,
      pinned: request.entityName !== undefined,
   });
   stages.push(
      row("search", started, {
         in: queries.length,
         out: hits.reduce((n, r) => n + r.candidates.length, 0),
      }),
   );

   // 4. Group by source.
   started = performance.now();
   const grouped = groupBySource({ index, hits });
   stages.push(
      row("group", started, {
         in: hits.reduce((n, r) => n + r.candidates.length, 0),
         out: grouped.sources.length,
      }),
   );

   // 5. Rerank.
   started = performance.now();
   const llm = registry.chat;
   const llmSettings = llm.settings();
   const meter = new LlmMeter(llmSettings?.maxCallsPerRequest ?? null);
   const chat =
      auth.settings.judge !== false && llmSettings
         ? judgeModel(registry)
         : null;
   const reranked = await rerank({
      index,
      grouped,
      targets,
      ...(request.userPrompt ? { question: request.userPrompt } : {}),
      chat: chat ? meter.wrap(chat) : null,
      ...(auth.instructions ? { instructions: auth.instructions } : {}),
      concurrency: Math.max(1, llmSettings?.concurrency ?? 1),
      bounds: rerankBounds(llmSettings?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS),
      ...(args.signal ? { signal: args.signal } : {}),
   });
   const used = meter.snapshot();
   stages.push(
      row("rerank", started, {
         status:
            reranked.mode === "unjudged"
               ? "skipped"
               : reranked.mode === "degraded"
                 ? "failed"
                 : "ran",
         in: grouped.sources.length,
         out: reranked.sources.length,
         llm_calls: used.calls,
         tokens: { input: used.inputTokens, output: used.outputTokens },
      }),
   );

   // 6. Format.
   started = performance.now();
   const answer = await format({
      index,
      request,
      pkgIndex,
      targets,
      grouped,
      ranked: reranked.sources,
      environmentStore: args.environmentStore,
      valueFetcher: valueFetcherFor(registry),
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.identity ? { identity: args.identity } : {}),
   });
   const result: HeldResult = {
      cards: answer.sources,
      // Embedding closeness ranked only if the targets were embedded and the
      // index has vectors to compare them with.
      retrieval: embedded && index.vectors.size > 0 ? "semantic" : "lexical",
      clusters: answer.clusters,
      ...(answer.coverage ? { coverage: answer.coverage } : {}),
      unresolved_targets: answer.unresolved_targets,
      warnings: [
         ...auth.warnings,
         ...reranked.warnings,
         ...answer.warnings,
         ...(answer.unresolved_targets.length > 0
            ? [
                 `No source in this package answered ${answer.unresolved_targets.length} target(s); see unresolved_targets. Rephrase them, ask the user, or answer without them.`,
              ]
            : []),
      ],
   };
   return pageResponse({
      pkgIndex,
      result,
      request,
      leading: args.warnings,
      traceMode,
      stages,
      formatStarted: started,
      formatIn: reranked.sources.length,
      // Held only when there is a page to come back for.
      hold: (paged) => {
         if (paged) registry.heldResults.set(key, index, result);
      },
      ...(traceMode === "full"
         ? {
              full: {
                 fcj: fullTrace({ index, hits, grouped, reranked, chat }),
              },
           }
         : {}),
   });
}

/** The chat model box 5 asks, or null when the client cannot be built (box 5 then serves search's order). */
function judgeModel(registry: RetrievalRegistry): ChatModel | null {
   try {
      return registry.chat.model();
   } catch (error) {
      logger.warn("[get_context] The LLM client could not be built", {
         error: error instanceof Error ? error.message : String(error),
      });
      return null;
   }
}

/** The `full` trace's block: what each box kept. */
function fullTrace(t: {
   index: FcjIndex;
   hits: Hits[];
   grouped: Grouped;
   reranked: Reranked;
   chat: ChatModel | null;
}) {
   const { index, hits, grouped, reranked, chat } = t;
   const id = (k: string) => index.catalog.nodes.get(k)?.id ?? k;
   const name = (s: string) => index.catalog.sources.get(s)?.name ?? s;
   return {
      search: hitsTrace(index, hits),
      group: {
         kept: grouped.sources.map((g) => ({
            source: name(g.source),
            score: Math.round(g.score * 1e6) / 1e6,
            offers: Object.fromEntries(
               [...g.offers].map(([target, offers]) => [
                  target,
                  offers.map((o) => ({ rank: o.rank, id: id(o.hit.key) })),
               ]),
            ),
         })),
         unresolved: grouped.unresolved,
      },
      ...(chat ? { judge_model: `${chat.provider}/${chat.model}` } : {}),
      rerank: {
         mode: reranked.mode,
         order: reranked.order,
         calls: reranked.calls.map((c) => ({ ...c, source: name(c.source) })),
         sources: reranked.sources.map((s) => ({
            source: name(s.source),
            picks: s.picks.map((p) => ({
               target_index: p.target,
               ids: p.keys.map(id),
               ...(p.reason ? { reason: p.reason } : {}),
            })),
            caveats: s.caveats,
         })),
      },
   };
}

/**
 * One page of a complete result, in the card shape of a listing plus
 * `next_offset` when more pages remain. `total_available` counts every card
 * of the result. The clusters, coverage and unresolved targets describe the
 * whole result and ride on every page. A page served from a held result
 * runs no box but this one, so its trace has only the format row.
 */
function pageResponse(args: {
   pkgIndex: PackageIndex;
   result: HeldResult;
   request: ResolvedRequest;
   /** The request's warnings, ahead of the result's own. */
   leading: string[];
   traceMode: TraceMode;
   stages?: StageRow[];
   /** When box 6 started, so its row covers formatting and paging. */
   formatStarted?: number;
   formatIn?: number;
   full?: unknown;
   hold?: (paged: boolean) => void;
}): SearchResult {
   const { result, request, traceMode } = args;
   const started = args.formatStarted ?? performance.now();
   const total = result.cards.length;
   const page = pageAt(result.cards, request.offset, {
      maxChars: FCJ_MAX_CHARS,
      reserveChars: FCJ_RESERVE_CHARS,
      limit: request.limit,
   });
   args.hold?.(page.nextOffset !== undefined);
   const stages: StageRow[] = [
      ...(args.stages ?? []),
      row("format", started, {
         in: args.formatIn ?? total,
         out: page.cards.length,
      }),
   ];
   const first = request.offset + 1;
   const last = request.offset + page.cards.length;
   const warnings = [
      ...args.leading,
      ...result.warnings,
      ...(page.nextOffset !== undefined
         ? [
              `This page holds sources ${first} to ${last} of ${total}; nothing was cut from the result. For the rest, call get_context again with the same arguments and offset: ${page.nextOffset} (next_offset), until a response has no next_offset.`,
           ]
         : []),
      ...(request.offset > 0 && page.cards.length === 0
         ? [
              `offset ${request.offset} is past the end of this result, which has ${total} source(s).`,
           ]
         : []),
      ...(page.dropped > 0
         ? [
              `One source card is larger than a page by itself, so its last ${page.dropped} field(s) were left out; each target's first field is still on it. To see more, call get_context again with scopes[].source naming that source and one target per concept.`,
           ]
         : []),
      ...(page.trimmed > 0
         ? [
              `One source card is larger than a page by itself, so ${page.trimmed} of its descriptions were shortened (marked …).${page.oversized ? ` It is still over ${FCJ_MAX_CHARS} characters.` : ""}`,
           ]
         : []),
   ];
   if (traceToLog()) {
      logger.info("[MCP Tool getContext] Retrieval trace", {
         environmentName: request.environmentName,
         packageName: request.packageName,
         retrieval_trace: { engine: "fcj", stages },
      });
   }
   return searchAnswer({
      sources: page.cards,
      ranking: "relevance" as const,
      total_available: total,
      returned: page.cards.length,
      ...(page.nextOffset !== undefined
         ? { next_offset: page.nextOffset }
         : {}),
      retrieval: result.retrieval,
      engine: "fcj",
      clusters: result.clusters,
      ...(result.coverage ? { coverage: result.coverage } : {}),
      unresolved_targets: result.unresolved_targets,
      ...skillsFor({ pkgIndex: args.pkgIndex }),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(traceMode !== "none"
         ? { retrieval_trace: { engine: "fcj", stages } }
         : {}),
      ...(traceMode === "full" && args.full
         ? { retrieval_trace_full: args.full }
         : {}),
   });
}
