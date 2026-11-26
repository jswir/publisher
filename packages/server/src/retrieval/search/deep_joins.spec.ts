// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { beforeAll, describe, expect, it } from "bun:test";
import {
   compileFcjFixture,
   FCJ_DEEP_FILES,
   FCJ_PAYMENTS_FILES,
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
import { routesOf } from "./routes";

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
   let routes: Catalog;
   beforeAll(async () => {
      const { pkgIndex } = await compileFcjFixture(FCJ_DEEP_FILES, {});
      const input = await catalogInputOf(pkgIndex);
      indexed = buildCatalog({ ...input, collapseCopies: true });
      routes = buildCatalog({
         ...input,
         collapseCopies: true,
         joinedCopies: "routes",
      });
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
         "7 sources; nodes: 7 source, 21 dimension, 6 join, 2 measure; edges: 29 contains, 5 joins, 1 extends, 0 depends, 0 uses; 0 nodes resolve in more than one file; 0 #(index) dimensions; 0 gated sources; 3 field references resolved to no node; 11 join paths, the longest 4 joins; 3 inherited copies folded (same rows), 0 kept on their own source (other rows)",
      );
   });

   it("records the self-join Malloy allows (an extension joining its parent) as one join", () => {
      expect(paths(indexed.joins, "staff@deep.malloy")).toEqual([
         "manager > staff_base@deep.malloy (one)",
      ]);
   });

   it("indexed: lists routes two joins deep and keeps the joined copies of a raw-table join", () => {
      const region = indexed.nodes.get(
         "dimension:regions@deep.malloy:region_name",
      )!;
      expect(routesOf(indexed, region)).toEqual([
         "dimension:customers:region.region_name",
         "dimension:orders:customer.region.region_name",
      ]);
      expect(
         indexed.nodes.has(
            "dimension:shipments@deep.malloy:shipped_order.date_dim.yr",
         ),
      ).toBe(true);
      expect(indexed.report.joinedCopiesDropped).toBe(0);
   });

   it("routes: lists every route at any depth", () => {
      const region = routes.nodes.get(
         "dimension:regions@deep.malloy:region_name",
      )!;
      expect(routesOf(routes, region)).toEqual([
         "dimension:customers:region.region_name",
         "dimension:orders:customer.region.region_name",
         "dimension:shipments:shipped_order.customer.region.region_name",
         "dimension:parcels:shipment.shipped_order.customer.region.region_name",
      ]);
   });

   it("routes: a raw-table join's fields stay on the source that joins it, and the copies further out become its routes", () => {
      expect(
         routes.nodes.has(
            "dimension:shipments@deep.malloy:shipped_order.date_dim.yr",
         ),
      ).toBe(false);
      expect(
         routes.nodes.has(
            "dimension:shipments@deep.malloy:shipped_order.date_dim.d",
         ),
      ).toBe(false);
      expect(routes.report.joinedCopiesDropped).toBe(2);
      const year = routes.nodes.get(
         "dimension:orders@deep.malloy:date_dim.yr",
      )!;
      // The route's id is the id the dropped copy had, so a label naming the
      // copy is still met by the field.
      expect(routesOf(routes, year)).toEqual([
         "dimension:shipments:shipped_order.date_dim.yr",
         "dimension:parcels:shipment.shipped_order.date_dim.yr",
      ]);
      expect(catalogReportLine(routes.report)).toBe(
         "7 sources; nodes: 7 source, 19 dimension, 6 join, 2 measure; edges: 27 contains, 5 joins, 1 extends, 0 depends, 0 uses; 0 nodes resolve in more than one file; 0 #(index) dimensions; 0 gated sources; 3 field references resolved to no node; 11 join paths, the longest 4 joins; 3 inherited copies folded (same rows), 0 kept on their own source (other rows); 2 joined copies left out (searched on their own source, reached by route)",
      );
   });

   it("routes: a join to a source extended in the join is a route to that source; a field the join adds stays", async () => {
      const { pkgIndex } = await compileFcjFixture(FCJ_PAYMENTS_FILES, {});
      const c = buildCatalog({
         ...(await catalogInputOf(pkgIndex)),
         collapseCopies: true,
         joinedCopies: "routes",
      });
      expect(paths(c.joins, "payments@payments.malloy")).toEqual([
         "labelled > merchants@payments.malloy (one)",
         "merchant_profile > merchants@payments.malloy (one)",
      ]);
      const labelled = [...c.nodes.values()]
         .filter(
            (n) => n.sourceKey === "payments@payments.malloy" && n.joinPath,
         )
         .map((n) => n.name);
      expect(labelled).toEqual([
         "networks.code",
         "networks.label",
         "networks.network_name",
         "labelled.loud_name",
      ]);
      // labelled.merchant, labelled.account_type (folded into account_kind)
      // and labelled.account_kind, on payments and its two extensions.
      expect(c.report.joinedCopiesDropped).toBe(9);
      expect(
         routesOf(
            c,
            c.nodes.get("dimension:merchants@payments.malloy:account_kind")!,
         ),
      ).toEqual([
         "dimension:eur_payments:labelled.account_kind",
         "dimension:eur_payments:merchant_profile.account_kind",
         "dimension:payments:labelled.account_kind",
         "dimension:payments:merchant_profile.account_kind",
         "dimension:plain_payments:labelled.account_kind",
         "dimension:plain_payments:merchant_profile.account_kind",
      ]);
   });
});
