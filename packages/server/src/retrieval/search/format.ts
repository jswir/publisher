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
 *   it answers, its picks and its call's caveats (a caveat, or a field's
 *   reason, that names a field search offered and no card serves is
 *   dropped: {@link servedCaveats}). `coverage` (target by
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
import { PERIOD_TARGET, type Grouped } from "./group";
import type { RankedSource } from "./rerank";
import { keptValues } from "./judge";
import { fieldOf, type Field } from "./fields";

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
   const own = (r: RankedSource, keys: readonly string[]) =>
      keys.filter((k) => ownerOf(k) === r.source);
   // The first served card: the first source with a field placed on its
   // own card for a target of the Call.
   const first = ranked.findIndex((r) =>
      r.picks.some(
         (p) => p.target !== PERIOD_TARGET && own(r, p.keys).length > 0,
      ),
   );
   const perTarget = new Map<number, number>();
   return ranked.map((r, i) => ({
      ...r,
      picks: [...r.picks]
         .sort((a, b) => a.target - b.target)
         .map((p) => {
            const mine = own(r, p.keys);
            if (p.target === PERIOD_TARGET) {
               return { ...p, keys: mine.slice(0, PERIOD_FIELDS_PER_SOURCE) };
            }
            const cut =
               i === first ? mine : mine.slice(0, FIELDS_PER_PICK_AFTER_FIRST);
            const used = perTarget.get(p.target) ?? 0;
            const keys = cut.slice(0, Math.max(0, FIELDS_PER_TARGET - used));
            perTarget.set(p.target, used + keys.length);
            return { ...p, keys };
         }),
   }));
}

/** Most date fields one source returns for a period the question names. */
export const PERIOD_FIELDS_PER_SOURCE = 1;
/** The mark on a date field returned for a period the question names. */
export const PERIOD_FIELD_REASON =
   "A date or time field of this source, returned because the question names a period.";

/**
 * The caveats (or reasons) that name none of `unserved`: a caveat never
 * points at a field the response does not carry. A name matches as a whole
 * name, so `state` does not match inside `customers.state`.
 */
export function servedCaveats(
   caveats: readonly string[],
   unserved: ReadonlySet<string>,
): string[] {
   if (unserved.size === 0) return [...caveats];
   return caveats.filter((c) => ![...unserved].some((n) => namesField(c, n)));
}

/** Whether `text` names the field `name` as a whole name. */
function namesField(text: string, name: string): boolean {
   return new RegExp(
      `(^|[^A-Za-z0-9_.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`,
   ).test(text);
}

/**
 * The names a field goes by in a caveat or a reason: its name on the card
 * and, for a field reached through a join, its own short name.
 */
function namesOf(field: Field): string[] {
   return field.joined || field.joinPath
      ? [field.name, field.node.name]
      : [field.name];
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

/** The sentence a field reached through a join carries. */
export function populationNote(home: string, path: string): string {
   return `Reached from ${home} through ${path}, a left join: a ${home} row with no match keeps a null here, so grouping or counting by it follows ${home}'s rows.`;
}

/**
 * A field of another source reached through the card's source's joins, as
 * the card shows it: under its dotted path, with the join path, the join's
 * relationship and the population sentence. Never carries values: a value
 * was matched on the field's own source.
 */
function joinedRow(
   field: Field,
   source: CatalogSource,
   modelPath: string,
   request: ResolvedRequest,
): ResultEntity {
   const node = field.node;
   const note = populationNote(source.name, field.joinPath ?? "");
   return {
      kind: node.kind,
      name: field.name,
      source: source.name,
      environmentName: request.environmentName,
      packageName: request.packageName,
      modelPath,
      doc: node.displayDoc ? `${node.displayDoc} ${note}` : note,
      ...(node.doc ? { embedDoc: node.doc } : {}),
      ...(node.docSource ? { docSource: node.docSource } : {}),
      ...(field.joinPath ? { joinPath: field.joinPath } : {}),
      ...(field.relationship ? { relationship: field.relationship } : {}),
      ...(node.dataType ? { dataType: node.dataType } : {}),
      ...(node.code ? { code: node.code } : {}),
   };
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
   /** Every name a served field goes by, on any card. */
   const servedNames = new Set<string>();
   const answered = new Set<number>();
   const limited = limitPicks(
      ranked,
      (key) => fieldOf(index.catalog, key)?.sourceKey,
   );
   for (const r of limited) {
      const source = index.catalog.sources.get(r.source);
      if (!source) continue;
      const mp = cardModelPath(source, request);
      const picks: Record<number, string[]> = {};
      const joins = new Set<string>();
      const periodKeys: string[] = [];
      for (const pick of r.picks) {
         if (pick.target === PERIOD_TARGET) {
            periodKeys.push(...pick.keys);
            continue;
         }
         const target = targetOf.get(pick.target);
         for (const key of pick.keys) {
            const field = fieldOf(index.catalog, key);
            if (!field) continue;
            const node = field.node;
            const hits = hitOf.get(key);
            const hit =
               hits?.get(pick.target) ?? [...(hits?.values() ?? [])][0];
            if (field.joined) {
               put(
                  `${field.sourceKey}\u0000${node.kind}\u0000${field.name}`,
                  joinedRow(field, source, mp, request),
                  pick.target,
                  publish(hit?.score ?? 0),
                  pick.reason,
               );
            } else {
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
            }
            (picks[pick.target] ??= []).push(field.id);
            if (field.joinPath) joins.add(field.joinPath);
            answered.add(pick.target);
         }
      }
      const covered = Object.keys(picks)
         .map(Number)
         .sort((a, b) => a - b);
      if (covered.length === 0) continue;
      // A date field for the period the question names, on a card that
      // answers a target: marked, and no target's pick.
      for (const key of periodKeys) {
         const node = index.catalog.nodes.get(key);
         const rowKey =
            node && `${node.sourceKey}\u0000${node.kind}\u0000${node.name}`;
         if (!node || !rowKey || rows.has(rowKey)) continue;
         rows.set(rowKey, {
            ...projectEntity(
               entityAt(node, mp),
               request.environmentName,
               request.packageName,
            ),
            modelPath: mp,
            alsoLikely: PERIOD_FIELD_REASON,
         });
         order.push(rowKey);
      }
      for (const key of [...periodKeys, ...r.picks.flatMap((p) => p.keys)]) {
         const field = fieldOf(index.catalog, key);
         if (field) for (const n of namesOf(field)) servedNames.add(n);
      }
      covers.push(covered);
      clusters.push({
         query_from: { source: source.name, model_path: mp },
         sources: [{ source: source.name, joins: [...joins].sort() }],
         covers: covered,
         picks,
         ...(r.caveats.length > 0 ? { caveats: r.caveats } : {}),
      });
   }

   // A caveat or a reason that names a field search offered, or a call
   // picked, that no card serves is dropped: it would point at a field the
   // response does not carry.
   const unserved = new Set<string>();
   for (const key of [
      ...grouped.sources.flatMap((g) => [
         ...[...g.offers.values()].flat().map((o) => o.hit.key),
         ...(g.periodDates ?? []),
      ]),
      ...ranked.flatMap((r) => r.picks.flatMap((p) => p.keys)),
   ]) {
      const field = fieldOf(index.catalog, key);
      if (!field) continue;
      for (const n of namesOf(field)) if (!servedNames.has(n)) unserved.add(n);
   }
   for (const c of clusters as Array<{ caveats?: string[] }>) {
      if (!c.caveats) continue;
      const kept = servedCaveats(c.caveats, unserved);
      if (kept.length > 0) c.caveats = kept;
      else delete c.caveats;
   }
   for (const row of rows.values()) {
      for (const [target, reason] of row.targetReasons ?? []) {
         if (servedCaveats([reason], unserved).length === 0) {
            row.targetReasons!.delete(target);
         }
      }
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
