// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Pages of a ranked answer (box 6). The boxes produce
 * the complete result: every card the picks land on, with every pick. Nothing
 * there is cut to fit a response. The response layer splits that result into
 * pages of whole cards, and holds it for a short time so the next page is a
 * page of the same result.
 *
 * A page starts at `offset` (counted in cards, the unit `limit`,
 * `total_available` and a listing's `next_offset` already count) and holds
 * as many whole cards as fit the character budget, at most `limit` of them,
 * so the last source is the first to move to the next page. A card too big
 * for a page by itself goes on a page alone. Only then, and only on that
 * card, are fields dropped from the end of its list (never a target's first
 * field), and then long descriptions shortened (marked `…`).
 *
 * Why a held result and not a deterministic re-run: the judge is a model
 * call, so running it again for page 2 can pick differently from the run
 * that made page 1, and a caller walking the pages would read two results
 * spliced together. The complete result is held in memory, keyed by a hash
 * of the normalized request, which includes the scope and the caller's
 * givens and filter values, so one caller's page never serves another's
 * request. It is also tied to the index object it was computed on, so a
 * reload or a rebuild never serves a held result from before it.
 */

import { createHash } from "node:crypto";
import { truncateDoc } from "../model/package_entities";
import { type ResolvedRequest } from "../model/types";
import { type SourceCard } from "./response";
import type { HeldResult } from "./held_results";

/** A page's character budget for its cards. */
export const FCJ_MAX_CHARS = 35_000;
/** Room kept for the rest of the payload (clusters, warnings) beside the cards. */
export const FCJ_RESERVE_CHARS = 1_000;
/** A description is never shortened below this many characters. */
const TRIM_FLOOR_CHARS = 200;

interface FcjPage {
   cards: SourceCard[];
   /** Where the next page starts; absent on the last page. */
   nextOffset?: number;
   /** Fields dropped from a card that did not fit a page alone. */
   dropped: number;
   /** Their entity ids. */
   droppedIds: string[];
   /** Descriptions shortened on a card that did not fit a page alone. */
   trimmed: number;
   /** The one card on this page is still over the budget after trimming. */
   oversized: boolean;
}

/**
 * The page of `cards` that starts at `offset`. Pure. Pages taken by
 * following `nextOffset` from 0 hold every card exactly once, in order.
 */
export function pageAt(
   cards: readonly SourceCard[],
   offset: number,
   options: { maxChars: number; reserveChars: number; limit: number },
): FcjPage {
   const room = options.maxChars - options.reserveChars;
   // A JSON array costs 2 for the brackets plus one comma between cards.
   let used = 2;
   const out: SourceCard[] = [];
   for (let i = offset; i < cards.length && out.length < options.limit; i++) {
      const size = JSON.stringify(cards[i]).length + (out.length > 0 ? 1 : 0);
      if (used + size > room && out.length > 0) break;
      used += size;
      out.push(cards[i]);
   }
   let dropped = 0;
   let droppedIds: string[] = [];
   let trimmed = 0;
   let oversized = false;
   if (out.length === 1 && used > room) {
      const cut = dropFields(out[0], room - 2);
      dropped = cut.dropped;
      droppedIds = cut.ids;
      const shrunk = shrinkCard(cut.card, room - 2);
      out[0] = shrunk.card;
      trimmed = shrunk.trimmed;
      oversized = JSON.stringify(shrunk.card).length > room - 2;
   }
   const next = offset + out.length;
   return {
      cards: out,
      ...(out.length > 0 && next < cards.length ? { nextOffset: next } : {}),
      dropped,
      droppedIds,
      trimmed,
      oversized,
   };
}

/**
 * A copy of `card` whose JSON fits `room` characters, by dropping fields
 * from the end of its list, never a target's first field (the first field
 * that matched each search text). Stops when it fits or only first fields
 * are left.
 */
export function dropFields(
   card: SourceCard,
   room: number,
): { card: SourceCard; dropped: number; ids: string[] } {
   const copy = structuredClone(card);
   const entities = copy.entities ?? [];
   const first = new Set<number>();
   const seen = new Set<string>();
   entities.forEach((e, i) => {
      for (const m of e.matched_targets ?? []) {
         if (!seen.has(m.search_text)) {
            seen.add(m.search_text);
            first.add(i);
         }
      }
   });
   const ids: string[] = [];
   for (let i = entities.length - 1; i >= 0; i--) {
      if (JSON.stringify(copy).length <= room) break;
      if (first.has(i)) continue;
      ids.push(entities[i].entity_id);
      entities.splice(i, 1);
   }
   return { card: copy, dropped: ids.length, ids };
}

/**
 * A copy of `card` whose JSON fits `room` characters, by shortening its
 * longest descriptions first, each to no less than {@link TRIM_FLOOR_CHARS}.
 * The source doc and every entity's description are the candidates; names,
 * ids, types, joins and values are never touched, and no entity is removed.
 * When even that does not fit, the card is returned as short as it goes.
 */
export function shrinkCard(
   card: SourceCard,
   room: number,
): { card: SourceCard; trimmed: number } {
   const copy = structuredClone(card);
   const slots: Array<{ get: () => string; set: (v: string) => void }> = [];
   if (copy.source_info.docs !== undefined) {
      slots.push({
         get: () => copy.source_info.docs ?? "",
         set: (v) => (copy.source_info.docs = v),
      });
   }
   for (const e of copy.entities ?? []) {
      if (e.description !== undefined) {
         slots.push({
            get: () => e.description ?? "",
            set: (v) => (e.description = v),
         });
      }
   }
   const touched = new Set<number>();
   // A slot already at its floor is never picked again, so the loop ends.
   const done = new Set<number>();
   for (;;) {
      const excess = JSON.stringify(copy).length - room;
      if (excess <= 0) break;
      let longest = -1;
      for (let i = 0; i < slots.length; i++) {
         const len = slots[i].get().length;
         if (
            !done.has(i) &&
            len > TRIM_FLOOR_CHARS &&
            (longest < 0 || len > slots[longest].get().length)
         ) {
            longest = i;
         }
      }
      if (longest < 0) break;
      const doc = slots[longest].get();
      const target = Math.max(TRIM_FLOOR_CHARS, doc.length - excess - 1);
      const cut = truncateDoc(doc, target);
      if (cut.length < doc.length) {
         slots[longest].set(cut);
         touched.add(longest);
      }
      if (target === TRIM_FLOOR_CHARS || cut.length >= doc.length) {
         done.add(longest);
      }
   }
   return { card: copy, trimmed: touched.size };
}

/**
 * The cache key of a request: a sha256 over every field that can change the
 * complete result. `limit` and `offset` are left out, because they choose a
 * page of the result, not the result. Givens and filter values are in it, so
 * a held result answers only the caller whose request made it.
 */
export function resultKey(request: ResolvedRequest): string {
   const normal = {
      environment: request.environmentName,
      package: request.packageName,
      modelPath: request.modelPath ?? null,
      source: request.sourceName ?? null,
      entity: request.entityName ?? null,
      searches: request.searches.map((s) => [
         s.targetIndex,
         s.targetType,
         s.text,
      ]),
      valueSearches: request.valueSearches.map((s) => [s.targetIndex, s.text]),
      textlessValueTargets: request.textlessValueTargets ?? 0,
      unsupported: request.unsupported,
      includeCode: request.includeCode,
      givens: request.givens ?? null,
      filterParams: request.filterParams ?? null,
      // The question is read by the ranking step, so it can change the result.
      userPrompt: request.userPrompt ?? null,
   };
   return createHash("sha256").update(canonicalJson(normal)).digest("hex");
}

/** JSON with every object's keys sorted, so equal values hash equal. */
export function canonicalJson(value: unknown): string {
   if (Array.isArray(value)) {
      return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
   }
   if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
         .filter(([, v]) => v !== undefined)
         .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
   }
   return JSON.stringify(value) ?? "null";
}

/**
 * The result's warnings and clusters without a word about a field the page
 * dropped to fit (pages.ts, dropFields): no warning names one (as
 * `source.field`), no `clusters` entry lists it among its picks, and no
 * caveat names it.
 */
export function withoutDropped(
   result: HeldResult,
   droppedIds: readonly string[],
): Pick<HeldResult, "warnings" | "clusters"> {
   if (droppedIds.length === 0) return result;
   const dropped = new Set(droppedIds);
   const names = droppedIds.map((id) => {
      const [, source, ...rest] = id.split(":");
      return { qualified: `${source}.${rest.join(":")}`, name: rest.join(":") };
   });
   const mentions = (text: string, name: string) =>
      new RegExp(
         `(^|[^A-Za-z0-9_.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`,
      ).test(text);
   return {
      warnings: result.warnings.filter(
         (w) => !names.some((n) => w.includes(n.qualified)),
      ),
      clusters: result.clusters.map((c) => {
         const entry = c as {
            picks?: Record<string, string[]>;
            caveats?: string[];
         };
         const picks = Object.fromEntries(
            Object.entries(entry.picks ?? {}).map(([t, ids]) => [
               t,
               ids.filter((id) => !dropped.has(id)),
            ]),
         );
         const caveats = (entry.caveats ?? []).filter(
            (cv) => !names.some((n) => mentions(cv, n.name)),
         );
         const { caveats: _old, ...rest } = entry;
         void _old;
         return {
            ...rest,
            ...(entry.picks ? { picks } : {}),
            ...(caveats.length > 0 ? { caveats } : {}),
         };
      }),
   };
}
