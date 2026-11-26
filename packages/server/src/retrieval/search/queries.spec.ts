// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { KINDS_BY_TARGET, type Target } from "./find";
import { buildQueries } from "./queries";

const t = (index: number, text: string): Target => ({
   index,
   type: "measure",
   text,
   kinds: KINDS_BY_TARGET.measure,
});

describe("buildQueries (box 2)", () => {
   it("embeds every target's text in one call, with the query prefix, as unit vectors in the targets' order", async () => {
      const sent: string[][] = [];
      const queries = await buildQueries({
         targets: [t(0, "revenue"), t(1, "orders")],
         provider: {
            queryPrefix: "q: ",
            embedBatch: async (texts) => {
               sent.push(texts);
               return texts.map((_, i) => [3 * (i + 1), 4 * (i + 1)]);
            },
         },
      });
      expect(sent).toEqual([["q: revenue", "q: orders"]]);
      expect(queries.map((q) => q.target.text)).toEqual(["revenue", "orders"]);
      expect(
         [...queries[1].vector!].map((x) => Math.round(x * 10) / 10),
      ).toEqual([0.6, 0.8]);
   });

   it("makes no call and gives no vector without a provider", async () => {
      const queries = await buildQueries({
         targets: [t(0, "revenue")],
         provider: null,
      });
      expect(queries).toEqual([{ target: t(0, "revenue") }]);
   });
});
