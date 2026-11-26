// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
   buildFcjIndexFixture,
   type FcjIndexFixture,
} from "../../test_helpers/fcj_index_fixture";
import { embedText } from "../../test_helpers/get_context_llm_harness";
import {
   fuseByRank,
   HITS_PER_TARGET,
   KINDS_BY_TARGET,
   search,
   type Target,
} from "./find";
import { routesOf } from "./routes";
import { toUnit } from "../index/vectors";
import type { CatalogNode } from "../model/catalog";

let f: FcjIndexFixture;
beforeAll(async () => {
   f = await buildFcjIndexFixture();
});
afterAll(async () => f.close());

const target = (index: number, type: Target["type"], text: string): Target => ({
   index,
   type,
   text,
   kinds: KINDS_BY_TARGET[type],
});

const queriesOf = (targets: Target[]) =>
   targets.map((t) => ({ target: t, vector: toUnit(embedText(t.text)) }));

const run = (
   targets: Target[],
   allow: (n: CatalogNode) => boolean = () => true,
) =>
   search({
      index: f.index,
      queries: queriesOf(targets),
      values: true,
      valueMeaning: false,
      allow,
   });

const top = (r: ReturnType<typeof run>[number], n: number) =>
   r.candidates.slice(0, n).map((c) => c.key);

describe("reciprocal rank fusion", () => {
   it("adds 1 / (60 + rank) per list and breaks ties by key", () => {
      const fused = fuseByRank([["a", "b"], ["b", "c"], []]);
      expect(
         fused.map((x) => [x.key, Number(x.score.toFixed(6)), x.ranks]),
      ).toEqual([
         ["b", Number((1 / 62 + 1 / 61).toFixed(6)), [2, 1, 0]],
         ["a", Number((1 / 61).toFixed(6)), [1, 0, 0]],
         ["c", Number((1 / 62).toFixed(6)), [0, 2, 0]],
      ]);
   });
});

describe("find", () => {
   it("finds all four start dates, and nothing ranks them apart but text", () => {
      const [r] = run([target(1, "dimension", "start date")]);
      expect(top(r, 4)).toEqual([
         "dimension:flights@travel.malloy:start_date",
         "dimension:races@reports.malloy:start_date",
         "dimension:orders@shop.malloy:start_date",
         "dimension:orders_public@shop.malloy:start_date",
      ]);
      expect(r.candidates.length).toBe(30);
      expect(r.candidates[0].ranks).toEqual({ close: 1, keyword: 1 });
   });

   it("searches a value only for a dimensional_value target, never inside a dimension's text", () => {
      const [dim, value] = run([
         target(0, "dimension", "flights to Mile High"),
         target(1, "dimensional_value", "Mile High"),
      ]);
      expect(dim.valuePhrases).toEqual([]);
      expect(dim.lists.value).toBe(0);
      expect(dim.candidates.some((c) => c.ranks.value)).toBe(false);
      expect(value.valuePhrases).toEqual(["Mile High"]);
   });

   it("adds a meaning list for value phrases when given their vectors", () => {
      const meaningRun = (t: Target) =>
         search({
            index: f.index,
            queries: queriesOf([t]),
            valueMeaning: true,
            values: true,
            allow: () => true,
         })[0];
      const r = meaningRun(target(3, "dimensional_value", "Denver"));
      // The target's text is its own phrase; its vector is the query's.
      expect(r.meaningPhrases).toEqual(["Denver"]);
      // The stub embedder puts "Denver International (DIA)" at 0.58 from
      // "Denver": above the floor, but more than the margin below 1.
      expect(r.lists).toEqual({
         close: 0,
         keyword: 0,
         value: 2,
         valueMeaning: 1,
      });
      expect(r.candidates[0]).toMatchObject({
         key: "dimension:cities@travel.malloy:city",
         ranks: { value: 1, valueMeaning: 1 },
         valueMeaningScore: 1,
      });
      expect(r.candidates[0].score).toBeCloseTo(2 / 61, 10);
      // A dimension target asks the value index nothing.
      const plain = meaningRun(target(4, "dimension", "flights to Denver"));
      expect(plain.meaningPhrases).toEqual([]);
      expect(plain.lists.valueMeaning).toBe(0);
   });

   it("answers a dimensional_value target from values and keywords only", () => {
      const [r] = run([target(3, "dimensional_value", "Denver")]);
      expect(r.lists).toEqual({
         close: 0,
         keyword: 0,
         value: 2,
         valueMeaning: 0,
      });
      expect(top(r, 2)).toEqual([
         "dimension:cities@travel.malloy:city",
         "dimension:flights@travel.malloy:arrives_at",
      ]);
   });

   it("keeps a source imported into two files as one candidate", () => {
      const [r] = run([target(4, "measure", "total sales")]);
      const ids = r.candidates.map((c) => f.index.catalog.nodes.get(c.key)!.id);
      expect(ids.filter((id) => id === "measure:orders:sales")).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
   });

   it("cuts at N and stays inside the scope", () => {
      const [r] = run(
         [target(1, "dimension", "start date")],
         (n) => n.source === "races",
      );
      expect(top(r, 2)).toEqual([
         "dimension:races@reports.malloy:start_date",
         "dimension:races@reports.malloy:city",
      ]);
      expect(r.candidates.every((c) => c.key.includes(":races@"))).toBe(true);
      const [all] = run([target(1, "dimension", "date")]);
      expect(all.candidates.length).toBeLessThanOrEqual(HITS_PER_TARGET);
   });

   it("ranks by keyword alone with no embedding provider", () => {
      const [r] = search({
         index: f.index,
         queries: [{ target: target(0, "measure", "number of flights") }],
         values: true,
         valueMeaning: false,
         allow: () => true,
      });
      expect(r.lists.close).toBe(0);
      expect(top(r, 1)).toEqual(["measure:flights@travel.malloy:flight_count"]);
   });
});

describe("helpers", () => {
   it("names every route to a field, two joins deep", () => {
      const node = f.index.catalog.nodes.get(
         "dimension:airports@travel.malloy:airport_name",
      )!;
      expect(routesOf(f.index.catalog, node)).toEqual([
         "dimension:flights:arrival.airport_name",
         "dimension:flights:origin.airport_name",
         "dimension:legs:flight.arrival.airport_name",
         "dimension:legs:flight.origin.airport_name",
      ]);
   });
});
