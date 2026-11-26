// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Every get_context listing is alphabetical, ignoring case, at every level:
 * environments, packages, sources, and a source's fields, with the source's
 * own fields before those reached through a join. The model below declares
 * everything out of order and in mixed case, so declaration order and
 * code-unit order (`Z` before `a`) both fail these tests.
 */

import { describe, expect, it } from "bun:test";
import { registerGetContextTool } from "./get_context_tool";
import { compareNamesIgnoringCase } from "../../compare_text";
import {
   compileJoinFixture,
   storeServing,
} from "../../test_helpers/get_context_join_fixture";
import { fakeOf } from "../../test_helpers/store_fakes";
import type { EnvironmentCatalog } from "../../service/environment_ports";
import { testRetrieval } from "../../test_helpers/test_retrieval";

const MODEL = `
source: zones is duckdb.sql("select 1 as id, 'n' as nm") extend {
  dimension: zone_name is nm
}

source: Customers is duckdb.sql("select 1 as id, 30 as age, 'a' as nm") extend {
  dimension: name is nm
  dimension: Age is age
  join_one: zone is zones on zone.id = id
}

source: orders is duckdb.sql("select 1 as id, 1 as customer_id, 's' as st, 2 as amt, '8' as zp, {'city': 'Denver'} as delivery") extend {
  dimension: Zip is zp
  dimension: status is st
  measure: Amount is amt.sum()
  measure: count_all is count()
  view: by_status is { group_by: status; aggregate: count_all }
  join_one: Customer is Customers on Customer.id = customer_id
}

source: bills is duckdb.sql("select 1 as id") extend {
  dimension: bill_id is id
}
`;

type Handler = (p: Record<string, unknown>) => Promise<{
   isError?: boolean;
   content: Array<{ resource?: { text: string } }>;
}>;

function handlerOver(store: unknown): Handler {
   let handler: Handler | undefined;
   registerGetContextTool(
      {
         registerTool: (name: string, _config: unknown, h: Handler) => {
            if (name === "get_context") handler = h;
         },
      } as never,
      store as EnvironmentCatalog,
      testRetrieval(store),
   );
   return handler!;
}

async function payloadOf(handler: Handler, params: Record<string, unknown>) {
   const out = await handler(params);
   expect(out.isError ?? false).toBe(false);
   return JSON.parse(out.content[0].resource!.text);
}

type Card = {
   source_info: { resource_id: { source: string } };
   entities?: Array<{ name: string; entity_type: string; join_path?: string }>;
};

describe("compareNamesIgnoringCase", () => {
   it("orders names alphabetically ignoring case, and breaks a case-only tie by code unit", () => {
      expect(
         ["b", "Sales", "apple", "sales", "Banana", "a"].sort(
            compareNamesIgnoringCase,
         ),
      ).toEqual(["a", "apple", "b", "Banana", "Sales", "sales"]);
   });
});

describe("get_context listings are alphabetical, ignoring case", () => {
   it("lists environments alphabetically", async () => {
      const store = fakeOf<EnvironmentCatalog>({
         listEnvironments: async () =>
            ["prod", "Analytics", "dev", "Beta"].map((name) => ({
               name,
            })) as never,
         getEnvironment: async () =>
            ({
               listPackages: async () => [{ name: "a" }, { name: "b" }],
               getFailedPackages: () => new Map(),
               getStaleCompileErrors: () => new Map(),
            }) as never,
      });
      const payload = await payloadOf(handlerOver(store), {});
      expect(payload.listing).toBe("environments");
      expect(
         payload.environments.map(
            (e: { environment: string }) => e.environment,
         ),
      ).toEqual(["Analytics", "Beta", "dev", "prod"]);
   });

   it("lists packages alphabetically, a case-only tie in a fixed order", async () => {
      const store = fakeOf<EnvironmentCatalog>({
         listEnvironments: async () => [{ name: "prod" }] as never,
         getEnvironment: async () =>
            ({
               listPackages: async () =>
                  ["sales", "Zebra", "apps", "Sales", "Finance"].map(
                     (name) => ({ name }),
                  ),
               getFailedPackages: () => new Map(),
               getStaleCompileErrors: () => new Map(),
            }) as never,
      });
      const payload = await payloadOf(handlerOver(store), {
         environment: "prod",
      });
      expect(payload.listing).toBe("packages");
      expect(
         payload.packages.map((p: { package: string }) => p.package),
      ).toEqual(["apps", "Finance", "Sales", "sales", "Zebra"]);
   });

   it("lists a package's sources alphabetically, not in declaration order", async () => {
      const { pkg } = await compileJoinFixture("m.malloy", {
         modelText: MODEL,
      });
      const payload = await payloadOf(handlerOver(storeServing(pkg)), {
         scopes: [{ environment: "env", package: "pkg" }],
      });
      expect(
         payload.sources.map((c: Card) => c.source_info.resource_id.source),
      ).toEqual(["bills", "Customers", "orders", "zones"]);
   });

   it("lists a source's own fields alphabetically, then the fields reached through its joins", async () => {
      const { pkg } = await compileJoinFixture("m.malloy", {
         modelText: MODEL,
      });
      const payload = await payloadOf(handlerOver(storeServing(pkg)), {
         scopes: [{ environment: "env", package: "pkg", source: "orders" }],
      });
      expect(payload.sources).toHaveLength(1);
      const entities = (payload.sources[0] as Card).entities!;
      const own = entities.filter((e) => !e.join_path).map((e) => e.name);
      const joined = entities.filter((e) => e.join_path).map((e) => e.name);
      // Every own field comes before the first joined one.
      expect(entities.map((e) => e.name)).toEqual([...own, ...joined]);
      // Own fields, whatever their kind, raw columns and record members
      // included (`st` and `zp` fold into the dimensions declared over them).
      expect(own).toEqual([
         "Amount",
         "amt",
         "by_status",
         "count_all",
         "Customer",
         "customer_id",
         "delivery",
         "delivery.city",
         "id",
         "status",
         "Zip",
      ]);
      // Reached through the join: alphabetical too, deeper paths included.
      expect(joined.length).toBeGreaterThan(0);
      expect(joined).toEqual([...joined].sort(compareNamesIgnoringCase));
      expect(joined).toContain("Customer.Age");
      expect(joined).toContain("Customer.name");
   });

   it("orders a listing of one kind across sources by source, then name", async () => {
      const { pkg } = await compileJoinFixture("m.malloy", {
         modelText: MODEL,
      });
      const payload = await payloadOf(handlerOver(storeServing(pkg)), {
         scopes: [{ environment: "env", package: "pkg" }],
         search_targets: [{ target_type: "measure" }],
      });
      expect(
         payload.sources.map((c: Card) => [
            c.source_info.resource_id.source,
            c.entities?.map((e) => e.name),
         ]),
      ).toEqual([["orders", ["Amount", "count_all"]]]);
   });
});
