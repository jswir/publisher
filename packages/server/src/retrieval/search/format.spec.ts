// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
   buildFcjIndexFixture,
   type FcjIndexFixture,
} from "../../test_helpers/fcj_index_fixture";
import { embedText } from "../../test_helpers/get_context_llm_harness";
import type { ResolvedRequest } from "../model/types";
import type { CatalogNode } from "../model/catalog";
import { gatedValueWarning } from "./authorize";
import { KINDS_BY_TARGET, search, type Target } from "./find";
import { groupBySource } from "./group";
import type { JudgePick } from "./judge";
import { unjudged, type RankedSource } from "./rerank";
import {
   FIELDS_PER_PICK_AFTER_FIRST,
   FIELDS_PER_TARGET,
   format,
   limitPicks,
   PERIOD_FIELD_REASON,
   servedCaveats,
   type FormatArgs,
} from "./format";
import { joinedKey } from "./fields";
import { PERIOD_TARGET } from "./group";
import { ValueIndex } from "../index/values_index";
import { toUnit } from "../index/vectors";
import { RetrievalRegistry } from "../registry";
import { valueFetcherFor } from "./values";

let f: FcjIndexFixture;
beforeAll(async () => {
   f = await buildFcjIndexFixture();
});
afterAll(async () => f.close());

const t = (index: number, type: Target["type"], text: string): Target => ({
   index,
   type,
   text,
   kinds: KINDS_BY_TARGET[type],
});

const request: ResolvedRequest = {
   pureSourceListing: false,
   environmentName: "env",
   packageName: "fixture",
   kinds: new Set(),
   searches: [],
   valueSearches: [],
   listingOnly: false,
   includeCode: false,
   unsupported: [],
   limit: 20,
   offset: 0,
};

/**
 * Boxes 3 to 6 over the fixture. `pickFor` stands in for each kept source's
 * pick call (by source key); without it, every source answers unjudged.
 */
async function answer(
   targets: Target[],
   pickFor?: (source: string) => JudgePick[],
   allow: (n: CatalogNode) => boolean = () => true,
   extra: Partial<FormatArgs> = {},
) {
   const req = (extra.request as ResolvedRequest | undefined) ?? request;
   const hits = search({
      index: f.index,
      queries: targets.map((x) => ({
         target: x,
         vector: toUnit(embedText(x.text)),
      })),
      values: true,
      valueMeaning: false,
      allow,
      pinned: req.entityName !== undefined,
   });
   const grouped = groupBySource({ index: f.index, hits });
   const ranked: RankedSource[] = pickFor
      ? grouped.sources.map((g) => ({
           source: g.source,
           picks: pickFor(g.source),
           caveats: [],
        }))
      : unjudged(grouped, targets);
   return format({
      index: f.index,
      request,
      pkgIndex: f.pkgIndex,
      targets,
      grouped,
      ranked,
      environmentStore: {} as never,
      valueFetcher: valueFetcherFor(new RetrievalRegistry()),
      ...extra,
   });
}

type Card = {
   source_info: {
      resource_id: { source: string; model_path: string };
      docs?: string;
   };
   entities?: Array<{
      entity_id: string;
      join_path?: string;
      description?: string;
      values?: unknown[];
      matched_targets?: Array<{ search_text: string; match_reason?: string }>;
      also_likely?: boolean;
      also_likely_reason?: string;
   }>;
};
const ids = (sources: unknown[]) =>
   (sources as Card[]).flatMap((s) =>
      (s.entities ?? []).map((e) => e.entity_id),
   );

describe("format (box 6)", () => {
   it("gives one card per source in box 5's order, each field with its own call's reason, and one clusters entry per card", async () => {
      const FLIGHTS = "measure:flights@travel.malloy:flight_count";
      const RACES = "measure:races@reports.malloy:race_count";
      const out = await format({
         index: f.index,
         request,
         pkgIndex: f.pkgIndex,
         targets: [
            t(0, "measure", "number of flights"),
            t(1, "measure", "number of races"),
         ],
         grouped: { sources: [], unresolved: [] },
         ranked: [
            {
               source: "races@reports.malloy",
               picks: [{ target: 1, keys: [RACES], reason: "counts races" }],
               caveats: ["a caveat"],
            },
            {
               source: "flights@travel.malloy",
               picks: [
                  { target: 0, keys: [FLIGHTS], reason: "counts flights" },
               ],
               caveats: [],
            },
         ],
         environmentStore: {} as never,
         valueFetcher: valueFetcherFor(new RetrievalRegistry()),
      });
      expect(
         (out.sources as Card[]).map((c) => c.source_info.resource_id.source),
      ).toEqual(["races", "flights"]);
      expect(
         (out.sources as Card[])[0].entities![0].matched_targets as unknown[],
      ).toEqual([
         {
            search_text: "number of races",
            relevance: 0,
            match_reason: "counts races",
         },
      ]);
      expect(out.clusters).toEqual([
         {
            query_from: { source: "races", model_path: "reports.malloy" },
            sources: [{ source: "races", joins: [] }],
            covers: [1],
            picks: { 1: ["measure:races:race_count"] },
            caveats: ["a caveat"],
         },
         {
            query_from: { source: "flights", model_path: "travel.malloy" },
            sources: [{ source: "flights", joins: [] }],
            covers: [0],
            picks: { 0: ["measure:flights:flight_count"] },
         },
      ]);
      expect(out.coverage).toEqual([
         {
            target_index: 0,
            search_text: "number of flights",
            clusters: [false, true],
         },
         {
            target_index: 1,
            search_text: "number of races",
            clusters: [true, false],
         },
      ]);
      expect(out.unresolved_targets).toEqual([]);
   });

   it("names a target no card answers as unresolved", async () => {
      const out = await answer(
         [t(0, "measure", "number of flights")],
         () => [],
      );
      expect(out.sources).toEqual([]);
      expect(out.unresolved_targets).toEqual([
         {
            target_index: 0,
            target_type: "measure",
            search_text: "number of flights",
         },
      ]);
   });

   it("nests matched values under their dimension", async () => {
      const out = await answer([
         t(0, "measure", "how many flights"),
         t(1, "dimensional_value", "Denver"),
      ]);
      const arrives = (out.sources as Card[])[0].entities!.find(
         (e) => e.entity_id === "dimension:flights:arrives_at",
      )!;
      expect(arrives.values).toEqual([
         {
            value: "Denver International (DIA)",
            relevance: 0.85,
            search_text: "Denver",
         },
      ]);
   });

   it("keeps only the stored values the judge named for a value target", async () => {
      const targets = [
         t(0, "measure", "how many flights"),
         t(1, "dimensional_value", "Denver"),
      ];
      const ARRIVES = "dimension:flights@travel.malloy:arrives_at";
      const valuesOf = async (named: string[] | undefined) => {
         const out = await answer(targets, (source) =>
            source === "flights@travel.malloy"
               ? [
                    {
                       target: 1,
                       keys: [ARRIVES],
                       ...(named ? { values: { [ARRIVES]: named } } : {}),
                    },
                 ]
               : [],
         );
         return (out.sources as Card[])[0].entities!.find(
            (e) => e.entity_id === "dimension:flights:arrives_at",
         )!.values;
      };
      expect(await valuesOf(["Denver International (DIA)"])).toHaveLength(1);
      expect(await valuesOf(undefined)).toHaveLength(1);
      // Shown and passed over: the field stays, the value does not.
      expect(await valuesOf([])).toBeUndefined();
   });

   it("keeps every target's values when several targets pick one field, in either order", async () => {
      const ARRIVES = "dimension:flights@travel.malloy:arrives_at";
      const valuesFor = async (targets: Target[]) => {
         const out = await answer(targets, (source) =>
            source === "flights@travel.malloy"
               ? targets
                    .filter((x) => x.type !== "measure")
                    .map((x) => ({ target: x.index, keys: [ARRIVES] }))
               : [],
         );
         const arrives = (out.sources as Card[])
            .flatMap((c) => c.entities ?? [])
            .find((e) => e.entity_id === "dimension:flights:arrives_at")!;
         return (
            (arrives.values ?? []) as Array<{
               value: string;
               search_text: string;
            }>
         )
            .map((v) => `${v.search_text} -> ${v.value}`)
            .sort();
      };
      const both = [
         "Chicago -> Chicago O'Hare (ORD)",
         "Denver -> Denver International (DIA)",
      ];
      const measure = t(0, "measure", "how many flights");
      // A dimension target first, then a value target for the same field.
      expect(
         await valuesFor([
            measure,
            t(1, "dimension", "arrival airport"),
            t(2, "dimensional_value", "Denver"),
            t(3, "dimensional_value", "Chicago"),
         ]),
      ).toEqual(both);
      // The value targets first.
      expect(
         await valuesFor([
            measure,
            t(1, "dimensional_value", "Chicago"),
            t(2, "dimensional_value", "Denver"),
            t(3, "dimension", "arrival airport"),
         ]),
      ).toEqual(both);
   });

   it("says a field offered for a value has no values indexed", async () => {
      const out = await answer([t(0, "dimensional_value", "DIA")], (source) =>
         source === "flights@travel.malloy"
            ? [
                 {
                    target: 0,
                    keys: ["dimension:flights@travel.malloy:origin_code"],
                 },
              ]
            : [],
      );
      expect(ids(out.sources)).toContain("dimension:flights:origin_code");
      expect(out.warnings).toContain(
         'flights.origin_code was offered for "DIA" by its description. Its values are not indexed (it is not tagged #(index)), so whether it holds that value was not checked; read its values with execute_query.',
      );
   });

   it("asks the query path, with the caller's givens, for a value on a gated source", async () => {
      const cities = f.index.catalog.sources.get("cities@travel.malloy")!;
      const values = f.index.values;
      cities.gated = true;
      // A gated source's values are never in the shared index.
      f.index.values = new ValueIndex(
         values.values.filter((v) => !v.dimension.includes("cities@")),
      );
      const asked: unknown[] = [];
      try {
         const out = await answer(
            [t(0, "dimensional_value", "denver")],
            () => [
               { target: 0, keys: ["dimension:cities@travel.malloy:city"] },
            ],
            (n) =>
               n.source === "cities" &&
               (n.kind === "source" || n.name === "city"),
            {
               request: {
                  ...request,
                  sourceName: "cities",
                  entityName: "city",
                  givens: { TENANT: "a" },
               },
               identity: { caller: "alice", traceId: "trace-1" },
               valueFetcher: async (req) => {
                  asked.push([
                     req.source,
                     req.dimension,
                     req.givens,
                     req.identity,
                  ]);
                  return { values: ["Denver", "Boulder"], truncated: false };
               },
            },
         );
         expect(asked).toEqual([
            [
               "cities",
               "city",
               { TENANT: "a" },
               { caller: "alice", traceId: "trace-1" },
            ],
         ]);
         const city = (out.sources as Card[])[0].entities![0];
         expect(city.values).toEqual([
            { value: "Denver", relevance: 0.98, search_text: "denver" },
         ]);
      } finally {
         cities.gated = false;
         f.index.values = values;
      }
   });

   it("says which gated sources a value search with no pinned dimension skipped", () => {
      const cities = f.index.catalog.sources.get("cities@travel.malloy")!;
      cities.gated = true;
      try {
         const targets = [t(0, "dimensional_value", "Denver")];
         expect(gatedValueWarning(f.index, request, targets, () => true)).toBe(
            "The values of 1 source(s) with an access gate were not searched (cities). To search one, scope the target to its dimension (scopes[].source and entity_name) and send the givens its gate needs.",
         );
         expect(
            gatedValueWarning(
               f.index,
               { ...request, sourceName: "cities", entityName: "city" },
               targets,
               () => true,
            ),
         ).toBeUndefined();
         expect(
            gatedValueWarning(
               f.index,
               request,
               [t(0, "dimension", "city")],
               () => true,
            ),
         ).toBeUndefined();
      } finally {
         cities.gated = false;
      }
   });
});

describe("limitPicks", () => {
   const owner = (k: string) => k.split("|")[0];
   const keys = (source: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${source}|f${i + 1}`);
   it("keeps every pick of the first served source, two per pick on the others, eight per target", () => {
      expect(FIELDS_PER_PICK_AFTER_FIRST).toBe(2);
      expect(FIELDS_PER_TARGET).toBe(8);
      const out = limitPicks(
         [
            {
               source: "a",
               picks: [{ target: 0, keys: keys("a", 5) }],
               caveats: [],
            },
            {
               source: "b",
               picks: [
                  { target: 0, keys: keys("b", 4) },
                  { target: 1, keys: keys("b", 3) },
               ],
               caveats: [],
            },
            {
               source: "c",
               picks: [{ target: 0, keys: keys("c", 3) }],
               caveats: [],
            },
         ],
         owner,
      );
      expect(out.map((r) => r.picks.map((p) => p.keys))).toEqual([
         [keys("a", 5)],
         [keys("b", 2), keys("b", 2)],
         // Target 0 already holds 7: one more fills it to 8.
         [keys("c", 1)],
      ]);
   });

   it("does not count a source whose only picks are a period's date field, or fields of other sources, as the first card", () => {
      const out = limitPicks(
         [
            {
               source: "a",
               picks: [{ target: PERIOD_TARGET, keys: keys("a", 2) }],
               caveats: [],
            },
            {
               source: "x",
               picks: [{ target: 0, keys: ["b|f1", "b|f2"] }],
               caveats: [],
            },
            {
               source: "b",
               picks: [{ target: 0, keys: keys("b", 4) }],
               caveats: [],
            },
         ],
         owner,
      );
      // At most one date field per source.
      expect(out[0].picks[0].keys).toEqual(keys("a", 1));
      expect(out[1].picks[0].keys).toEqual([]);
      // b is the first card: it keeps all four.
      expect(out[2].picks[0].keys).toEqual(keys("b", 4));
   });

   it("counts the first source with a pick as first, and drops a field of another source", () => {
      const out = limitPicks(
         [
            { source: "a", picks: [{ target: 0, keys: [] }], caveats: [] },
            {
               source: "b",
               picks: [{ target: 0, keys: [...keys("b", 3), "x|f1"] }],
               caveats: [],
            },
         ],
         owner,
      );
      expect(out[1].picks[0].keys).toEqual(keys("b", 3));
   });
});

describe("format: joined fields, period fields and what the notes name", () => {
   const base = () => ({
      index: f.index,
      request,
      pkgIndex: f.pkgIndex,
      grouped: { sources: [], unresolved: [] },
      environmentStore: {} as never,
      valueFetcher: valueFetcherFor(new RetrievalRegistry()),
   });
   const FLIGHTS = "measure:flights@travel.malloy:flight_count";
   const NAME = "dimension:airports@travel.malloy:airport_name";

   it("writes a field reached through a join under its path on the joining source's card", async () => {
      const out = await format({
         ...base(),
         targets: [
            t(0, "measure", "flights"),
            t(1, "dimension", "airport name"),
         ],
         ranked: [
            {
               source: "flights@travel.malloy",
               picks: [
                  { target: 0, keys: [FLIGHTS] },
                  {
                     target: 1,
                     keys: [
                        joinedKey("flights@travel.malloy", ["origin"], NAME),
                     ],
                     reason: "the origin airport's name",
                  },
               ],
               caveats: [],
            },
         ],
      });
      const card = (out.sources as Card[])[0];
      const field = card.entities!.find(
         (e) => e.entity_id === "dimension:flights:origin.airport_name",
      )!;
      expect(field.join_path).toBe("origin");
      expect(field.description).toContain(
         "Reached from flights through origin, a left join",
      );
      expect(field.values).toBeUndefined();
      expect(out.clusters).toEqual([
         expect.objectContaining({
            sources: [{ source: "flights", joins: ["origin"] }],
            picks: {
               0: ["measure:flights:flight_count"],
               1: ["dimension:flights:origin.airport_name"],
            },
         }),
      ]);
   });

   it("shows one date field for a named period, marked, on a card that answers a target, and none on one that does not", async () => {
      const START = "dimension:flights@travel.malloy:start_date";
      const out = await format({
         ...base(),
         targets: [t(0, "measure", "flights")],
         ranked: [
            {
               source: "flights@travel.malloy",
               picks: [
                  { target: 0, keys: [FLIGHTS] },
                  {
                     target: PERIOD_TARGET,
                     keys: [START, "dimension:flights@travel.malloy:id"],
                  },
               ],
               caveats: [],
            },
            {
               source: "races@reports.malloy",
               picks: [
                  {
                     target: PERIOD_TARGET,
                     keys: ["dimension:races@reports.malloy:start_date"],
                  },
               ],
               caveats: [],
            },
         ],
      });
      const cards = out.sources as Array<
         Card & {
            entities?: Array<{
               also_likely?: boolean;
               also_likely_reason?: string;
            }>;
         }
      >;
      expect(cards.map((c) => c.source_info.resource_id.source)).toEqual([
         "flights",
      ]);
      const dates = cards[0].entities!.filter((e) => e.also_likely);
      expect(dates.map((e) => e.entity_id)).toEqual([
         "dimension:flights:start_date",
      ]);
      expect(dates[0].also_likely_reason).toBe(PERIOD_FIELD_REASON);
      // A date field is no target's pick.
      expect(out.clusters).toEqual([
         expect.objectContaining({
            covers: [0],
            picks: { 0: ["measure:flights:flight_count"] },
         }),
      ]);
   });

   it("drops a caveat that names a field the limits cut, and keeps the rest", () => {
      expect(
         servedCaveats(
            [
               "arrival_code may answer target 1 too.",
               "start_date is the scheduled date.",
               "flights.arrival_code_x is fine",
            ],
            new Set(["arrival_code"]),
         ),
      ).toEqual([
         "start_date is the scheduled date.",
         "flights.arrival_code_x is fine",
      ]);
   });

   it("drops a caveat naming a field the later-source limit cut", async () => {
      const out = await format({
         ...base(),
         targets: [t(0, "measure", "count")],
         ranked: [
            {
               source: "races@reports.malloy",
               picks: [
                  {
                     target: 0,
                     keys: ["measure:races@reports.malloy:race_count"],
                  },
               ],
               caveats: [],
            },
            {
               source: "flights@travel.malloy",
               picks: [
                  {
                     target: 0,
                     keys: [
                        FLIGHTS,
                        "dimension:flights@travel.malloy:origin_code",
                        "dimension:flights@travel.malloy:arrival_code",
                     ],
                  },
               ],
               caveats: [
                  "arrival_code is a close call.",
                  "flight_count counts legs.",
               ],
            },
         ],
      });
      const flights = (
         out.clusters as Array<{
            query_from: { source: string };
            caveats?: string[];
         }>
      ).find((c) => c.query_from.source === "flights")!;
      expect(flights.caveats).toEqual(["flight_count counts legs."]);
   });
});
