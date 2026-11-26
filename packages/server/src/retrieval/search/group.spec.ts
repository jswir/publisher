// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
   buildFcjIndexFixture,
   type FcjIndexFixture,
} from "../../test_helpers/fcj_index_fixture";
import { embedText } from "../../test_helpers/get_context_llm_harness";
import { toUnit } from "../index/vectors";
import { KINDS_BY_TARGET, search, type Target } from "./find";
import {
   groupBySource,
   JOIN_REACH_DEPTH,
   KEPT_SOURCES,
   keepSources,
   namesPeriod,
} from "./group";
import { fieldOf } from "./fields";

const pairs = (...xs: Array<[string, number]>) =>
   xs.map(([source, rank]) => ({ source, rank }));

describe("keepSources (box 4's keep rule)", () => {
   it("keeps each target's top source first, then the rest by the sum of 1 / rank", () => {
      // c is no target's top, but scores 1/2 + 1/2 = 1, above b's 1/3.
      expect(
         keepSources(
            [pairs(["a", 1], ["c", 2], ["b", 3]), pairs(["d", 1], ["c", 2])],
            3,
         ),
      ).toEqual(["a", "d", "c"]);
   });

   it("keeps every target's top source even when others score more", () => {
      // x is on both lists high, but y and z are each a target's top.
      expect(
         keepSources(
            [
               pairs(["y", 1], ["x", 2]),
               pairs(["z", 1], ["x", 2]),
               pairs(["w", 1], ["x", 2]),
            ],
            2,
         ),
      ).toEqual(["y", "z"]);
   });

   it("keeps at most seven by default", () => {
      expect(KEPT_SOURCES).toBe(7);
      const many = Array.from({ length: 12 }, (_, i): [string, number] => [
         `s${i}`,
         i + 1,
      ]);
      const kept = keepSources([pairs(...many)]);
      expect(kept).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
   });

   it("breaks ties by the first target that names the source, then its rank there, then the key", () => {
      // b and a tie at 1/2; b is seen first (target 0), so it comes first.
      expect(
         keepSources([pairs(["t", 1], ["b", 2]), pairs(["t", 1], ["a", 2])], 3),
      ).toEqual(["t", "b", "a"]);
      // Same target and rank: by key.
      expect(keepSources([pairs(["t", 1], ["z", 3], ["m", 3])], 3)).toEqual([
         "t",
         "m",
         "z",
      ]);
      // Two tops tied on score: the one seen first.
      expect(keepSources([pairs(["q", 1]), pairs(["p", 1])], 2)).toEqual([
         "q",
         "p",
      ]);
   });

   it("keeps nothing for no hits, or a keep of 0", () => {
      expect(keepSources([[], []])).toEqual([]);
      expect(keepSources([pairs(["a", 1])], 0)).toEqual([]);
   });
});

describe("groupBySource over the fixture", () => {
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
   const run = (
      targets: Target[],
      allow: (n: { source: string }) => boolean = () => true,
   ) =>
      groupBySource({
         index: f.index,
         hits: search({
            index: f.index,
            queries: targets.map((x) => ({
               target: x,
               vector: toUnit(embedText(x.text)),
            })),
            values: true,
            valueMeaning: false,
            allow,
         }),
      });

   it("puts each hit under the source that holds it, in search order, with its rank in its target's list", () => {
      const grouped = run([t(0, "measure", "number of flights")]);
      expect(grouped.sources.length).toBeGreaterThan(0);
      expect(grouped.sources.length).toBeLessThanOrEqual(KEPT_SOURCES);
      expect(grouped.sources[0].source).toBe("flights@travel.malloy");
      for (const g of grouped.sources) {
         const offers = g.offers.get(0) ?? [];
         for (const o of offers) {
            expect(f.index.catalog.nodes.get(o.hit.key)?.sourceKey).toBe(
               g.source,
            );
         }
         expect(offers.map((o) => o.rank)).toEqual(
            [...offers.map((o) => o.rank)].sort((a, b) => a - b),
         );
      }
      expect(grouped.unresolved).toEqual([]);
   });

   it("keeps only the scoped source: nothing to rank", () => {
      const grouped = run(
         [t(0, "measure", "number of flights"), t(1, "dimension", "city")],
         (n: { source: string }) => n.source === "races",
      );
      expect(grouped.sources.map((g) => g.source)).toEqual([
         "races@reports.malloy",
      ]);
   });

   const offered = (
      grouped: ReturnType<typeof run>,
      source: string,
      target: number,
   ) =>
      (
         grouped.sources.find((g) => g.source === source)?.offers.get(target) ??
         []
      ).map((o) => fieldOf(f.index.catalog, o.hit.key)?.name);

   it("offers a field search found on a joined source to the source that joins it, under its join path", () => {
      expect(JOIN_REACH_DEPTH).toBe(3);
      const grouped = run([
         t(0, "measure", "number of flights"),
         t(1, "dimension", "airport name"),
      ]);
      // flights holds no airport name of its own: it offers airports' through
      // both of its joins to airports, each a field of flights.
      const names = offered(grouped, "flights@travel.malloy", 1);
      expect(names).toContain("arrival.airport_name");
      expect(names).toContain("origin.airport_name");
      const joined = grouped.sources
         .find((g) => g.source === "flights@travel.malloy")!
         .offers.get(1)!
         .find(
            (o) =>
               fieldOf(f.index.catalog, o.hit.key)?.name ===
               "origin.airport_name",
         )!;
      expect(joined.via).toBe("dimension:airports@travel.malloy:airport_name");
      expect(fieldOf(f.index.catalog, joined.hit.key)).toMatchObject({
         sourceKey: "flights@travel.malloy",
         id: "dimension:flights:origin.airport_name",
         joinPath: "origin",
      });
      // The keep rule reads only each source's own hits: the joined offers
      // add no score.
      const plain = run([t(0, "measure", "number of flights")]);
      expect(
         grouped.sources.find((g) => g.source === "flights@travel.malloy")!
            .score,
      ).toBeGreaterThanOrEqual(
         plain.sources.find((g) => g.source === "flights@travel.malloy")!.score,
      );
   });

   it("offers nothing through a join to a source the scope leaves out", () => {
      const grouped = run(
         [
            t(0, "measure", "number of flights"),
            t(1, "dimension", "airport name"),
         ],
         (n: { source: string }) => n.source !== "airports",
      );
      expect(offered(grouped, "flights@travel.malloy", 1)).not.toContain(
         "origin.airport_name",
      );
   });

   it("offers a kept source's own date fields only when a period is named", () => {
      const hits = (targets: Target[]) =>
         search({
            index: f.index,
            queries: targets.map((x) => ({
               target: x,
               vector: toUnit(embedText(x.text)),
            })),
            values: true,
            valueMeaning: false,
            allow: () => true,
         });
      const targets = [t(0, "measure", "number of flights")];
      const none = groupBySource({
         index: f.index,
         hits: hits(targets),
         question: "How many flights?",
      });
      expect(none.sources.every((g) => g.periodDates === undefined)).toBe(true);
      const monthly = groupBySource({
         index: f.index,
         hits: hits(targets),
         question: "How many flights each month in 2024?",
      });
      expect(
         monthly.sources.find((g) => g.source === "flights@travel.malloy")
            ?.periodDates,
      ).toEqual(["dimension:flights@travel.malloy:start_date"]);
      // A target's own text names one as well.
      const byTarget = groupBySource({
         index: f.index,
         hits: hits([t(0, "measure", "flights per month")]),
      });
      expect(byTarget.sources.some((g) => g.periodDates?.length)).toBe(true);
   });

   it("reads a period from a period word or a year, and nothing else", () => {
      for (const yes of [
         "month by month",
         "sales in 2025",
         "Daily orders",
         "YTD revenue",
         "per quarter",
         "in March",
      ]) {
         expect(namesPeriod(yes)).toBe(true);
      }
      for (const no of [
         "total revenue",
         "orders over 100",
         "the last customer",
         "when shipped",
         "",
         "2025abc units",
      ]) {
         expect(namesPeriod(no)).toBe(false);
      }
   });
});
