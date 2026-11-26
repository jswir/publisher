// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { beforeAll, describe, expect, it } from "bun:test";
import { compileFcjFixture } from "../../test_helpers/fcj_fixture";
import type { Catalog } from "../model/catalog";
import { buildCatalog, catalogInputOf } from "../model/catalog";

/**
 * Sources marked `#(agent-hidden)`, on the source or on its file, among
 * extensions that inherit the same fields.
 */
const FILES: Record<string, string> = {
   "deliveries.malloy": `
#(doc) Every delivery row, all channels.
source: deliveries is duckdb.sql("select 1 as id, 'web' as channel, 10 as households, 'A' as audience") extend {
  #(doc) Households reached.
  measure: reach is households.sum()
  #(doc) The audience segment.
  dimension: audience_name is audience
}

#(doc) Web deliveries only.
source: web_deliveries is deliveries extend { where: channel = 'web' }

#(doc) Deliveries with a channel label.
source: labelled_deliveries is deliveries extend { dimension: channel_label is upper(channel) }

#(doc) Web deliveries with a label.
source: labelled_web is web_deliveries extend { dimension: web_label is 'web' }

source: deliveries_again is deliveries

#(agent-hidden)
#(doc) Internal base: every impression row.
source: impressions is duckdb.sql("select 1 as id, 5 as n, 'A' as audience") extend {
  #(doc) Impressions served.
  measure: impression_count is n.sum()
}

#(doc) Impressions for all audiences combined.
source: impressions_total is impressions extend { where: audience = 'A' }

source: impressions_plain is impressions extend { dimension: aud is audience }
`,
   "lookups.malloy": `
##(agent-hidden)
#(doc) Code to label lookups.
source: lookups is duckdb.sql("select 'A' as code, 'Alpha' as label")
`,
   "codes.malloy": `
##(agent-hidden)
#(doc) Internal status codes, imported by no other file.
source: status_codes is duckdb.sql("select 'A' as code")
`,
   "panel.malloy": `
#(agent-hidden)
#(doc) Internal panel weights.
source: panel is duckdb.sql("select 'A' as code, 2 as weight")
`,
   "hub.malloy": `
import "lookups.malloy"
import "panel.malloy"
#(doc) One row per order.
source: hub is duckdb.sql("select 'A' as code, 1 as id") extend {
  join_one: lookups on lookups.code = code
  join_one: panel on panel.code = code
}
`,
};

let catalog: Catalog;
const node = (kind: string, source: string, name: string) =>
   [...catalog.nodes.values()].find(
      (n) => n.kind === kind && n.source === source && n.name === name,
   );

beforeAll(async () => {
   const { pkgIndex } = await compileFcjFixture(FILES, {});
   catalog = buildCatalog({
      ...(await catalogInputOf(pkgIndex)),
      // The shipping setting: joined copies of fields whose source is not
      // served (here: hidden) on the served sources that join to them.
      unservedCopies: 3,
   });
});

describe("hidden sources", () => {
   it("leaves out #(agent-hidden) sources, and sources served only through ##(agent-hidden) files", () => {
      const names = [...catalog.sources.values()].map((s) => s.name).sort();
      // impressions and panel are marked on the source; status_codes is
      // served only through its hidden file.
      expect(names).toEqual([
         "deliveries",
         "deliveries_again",
         "hub",
         "impressions_plain",
         "impressions_total",
         "labelled_deliveries",
         "labelled_web",
         "lookups",
         "web_deliveries",
      ]);
      expect(catalog.report.hiddenSources).toBe(3);
   });

   it("serves a source from a ##(agent-hidden) file that another file imports", () => {
      // Hidden from search only: the defining file still answers queries.
      const lookups = [...catalog.sources.values()].find(
         (s) => s.name === "lookups",
      )!;
      expect(lookups.modelPaths).toEqual(["lookups.malloy"]);
   });

   it("keeps a #(agent-hidden) source hidden in a file that imports it", () => {
      expect(
         [...catalog.sources.values()].some((s) => s.name === "panel"),
      ).toBe(false);
   });

   it("a hidden base's mark does not carry to the sources that extend it", () => {
      // Each keeps the field it inherits from the hidden base as its own.
      for (const source of ["impressions_total", "impressions_plain"]) {
         expect(node("measure", source, "impression_count")).toBeDefined();
      }
   });

   it("a hidden source's fields are reached through a served source's join", () => {
      expect(node("dimension", "hub", "panel.weight")).toBeDefined();
   });
});

describe("a hidden table source and its extensions", () => {
   let c: Catalog;
   beforeAll(async () => {
      const { pkgIndex } = await compileFcjFixture(
         {
            "t.malloy": `
#(agent-hidden)
#(doc) Every table.
source: base is duckdb.table('information_schema.tables') extend {
  measure: n is count()
}
source: plain is base extend { dimension: d is 1 }
#(doc) Tables in the main schema only.
source: mains is base extend { where: table_schema = 'main' }
#(doc) Every table, served.
source: vbase is duckdb.table('information_schema.tables') extend { measure: m is count() }
source: vplain is vbase extend { dimension: d is 1 }
source: vwhere is vbase extend { where: table_schema = 'main' }
`,
         },
         {},
      );
      c = buildCatalog(await catalogInputOf(pkgIndex));
   });
   it("reads a hidden mark only from the notes above the source itself", () => {
      // `plain` has no notes of its own; the compiler hands it base's.
      expect([...c.sources.values()].map((s) => s.name)).toEqual([
         "plain",
         "mains",
         "vbase",
         "vplain",
         "vwhere",
      ]);
   });
});
