import { describe, expect, it } from "bun:test";
import {
   applyHeuristicColspans,
   artifactFromExplorer,
   hasDashboardGridTags,
   importPathFromModel,
   slugifyDashboardName,
   sourceNameFromMalloy,
} from "./artifactFromExplorer";

describe("artifactFromExplorer", () => {
   it("wraps a run: query as an # artifact file", () => {
      const source = artifactFromExplorer({
         malloy: "run: order_items -> {\n  aggregate: total_sales\n}",
         sourceName: "order_items",
         modelPath: "storefront.malloy",
         title: "Sales",
         slug: "sales",
      });
      expect(source).toContain("##! experimental.givens");
      expect(source).toContain(
         "import { order_items } from '../storefront.malloy'",
      );
      expect(source).toContain(
         '# artifact { title="Sales" } dashboard { columns=12 }',
      );
      expect(source).toContain("query: sales is order_items -> {");
      expect(source).toContain("# colspan=12");
      expect(source).toContain("total_sales");
      expect(source).not.toContain("run:");
   });

   it("does not guess colspans when the query already has a grid", () => {
      const malloy = `run: order_items -> {
  # dashboard { columns=12 }
  aggregate:
    # colspan=3
    total_sales
}`;
      expect(hasDashboardGridTags(malloy)).toBe(true);
      const source = artifactFromExplorer({
         malloy,
         sourceName: "order_items",
         modelPath: "storefront.malloy",
         title: "Sales",
         slug: "sales",
      });
      expect(source).toContain("dashboard { columns=12 }");
      expect(source.match(/# colspan=3/g)?.length).toBe(1);
      expect(source).not.toContain("# colspan=12");
   });

   it("puts a break before the first nest", () => {
      const tagged = applyHeuristicColspans(`  aggregate: a
  nest: by_cat is {
    group_by: category
  }`);
      expect(tagged).toContain("# break");
      expect(tagged).toContain("# colspan=6");
   });
});

describe("slugifyDashboardName", () => {
   it("makes a safe slug", () => {
      expect(slugifyDashboardName("Business Overview")).toBe(
         "business_overview",
      );
      expect(slugifyDashboardName("  ")).toBe("dashboard");
   });
});

describe("sourceNameFromMalloy / importPathFromModel", () => {
   it("reads the source off a run: query", () => {
      expect(sourceNameFromMalloy("run: order_items -> { aggregate: c }")).toBe(
         "order_items",
      );
   });

   it("walks up from dashboards/", () => {
      expect(importPathFromModel("storefront.malloy")).toBe(
         "../storefront.malloy",
      );
      expect(importPathFromModel("models/foo.malloy")).toBe(
         "../models/foo.malloy",
      );
   });
});
