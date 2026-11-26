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
 */

import type { FcjIndex } from "../index/index_build";
import type { Hit, Hits } from "./find";

/** Most sources kept per request. */
export const KEPT_SOURCES = 7;

/** One hit as a kept source offers it: the hit and its rank in its target's list. */
export interface Offer {
   hit: Hit;
   /** 1-based rank in the target's whole hit list. */
   rank: number;
}

/** A kept source and the fields it offers each target, in search order. */
export interface SourceGroup {
   /** The source's catalog key. */
   source: string;
   /** Its keep score: the sum over targets of 1 / its best rank. */
   score: number;
   /** By target index: this source's hits for that target, best first. Only targets with a hit. */
   offers: Map<number, Offer[]>;
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

/** Box 4: group `hits` by source and keep the most likely sources. */
export function groupBySource(args: {
   index: FcjIndex;
   hits: readonly Hits[];
   keep?: number;
}): Grouped {
   const { index, hits } = args;
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
   const sources: SourceGroup[] = kept.map((source) => {
      const offers = new Map<number, Offer[]>();
      for (const h of hits) {
         const list = h.candidates
            .map((hit, i) => ({ hit, rank: i + 1 }))
            .filter((o) => sourceOf(o.hit.key) === source);
         if (list.length > 0) offers.set(h.target.index, list);
      }
      return { source, score: score.get(source) ?? 0, offers };
   });
   const unresolved = hits
      .map((h) => h.target.index)
      .filter((t) => !sources.some((s) => s.offers.has(t)));
   return { sources, unresolved };
}
