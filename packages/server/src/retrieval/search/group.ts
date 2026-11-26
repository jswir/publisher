// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Box 4, group by source: every target's hits grouped by the source that
 * holds them, and the few most likely sources KEPT. Pure: no model call, no
 * I/O.
 *
 * A source, with the fields its joins reach, is one domain a query is written
 * in, and nearly every request is answered by one source. The keep rule reads
 * only the targets' hits, never the question:
 *
 * - each target scores a source 1 / rank of that target's best hit on it
 *   (rank in the target's fused list, from 1); a source's score is the sum
 *   over the targets;
 * - the source of each target's top hit is kept first, then the rest by
 *   score, up to {@link KEPT_SOURCES};
 * - ties go to the source seen first: by target in the Call's order, then by
 *   rank in that target's list, then by source key.
 *
 * A source target's hit (the source itself) counts toward its source like any
 * other hit. A request scoped to one source has hits on that source only, so
 * it keeps that one source and there is nothing to rank.
 *
 * What a kept source offers each target is its own hits, and the hits on
 * the sources its joins reach (at most {@link JOIN_REACH_DEPTH} joins), as
 * the field under the path a query from it types (`customers.state` on
 * `order_items`). Those are fields search found, read through the model's
 * join graph, not a second search: a source reached only through a join
 * needs no slot of its own for its fields to be offered, and the keep rule
 * reads only each source's own hits. A field is offered through a join only
 * when the model holds it there as a field the scope admits.
 *
 * When the question or a target names a period (a year, a month, "monthly",
 * ...), each kept source also offers its own date and time dimensions for
 * an implicit target, {@link PERIOD_TARGET}; with no period named it offers
 * none.
 */

import type { FcjIndex } from "../index/index_build";
import { nodeKeyOf, type CatalogNode } from "../model/catalog";
import { joinedKey } from "./fields";
import type { Hit, Hits } from "./find";

/** Most sources kept per request. */
export const KEPT_SOURCES = 7;
/** Deepest join chain through which a kept source offers another source's field. */
export const JOIN_REACH_DEPTH = 3;
/** The implicit target a period in the question asks a date field for. */
export const PERIOD_TARGET = -1;
/** Data types a period's date field has. */
const DATE_TYPES = new Set(["date", "timestamp", "timestamptz"]);
const PERIOD_WORDS = new Set([
   "year",
   "yearly",
   "annual",
   "annually",
   "quarter",
   "quarterly",
   "month",
   "monthly",
   "week",
   "weekly",
   "day",
   "daily",
   "hour",
   "hourly",
   "date",
   "dates",
   "ytd",
   "mtd",
   "trend",
   "season",
   "seasonal",
   "seasonality",
   "january",
   "february",
   "march",
   "april",
   "june",
   "july",
   "august",
   "september",
   "october",
   "november",
   "december",
]);

/** Whether a text names a period: a period word, or a year from 1900 to 2099. */
export function namesPeriod(text: string): boolean {
   return (
      (text.toLowerCase().match(/[a-z]+/g) ?? []).some(
         (w) => PERIOD_WORDS.has(w) || PERIOD_WORDS.has(w.replace(/s$/, "")),
      ) || /\b(19|20)\d{2}\b/.test(text)
   );
}

/** One hit as a kept source offers it: the hit and its rank in its target's list. */
export interface Offer {
   /** The field as this source offers it: its own, or its joined copy here. */
   hit: Hit;
   /** 1-based rank in the target's whole hit list (the reached field's, for a joined one). */
   rank: number;
   /** Offered through a join: the key of the field search found on the joined source. */
   via?: string;
}

/** A kept source and the fields it offers each target, in search order. */
export interface SourceGroup {
   /** The source's catalog key. */
   source: string;
   /** Its keep score: the sum over targets of 1 / its best rank. */
   score: number;
   /** By target index: this source's hits for that target, best first. Only targets with a hit. */
   offers: Map<number, Offer[]>;
   /** Its own date and time dimensions, offered when a period is named. */
   periodDates?: string[];
}

/** Box 4's answer. */
export interface Grouped {
   /** The kept sources, in keep order. */
   sources: SourceGroup[];
   /** Target indexes no kept source holds a hit for. */
   unresolved: number[];
}

/**
 * The kept sources, in order, from each target's (source, best rank) pairs,
 * listed in the Call's target order. Pure.
 */
export function keepSources(
   ranks: ReadonlyArray<ReadonlyArray<{ source: string; rank: number }>>,
   keep: number = KEPT_SOURCES,
): string[] {
   if (keep <= 0) return [];
   const score = new Map<string, number>();
   const firstSeen = new Map<string, [number, number, string]>();
   const tops: string[] = [];
   ranks.forEach((pairs, position) => {
      if (pairs.length === 0) return;
      let top = pairs[0];
      for (const p of pairs) if (p.rank < top.rank) top = p;
      if (!tops.includes(top.source)) tops.push(top.source);
      for (const { source, rank } of pairs) {
         score.set(source, (score.get(source) ?? 0) + 1 / rank);
         const seen: [number, number, string] = [position, rank, source];
         const prev = firstSeen.get(source);
         if (!prev || compareSeen(seen, prev) < 0) firstSeen.set(source, seen);
      }
   });
   const order = (a: string, b: string) =>
      score.get(b)! - score.get(a)! ||
      compareSeen(firstSeen.get(a)!, firstSeen.get(b)!);
   const kept = [...tops].sort(order).slice(0, keep);
   const rest = [...score.keys()].filter((s) => !kept.includes(s)).sort(order);
   return [...kept, ...rest.slice(0, keep - kept.length)];
}

function compareSeen(
   a: [number, number, string],
   b: [number, number, string],
): number {
   return (
      a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)
   );
}

/** Most join paths through which one source offers one field of another. */
export const JOIN_PATHS_PER_FIELD = 3;

/**
 * The keys under which source `from` offers `node`, a field of another
 * source, through its joins (at most {@link JOIN_REACH_DEPTH} joins, the
 * {@link JOIN_PATHS_PER_FIELD} shortest paths, then by path): the model's
 * joined copy there when it holds one, else the field under the join path
 * ({@link joinedKey}). None for a source or a view, a joined copy itself,
 * or a copy the scope refuses.
 */
function joinedOffers(
   index: FcjIndex,
   from: string,
   node: CatalogNode,
   allow: (node: CatalogNode) => boolean,
): string[] {
   if (node.kind !== "dimension" && node.kind !== "measure") return [];
   if (node.joinPath) return [];
   const hops = (index.catalog.joins.get(from) ?? [])
      .filter(
         (h) =>
            h.to === node.sourceKey &&
            h.to !== from &&
            h.path.length <= JOIN_REACH_DEPTH,
      )
      .sort(
         (a, b) =>
            a.path.length - b.path.length ||
            (a.path.join(".") < b.path.join(".") ? -1 : 1),
      )
      .slice(0, JOIN_PATHS_PER_FIELD);
   const out: string[] = [];
   for (const hop of hops) {
      const copy = index.catalog.nodes.get(
         nodeKeyOf(node.kind, from, `${hop.path.join(".")}.${node.name}`),
      );
      if (copy) {
         if (allow(copy)) out.push(copy.key);
      } else {
         out.push(joinedKey(from, hop.path, node.key));
      }
   }
   return out;
}

/** Box 4: group `hits` by source and keep the most likely sources. */
export function groupBySource(args: {
   index: FcjIndex;
   hits: readonly Hits[];
   /** Box 1's scope, for the fields a kept source offers through its joins. */
   allow?: (node: CatalogNode) => boolean;
   /** The caller's question, read for a period only. */
   question?: string;
   keep?: number;
}): Grouped {
   const { index, hits } = args;
   const allow = args.allow ?? (() => true);
   const sourceOf = (key: string) => index.catalog.nodes.get(key)?.sourceKey;
   const ranks = hits.map((h) => {
      const best = new Map<string, number>();
      h.candidates.forEach((c, i) => {
         const s = sourceOf(c.key);
         if (s !== undefined && !best.has(s)) best.set(s, i + 1);
      });
      return [...best].map(([source, rank]) => ({ source, rank }));
   });
   const kept = keepSources(ranks, args.keep ?? KEPT_SOURCES);
   const score = new Map<string, number>();
   for (const pairs of ranks)
      for (const p of pairs)
         score.set(p.source, (score.get(p.source) ?? 0) + 1 / p.rank);
   const period =
      namesPeriod(args.question ?? "") ||
      hits.some((h) => namesPeriod(h.target.text));
   const sources: SourceGroup[] = kept.map((source) => {
      const offers = new Map<number, Offer[]>();
      for (const h of hits) {
         const byKey = new Map<string, Offer>();
         h.candidates.forEach((hit, i) => {
            const node = index.catalog.nodes.get(hit.key);
            if (!node) return;
            const found: Offer[] = [];
            if (node.sourceKey === source) {
               found.push({ hit, rank: i + 1 });
            } else {
               // A value was matched on the field's own source: none rides along.
               const { values: _values, ...rest } = hit;
               void _values;
               for (const key of joinedOffers(index, source, node, allow)) {
                  found.push({
                     hit: { ...rest, key },
                     rank: i + 1,
                     via: hit.key,
                  });
               }
            }
            for (const offer of found) {
               const prev = byKey.get(offer.hit.key);
               if (!prev || offer.rank < prev.rank)
                  byKey.set(offer.hit.key, offer);
            }
         });
         const list = [...byKey.values()].sort(
            (a, b) =>
               a.rank - b.rank ||
               (a.hit.key < b.hit.key ? -1 : a.hit.key > b.hit.key ? 1 : 0),
         );
         if (list.length > 0) offers.set(h.target.index, list);
      }
      const periodDates = period
         ? (index.catalog.sources.get(source)?.fields ?? []).filter((k) => {
              const n = index.catalog.nodes.get(k);
              return (
                 n !== undefined &&
                 n.kind === "dimension" &&
                 !n.joinPath &&
                 DATE_TYPES.has(n.dataType ?? "") &&
                 allow(n)
              );
           })
         : [];
      return {
         source,
         score: score.get(source) ?? 0,
         offers,
         ...(periodDates.length > 0 ? { periodDates } : {}),
      };
   });
   const unresolved = hits
      .map((h) => h.target.index)
      .filter((t) => !sources.some((s) => s.offers.has(t)));
   return { sources, unresolved };
}
