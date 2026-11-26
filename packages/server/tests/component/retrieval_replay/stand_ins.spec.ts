// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The replay's stand-in judge: it reads a prompt through its grammar and
 * fails loudly when the grammar does not match, and its decision for a field
 * depends only on the target and the field, never on what else the call
 * lists or in which order.
 */

import { describe, expect, it } from "bun:test";
import {
   MARKERS,
   parseJudgePrompt,
   StandInError,
   standInJudgeReply,
} from "./stand_ins";

const FORMAT = [
   "Reply with one JSON object and nothing else:",
   '{"picks": [...], "caveats": [...]}',
];

/** A judge prompt in list form: `targets` as [type, text, candidate lines]. */
function prompt(targets: Array<[string, string, string[]]>): string {
   return [
      "Sources with candidates:",
      "- sales - Every sale.",
      "",
      "<targets>",
      ...targets.flatMap(([type, text, lines], i) => [
         `Target ${i + 1} (${type}): ${JSON.stringify(text)}`,
         ...lines,
      ]),
      "</targets>",
      "",
      ...FORMAT,
   ].join("\n");
}

interface Reply {
   picks: Array<{
      target: number;
      candidates: number[];
      best?: number;
      values?: string[];
      readings?: boolean;
   }>;
   caveats: string[];
}

const reply = (p: string) => JSON.parse(standInJudgeReply(p)) as Reply;

/** Fields of three sources, as `[number] name (...; source s): doc` lines. */
function field(n: number, name: string, source: string, doc: string): string {
   return `    [${n}] ${name} (measure, number; source ${source}): ${doc}`;
}

describe("the stand-in judge's grammar", () => {
   const ok = prompt([
      ["measure", "total amount", [field(1, "total_amount", "sales", "Sum.")]],
   ]);

   it("reads a well-formed prompt", () => {
      expect(parseJudgePrompt(ok).targets[0].candidates[0]).toMatchObject({
         number: 1,
         name: "total_amount",
         kind: "measure",
         dataType: "number",
         source: "sales",
         doc: "Sum.",
      });
   });

   const broken: Array<[string, string, RegExp]> = [
      [
         "no targets block",
         ok.replace("<targets>", "<goals>"),
         /no <targets> \.\.\. <\/targets> block/,
      ],
      [
         "a target line in another format",
         ok.replace("Target 1 (measure)", "Goal 1 [measure]"),
         /line before its first target/,
      ],
      [
         "a candidate line in another format",
         ok.replace(
            "[1] total_amount (measure, number; source sales): Sum.",
            "[1] total_amount - measure from sales: Sum.",
         ),
         /cannot read a judge candidate line/,
      ],
      [
         "an unknown line among the candidates",
         ok.replace("</targets>", "  Candidates follow.\n</targets>"),
         /a line the stand-in cannot read/,
      ],
      [
         "no reply format",
         ok.replace("Reply with one JSON object", "Answer"),
         /no "Reply with one JSON object/,
      ],
      ["no target at all", prompt([]), /lists no target/],
      [
         "stored values in another format",
         prompt([
            [
               "dimensional_value",
               "Denver",
               [
                  "    [1] city (dimension, string; source sales): City. | stored values matching the target: 1a Denver [exact]",
               ],
            ],
         ]),
         /cannot read the stored values/,
      ],
   ];
   for (const [name, text, message] of broken) {
      it(`throws a StandInError on ${name}`, () => {
         expect(() => standInJudgeReply(text)).toThrow(StandInError);
         expect(() => standInJudgeReply(text)).toThrow(message);
      });
   }
});

describe("the stand-in judge's decision", () => {
   const lines = {
      sales: [
         field(1, "total_amount", "sales", "Total amount of the sales."),
         field(2, "sale_count", "sales", "Number of sales."),
      ],
      refunds: [
         field(3, "refund_amount", "refunds", "Amount refunded."),
         field(4, "refund_count", "refunds", "Number of refunds."),
      ],
      budgets: [field(5, "total_budget", "budgets", "Planned amount.")],
   };
   /** The picks as `source.name`, best first. */
   const picked = (p: string) => {
      const parsed = parseJudgePrompt(p);
      const byNumber = new Map(
         parsed.targets[0].candidates.map((c) => [
            c.number,
            `${c.source}.${c.name}`,
         ]),
      );
      const r = reply(p).picks[0];
      return {
         picks: r.candidates.map((n) => byNumber.get(n)),
         best: r.best === undefined ? undefined : byNumber.get(r.best),
      };
   };

   it("decides each field the same in one call, in a call per source, and in any order", () => {
      const all = picked(
         prompt([
            [
               "measure",
               "total amount",
               [...lines.sales, ...lines.refunds, ...lines.budgets],
            ],
         ]),
      );
      const reversed = picked(
         prompt([
            [
               "measure",
               "total amount",
               [...lines.budgets, ...lines.refunds, ...lines.sales].reverse(),
            ],
         ]),
      );
      const perSource = Object.values(lines).flatMap(
         (l) => picked(prompt([["measure", "total amount", l]])).picks,
      );
      expect(all.picks).toEqual([
         "sales.total_amount",
         "budgets.total_budget",
         "refunds.refund_amount",
      ]);
      expect(reversed).toEqual(all);
      expect(new Set(perSource)).toEqual(new Set(all.picks));
   });

   it(`makes the second pick best with ${MARKERS.best2}`, () => {
      const plain = picked(prompt([["measure", "sale amount", lines.sales]]));
      const marked = picked(
         prompt([["measure", `sale amount ${MARKERS.best2}`, lines.sales]]),
      );
      expect(plain).toEqual({
         picks: ["sales.total_amount", "sales.sale_count"],
         best: "sales.total_amount",
      });
      expect(marked).toEqual({ ...plain, best: "sales.sale_count" });
   });

   it(`marks readings with ${MARKERS.readings} and names a caveat with ${MARKERS.caveat}`, () => {
      const r = reply(
         prompt([
            [
               "measure",
               `total amount ${MARKERS.readings} ${MARKERS.caveat}`,
               lines.sales,
            ],
         ]),
      );
      expect(r.picks[0].readings).toBe(true);
      expect(r.caveats).toEqual([
         "stand-in caveat: total_amount on sales was a close call for target 1.",
      ]);
   });

   it(`names a field in a caveat with ${MARKERS.name}<field>, and never reads the marker as words`, () => {
      const plain = reply(prompt([["measure", "total amount", lines.sales]]));
      const r = reply(
         prompt([
            ["measure", `total amount ${MARKERS.name}sale_count`, lines.sales],
         ]),
      );
      expect(r.picks).toEqual(plain.picks);
      expect(r.caveats).toEqual([
         "stand-in caveat: sale_count may answer target 1 too.",
      ]);
   });

   it(`names an unoffered candidate first with ${MARKERS.badPick}, and answers the re-ask validly`, () => {
      const p = prompt([
         ["measure", `total amount ${MARKERS.badPick}`, lines.sales],
      ]);
      expect(reply(p).picks[0].candidates).toContain(102);
      const again = `${p}\n\nYour previous reply was:\n{}\n\nIt was rejected: no.\nReply again with only the corrected JSON.`;
      expect(reply(again).picks[0].candidates).not.toContain(102);
   });

   it(`answers with no JSON at all with ${MARKERS.fail}`, () => {
      const text = standInJudgeReply(
         prompt([["measure", `total amount ${MARKERS.fail}`, lines.sales]]),
      );
      expect(() => JSON.parse(text)).toThrow();
   });

   it("picks a route in place of its field when the target names the joining source", () => {
      const p = prompt([
         [
            "measure",
            "number of products that were ordered",
            [
               "  From products:",
               field(1, "product_count", "products", "Distinct products"),
               '        [2] order_items.products.product_count (route from order_items through products, join_one): only the products rows order_items reaches (order_items: "One row per item.")',
               "        [3] overview.products.product_count (route from overview through products, join_one): only the products rows overview reaches",
            ],
         ],
      ]);
      expect(reply(p).picks[0].candidates).toEqual([2]);
   });

   it("names the values that hold the target as a word, else every value matched by spelling", () => {
      const line = (n: number, values: string) =>
         `    [${n}] city (dimension, string; source s${n}): City. | stored values matching the target: ${values}`;
      const r = reply(
         prompt([
            [
               "dimensional_value",
               "Springfield",
               [
                  line(
                     1,
                     '1a "West Springfield" (words, 0.94), 1b "Springfeld Heights" (words, 0.69)',
                  ),
                  line(
                     2,
                     '2a "Springfeld" (typo, 0.70), 2b "Spring" (meaning, 0.40)',
                  ),
                  line(3, '3a "Shelbyville" (meaning, 0.30)'),
               ],
            ],
         ]),
      );
      expect(r.picks[0].candidates).toEqual([1, 2]);
      expect(r.picks[0].values).toEqual(["1a", "2a"]);
   });
});
