// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { beforeAll, describe, expect, it } from "bun:test";
import {
   compileFcjFixture,
   FCJ_DEEP_FILES,
} from "../../test_helpers/fcj_fixture";
import {
   buildCatalog,
   catalogInputOf,
   JOIN_WALK_MAX_HOPS,
   walkJoins,
   type Catalog,
   type JoinHop,
} from "../model/catalog";
import { catalogReportLine } from "../index/catalog_store";

const hop = (to: string, alias: string, fanout: JoinHop["fanout"] = "one") => ({
   to,
   path: [alias],
   fanout,
});
const paths = (joins: Map<string, JoinHop[]>, from: string) =>
   (joins.get(from) ?? []).map(
      (h) => `${h.path.join(".")} > ${h.to} (${h.fanout})`,
   );

describe("walkJoins", () => {
   it("walks a chain four joins deep, with the widest relationship on each path", () => {
      const { joins, capped } = walkJoins(
         new Map([
            ["a", [hop("b", "to_b")]],
            ["b", [hop("c", "to_c", "many")]],
            ["c", [hop("d", "to_d")]],
            ["d", [hop("e", "to_e")]],
         ]),
      );
      expect(paths(joins, "a")).toEqual([
         "to_b > b (one)",
         "to_b.to_c > c (many)",
         "to_b.to_c.to_d > d (many)",
         "to_b.to_c.to_d.to_e > e (many)",
      ]);
      expect(paths(joins, "d")).toEqual(["to_e > e (one)"]);
      expect(capped).toBe(0);
   });

   it("records a source's join to itself once and does not follow it", () => {
      const { joins, capped } = walkJoins(
         new Map([["emp", [hop("emp", "manager"), hop("dept", "dept")]]]),
      );
      expect(paths(joins, "emp")).toEqual([
         "dept > dept (one)",
         "manager > emp (one)",
      ]);
      expect(capped).toBe(0);
   });

   it("records the join that closes a cycle and stops there", () => {
      const { joins, capped } = walkJoins(
         new Map([
            ["a", [hop("b", "x")]],
            ["b", [hop("c", "y")]],
            ["c", [hop("a", "z")]],
         ]),
      );
      expect(paths(joins, "a")).toEqual([
         "x > b (one)",
         "x.y > c (one)",
         "x.y.z > a (one)",
      ]);
      expect(paths(joins, "c")).toEqual([
         "z > a (one)",
         "z.x > b (one)",
         "z.x.y > c (one)",
      ]);
      expect(capped).toBe(0);
   });

   it(`stops a path at ${JOIN_WALK_MAX_HOPS} joins and counts the stop`, () => {
      const chain = new Map<string, JoinHop[]>();
      for (let i = 0; i < 11; i++)
         chain.set(`s${i}`, [hop(`s${i + 1}`, `j${i}`)]);
      const { joins, capped } = walkJoins(chain);
      const fromRoot = joins.get("s0")!;
      expect(fromRoot.length).toBe(8);
      expect(fromRoot.at(-1)!.path).toEqual([
         "j0",
         "j1",
         "j2",
         "j3",
         "j4",
         "j5",
         "j6",
         "j7",
      ]);
      // s0, s1 and s2 each reach a source past 8 joins with a join of its own.
      expect(capped).toBe(3);
   });

   it("keeps a recorded nested path the one-join walk cannot make, unless it passes a source twice", () => {
      const { joins } = walkJoins(
         new Map([
            [
               "a",
               [
                  hop("a", "self"),
                  { to: "c", path: ["raw", "c_join"], fanout: "many" as const },
                  { to: "c", path: ["self", "c_join"], fanout: "one" as const },
               ],
            ],
         ]),
      );
      expect(paths(joins, "a")).toEqual([
         "self > a (one)",
         "raw.c_join > c (many)",
      ]);
   });
});

describe("join walk on a compiled package", () => {
   let indexed: Catalog;
   beforeAll(async () => {
      const { pkgIndex } = await compileFcjFixture(FCJ_DEEP_FILES, {});
      indexed = buildCatalog(await catalogInputOf(pkgIndex));
   });

   it("records the four-join chain and reports the walk", () => {
      expect(paths(indexed.joins, "parcels@deep.malloy")).toEqual([
         "shipment > shipments@deep.malloy (one)",
         "shipment.shipped_order > orders@deep.malloy (one)",
         "shipment.shipped_order.customer > customers@deep.malloy (one)",
         "shipment.shipped_order.customer.region > regions@deep.malloy (one)",
      ]);
      expect(indexed.report.joinPaths).toBe(11);
      expect(indexed.report.deepestJoinPath).toBe(4);
      expect(indexed.report.joinPathsCapped).toBe(0);
      expect(catalogReportLine(indexed.report)).toBe(
         "7 sources; nodes: 7 source, 21 dimension, 6 join, 2 measure; edges: 29 contains, 5 joins, 1 extends, 0 depends, 0 uses; 0 nodes resolve in more than one file; 0 #(index) dimensions; 0 gated sources; 3 field references resolved to no node; 11 join paths, the longest 4 joins",
      );
   });

   it("records the self-join Malloy allows (an extension joining its parent) as one join", () => {
      expect(paths(indexed.joins, "staff@deep.malloy")).toEqual([
         "manager > staff_base@deep.malloy (one)",
      ]);
   });

   it("keeps the joined copies of a raw-table join", () => {
      expect(
         indexed.nodes.has(
            "dimension:shipments@deep.malloy:shipped_order.date_dim.yr",
         ),
      ).toBe(true);
   });
});
