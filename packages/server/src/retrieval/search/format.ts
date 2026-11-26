// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Box 6, format: box 5's sources, in its order, as the response's cards, in
 * the card shape a listing uses plus the blocks only a ranked answer has.
 * No outside system: the in-memory model only (and, for a value target on a
 * gated source, the query-time lookup with the caller's givens, so the gate
 * decides as it does for a query).
 *
 * - One card per source, in box 5's order. A source's card holds the fields
 *   its own call picked, each carrying that call's reason for each target it
 *   answers, best first, as {@link limitPicks} cuts them. A field reached
 *   through a join is a field of the source that joins it, with its join
 *   path.
 * - Values matched in the value index ride under their dimension as
 *   `values[]`, cut to the ones the call named.
 * - `clusters` has one entry per card: the source to query from, the targets
 *   it answers, its picks and its call's caveats. `coverage` (target by
 *   entry) is there when there are two or more entries, and
 *   `unresolved_targets` names a target no card answers.
 *
 * The size limit is the page's (pages.ts): the cards are paged in order, so
 * the last source is the first to move to the next page; a card too large
 * for a page alone loses fields from the end of a target's list first, never
 * a target's first field.
 */

import type { AccessIdentity } from "../../service/access_record";
import type { PackageLookup } from "../../service/environment_ports";
import type { ValueFetcher } from "./values";
import { matchValues } from "./value_match";
import {
   projectEntity,
   summaryViewFor,
   toSourceResults,
   type SourceCard,
} from "./response";
import { fieldPathOf, sourceContextKey } from "../model/package_entities";
import {
   type PackageIndex,
   type ResolvedRequest,
   type ResultEntity,
} from "../model/types";
import type { CatalogNode, CatalogSource } from "../model/catalog";
import type { Target } from "./find";
import type { FcjIndex } from "../index/index_build";
import type { Grouped } from "./group";
import type { RankedSource } from "./rerank";
import { keptValues } from "./judge";

/**
 * How many fields a pick keeps on a source after the first served one: its
 * best field and at most one more. The first served source keeps every field
 * its call picked, since a target often needs several fields of the one
 * source the query is written from.
 */
export const FIELDS_PER_PICK_AFTER_FIRST = 2;
/** Most fields one target returns over every source, in served order. */
export const FIELDS_PER_TARGET = 8;

/**
 * The fields box 6 returns, from box 5's picks: every pick of the first
 * served source (the first with a pick), each other source's picks cut to
 * {@link FIELDS_PER_PICK_AFTER_FIRST}, then each target cut to
 * {@link FIELDS_PER_TARGET}, filled in served-source order and the judge's
 * order within a source. Only fields of the source itself are kept. Pure.
 */
export function limitPicks(
   ranked: readonly RankedSource[],
   ownerOf: (key: string) => string | undefined,
): RankedSource[] {
   const perTarget = new Map<number, number>();
   const first = ranked.findIndex((r) =>
      r.picks.some((p) => p.keys.length > 0),
   );
   return ranked.map((r, i) => ({
      ...r,
      picks: [...r.picks]
         .sort((a, b) => a.target - b.target)
         .map((p) => {
            const own = p.keys.filter((k) => ownerOf(k) === r.source);
            const cut =
               i === first ? own : own.slice(0, FIELDS_PER_PICK_AFTER_FIRST);
            const used = perTarget.get(p.target) ?? 0;
            const keys = cut.slice(0, Math.max(0, FIELDS_PER_TARGET - used));
            perTarget.set(p.target, used + keys.length);
            return { ...p, keys };
         }),
   }));
}

/** A field path as the value lookup takes it: one name, or its segments. */
function dimensionOf(path: string[]): string | string[] {
   return path.length === 1 ? path[0] : path;
}

/** Distinct values the query-time lookup reads for a gated dimension. */
const GATED_LOOKUP_LIMIT = 2_000;
const GATED_LOOKUP_TIMEOUT_MS = 8_000;

/** Box 6's answer, before paging. */
export interface Formatted {
   /** Every card, in box 5's order. */
   sources: SourceCard[];
   clusters: unknown[];
   coverage?: unknown[];
   unresolved_targets: unknown[];
   warnings: string[];
}

/** The model path a source's card is built under: the request's, else the defining file's. */
function cardModelPath(
   source: CatalogSource,
   request: Pick<ResolvedRequest, "modelPath">,
): string {
   if (request.modelPath && source.modelPaths.includes(request.modelPath)) {
      return request.modelPath;
   }
   return source.modelPaths.includes(source.definedIn)
      ? source.definedIn
      : source.modelPaths[0];
}

function entityAt(node: CatalogNode, modelPath: string) {
   return (
      node.entities.find((e) => e.modelPath === modelPath) ?? node.entities[0]
   );
}

export interface FormatArgs {
   index: FcjIndex;
   request: ResolvedRequest;
   pkgIndex: PackageIndex;
   targets: readonly Target[];
   /** Box 4's answer: each kept source's hits, for their scores and values. */
   grouped: Grouped;
   /** Box 5's sources, in served order. */
   ranked: readonly RankedSource[];
   environmentStore: PackageLookup;
   /** The gated lookup: valueFetcherFor (the query path) in production, a stand-in in a spec. */
   valueFetcher: ValueFetcher;
   /** Aborted at the request's deadline: no gated lookup starts after it. */
   signal?: AbortSignal;
   /** Who asked, for the access record of each gated value lookup. */
   identity?: AccessIdentity;
}

/** Box 6. */
export async function format(args: FormatArgs): Promise<Formatted> {
   const { index, request, targets, grouped, ranked } = args;
   const warnings: string[] = [];
   const targetOf = new Map(targets.map((t) => [t.index, t]));
   // Published relevance: a hit's fused score over the best of the request,
   // so the scale runs from 0 to 1.
   const hitOf = new Map<
      string,
      Map<
         number,
         { score: number; values?: { value: string; score: number }[] }
      >
   >();
   let maxScore = 0;
   for (const g of grouped.sources) {
      for (const [t, offers] of g.offers) {
         for (const o of offers) {
            maxScore = Math.max(maxScore, o.hit.score);
            const byTarget = hitOf.get(o.hit.key) ?? new Map();
            byTarget.set(t, o.hit);
            hitOf.set(o.hit.key, byTarget);
         }
      }
   }
   const publish = (s: number) => (maxScore > 0 ? s / maxScore : 0);
   const rows = new Map<string, ResultEntity>();
   const order: string[] = [];
   const put = (
      key: string,
      row: ResultEntity,
      target: number,
      score: number,
      reason: string | undefined,
   ) => {
      const prev = rows.get(key);
      if (!prev) {
         row.targetScores = new Map([[target, score]]);
         row.score = score;
         row.rawScore = score;
         if (reason) row.targetReasons = new Map([[target, reason]]);
         rows.set(key, row);
         order.push(key);
         return;
      }
      prev.targetScores ??= new Map();
      prev.targetScores.set(
         target,
         Math.max(prev.targetScores.get(target) ?? 0, score),
      );
      prev.score = Math.max(prev.score ?? 0, score);
      prev.rawScore = prev.score;
      if (reason) {
         prev.targetReasons ??= new Map();
         prev.targetReasons.set(target, reason);
      }
      // Another target's matched values for the same field: keep both
      // targets', one per (value, searchText).
      if (row.values?.length) {
         const merged = [...(prev.values ?? [])];
         const seen = new Set(
            merged.map((v) => `${v.value}\u0000${v.searchText}`),
         );
         for (const v of row.values) {
            const k = `${v.value}\u0000${v.searchText}`;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(v);
         }
         prev.values = merged;
      }
   };

   const clusters: unknown[] = [];
   const covers: number[][] = [];
   const answered = new Set<number>();
   const limited = limitPicks(
      ranked,
      (key) => index.catalog.nodes.get(key)?.sourceKey,
   );
   for (const r of limited) {
      const source = index.catalog.sources.get(r.source);
      if (!source) continue;
      const mp = cardModelPath(source, request);
      const picks: Record<number, string[]> = {};
      for (const pick of r.picks) {
         const target = targetOf.get(pick.target);
         for (const key of pick.keys) {
            const node = index.catalog.nodes.get(key);
            if (!node) continue;
            const hits = hitOf.get(key);
            const hit =
               hits?.get(pick.target) ?? [...(hits?.values() ?? [])][0];
            const row: ResultEntity = {
               ...projectEntity(
                  entityAt(node, mp),
                  request.environmentName,
                  request.packageName,
               ),
               modelPath: mp,
            };
            const values = await valuesFor(
               args,
               node,
               source,
               target,
               hit?.values && keptValues(hit.values, pick.values?.[key]),
               warnings,
            );
            if (values.length > 0) row.values = values;
            put(
               `${node.sourceKey}\u0000${node.kind}\u0000${node.name}`,
               row,
               pick.target,
               publish(hit?.score ?? 0),
               pick.reason,
            );
            (picks[pick.target] ??= []).push(node.id);
            answered.add(pick.target);
         }
      }
      const covered = Object.keys(picks)
         .map(Number)
         .sort((a, b) => a - b);
      if (covered.length === 0) continue;
      covers.push(covered);
      clusters.push({
         query_from: { source: source.name, model_path: mp },
         sources: [{ source: source.name, joins: [] }],
         covers: covered,
         picks,
         ...(r.caveats.length > 0 ? { caveats: r.caveats } : {}),
      });
   }

   // Every card is built under one model path per source.
   const stored = new Map<
      string,
      { summary: string; oneLineSummary: string }
   >();
   for (const source of index.catalog.sources.values()) {
      const line = index.summaries.get(source.key);
      if (!line) continue;
      for (const mp of source.modelPaths) {
         stored.set(sourceContextKey(mp, source.name), {
            summary: line,
            oneLineSummary: line,
         });
      }
   }
   const cards = toSourceResults(
      order.map((k) => rows.get(k)!),
      args.pkgIndex.sourceContext,
      request.environmentName,
      request.packageName,
      new Map(targets.map((t) => [t.index, t.text])),
      request.includeCode,
      args.pkgIndex.droppedSources,
      summaryViewFor(stored, request, []),
   );
   const coverage =
      covers.length > 1
         ? targets.map((t) => ({
              target_index: t.index,
              search_text: t.text,
              clusters: covers.map((c) => c.includes(t.index)),
           }))
         : undefined;
   return {
      sources: cards,
      clusters,
      ...(coverage ? { coverage } : {}),
      unresolved_targets: targets
         .filter((t) => !answered.has(t.index))
         .map((t) => ({
            target_index: t.index,
            target_type: t.type,
            search_text: t.text,
         })),
      warnings,
   };
}

/** The stored values a dimension pick carries for a value target. */
async function valuesFor(
   args: Pick<
      FormatArgs,
      "request" | "environmentStore" | "valueFetcher" | "signal" | "identity"
   >,
   node: CatalogNode,
   owner: CatalogSource,
   target: Target | undefined,
   matched: ReadonlyArray<{ value: string; score: number }> | undefined,
   warnings: string[],
): Promise<Array<{ value: string; score: number; searchText: string }>> {
   if (!target || node.kind !== "dimension") return [];
   if (target.type !== "dimension" && target.type !== "dimensional_value")
      return [];
   const phrase = target.text;
   if (matched && matched.length > 0) {
      return matched
         .slice(0, 10)
         .map((v) => ({ value: v.value, score: v.score, searchText: phrase }));
   }
   // A field the description search offered for a value, whose values were
   // never read: say so, rather than let it read as holding the value.
   if (target.type === "dimensional_value" && !owner.gated && !node.indexed) {
      warnings.push(
         `${node.source}.${node.name} was offered for ${JSON.stringify(phrase)} by its description. Its values are not indexed (it is not tagged #(index)), so whether it holds that value was not checked; read its values with execute_query.`,
      );
      return [];
   }
   // A gated source's values are never in the shared index; a value target
   // asks the query path with the caller's givens instead.
   if (target.type !== "dimensional_value" || !owner.gated) return [];
   if (node.dataType && node.dataType !== "string") return [];
   const { request } = args;
   // Past the request's deadline nobody reads the answer: do not take a query slot.
   if (args.signal?.aborted) return [];
   try {
      const got = await args.valueFetcher({
         environmentStore: args.environmentStore,
         environmentName: request.environmentName,
         packageName: request.packageName,
         modelPath: cardModelPath(owner, request),
         source: node.source,
         // One name stays a string, as it always was; a path is a list.
         dimension: dimensionOf(fieldPathOf(node.entities[0] ?? node)),
         limit: GATED_LOOKUP_LIMIT,
         ...(request.givens ? { givens: request.givens } : {}),
         ...(request.filterParams
            ? { filterParams: request.filterParams }
            : {}),
         timeoutMs: GATED_LOOKUP_TIMEOUT_MS,
         ...(args.identity ? { identity: args.identity } : {}),
      });
      return matchValues(phrase, got.values).map((h) => ({
         value: h.value,
         score: h.score,
         searchText: phrase,
      }));
   } catch (error) {
      warnings.push(
         `The values of ${node.source}.${node.name} were not searched: ${(error instanceof Error ? error.message.slice(0, 200) : String(error)).replace(/\.+$/, "")}. The source has an access gate; send the givens it needs, or read its values with execute_query.`,
      );
      return [];
   }
}
