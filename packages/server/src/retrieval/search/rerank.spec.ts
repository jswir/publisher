// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
   buildFcjIndexFixture,
   type FcjIndexFixture,
} from "../../test_helpers/fcj_index_fixture";
import { embedText } from "../../test_helpers/get_context_llm_harness";
import { toUnit } from "../index/vectors";
import type { ChatModel, JsonChatRequest } from "../llm/types";
import { ChatModelImpl } from "../llm/chat_model";
import { LlmMeter } from "../llm/llm_calls";
import { KINDS_BY_TARGET, search, type Target } from "./find";
import { groupBySource, type Grouped } from "./group";
import {
   DEGRADED_WARNING,
   MAX_RERANK_DEADLINE_MS,
   ORDER_GRACE_MS,
   PICK_ATTEMPTS,
   PICK_ATTEMPT_MS,
   rerank,
   rerankBounds,
   unjudged,
} from "./rerank";

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

const TARGETS = [
   t(0, "measure", "number of flights"),
   t(1, "dimension", "city name"),
];

function grouped(
   targets = TARGETS,
   allow: (n: { source: string }) => boolean = () => true,
): Grouped {
   return groupBySource({
      index: f.index,
      allow: (n) => allow(n),
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
}

const COUNT = "measure:flights@travel.malloy:flight_count";
const STATE = "dimension:cities@travel.malloy:state";
const CITIES = "cities@travel.malloy";
const TWO = [t(0, "measure", "flights"), t(1, "dimension", "state")];

/**
 * Two kept sources, each the only holder of one target: flights (its count)
 * and cities (its state; no source joins cities).
 */
function twoSources(): Grouped {
   const hit = (target: Target, key: string) => ({
      target,
      candidates: [{ key, score: 1, ranks: {} }],
      lists: { close: 0, keyword: 0, value: 0, valueMeaning: 0 },
      valuePhrases: [],
      meaningPhrases: [],
   });
   const g = groupBySource({
      index: f.index,
      hits: [hit(TWO[0], COUNT), hit(TWO[1], STATE)],
      allow: () => true,
   });
   expect(g.sources.map((s) => s.source)).toEqual([
      "flights@travel.malloy",
      CITIES,
   ]);
   return g;
}

/** Box 5 under a metered real client with `limit` requests, recording what was sent. */
async function metered(limit: number, fail: (source: string) => void) {
   const sent: string[] = [];
   const raw = {
      send: async (req: { prompt: string }) => {
         const isOrder = req.prompt.includes("<sources>");
         const source = sourceOf(req.prompt) ?? "";
         if (!isOrder) fail(source);
         sent.push(isOrder ? "order" : `pick ${source}`);
         return {
            text: isOrder
               ? '{"sources":[1,2]}'
               : JSON.stringify(
                    pickFirst({
                       prompt: req.prompt,
                    } as JsonChatRequest<unknown>),
                 ),
            usage: {},
         };
      },
   };
   const chat = new ChatModelImpl("openai", "m", raw as never, {
      timeoutMs: 10_000,
   });
   const meter = new LlmMeter(limit);
   const out = await rerank({
      index: f.index,
      grouped: twoSources(),
      targets: TWO,
      chat: meter.wrap(chat),
      concurrency: 4,
      bounds: rerankBounds(30_000),
      remaining: () => meter.remaining(),
   });
   return { sent, out };
}

/** The source a pick prompt shows. */
const sourceOf = (prompt: string) => /^Source: (\S+)/m.exec(prompt)?.[1];

type Reply = (req: JsonChatRequest<unknown>) => unknown | Promise<unknown>;

/** A chat model that answers by rule, records every call, and honours the call's signal. */
function fakeChat(pick: Reply, order: Reply) {
   const calls: Array<{ kind: "pick" | "order"; prompt: string }> = [];
   const chat: ChatModel = {
      provider: "openai-compatible",
      model: "fake",
      // The ordering call: one plain request, its reply read as JSON.
      complete: async (req) => {
         calls.push({ kind: "order", prompt: req.prompt });
         const value = await Promise.race([
            Promise.resolve(
               order({
                  ...req,
                  validate: (v) => v,
               } as JsonChatRequest<unknown>),
            ),
            new Promise<never>((_, reject) => {
               const cut = () => reject(req.signal?.reason);
               if (req.signal?.aborted) cut();
               else req.signal?.addEventListener("abort", cut, { once: true });
            }),
         ]);
         return {
            text: typeof value === "string" ? value : JSON.stringify(value),
            usage: {},
         };
      },
      completeJson: async <T>(req: JsonChatRequest<T>) => {
         const kind = req.prompt.includes("<sources>") ? "order" : "pick";
         calls.push({ kind, prompt: req.prompt });
         const answer = (kind === "pick" ? pick : order)(
            req as JsonChatRequest<unknown>,
         );
         const value = await Promise.race([
            Promise.resolve(answer),
            new Promise<never>((_, reject) => {
               const cut = () => reject(req.signal?.reason);
               if (req.signal?.aborted) cut();
               else req.signal?.addEventListener("abort", cut, { once: true });
            }),
         ]);
         return { value: req.validate(value), usage: {} };
      },
   };
   return { chat, calls };
}

/** Picks the first field listed under every target. */
const pickFirst: Reply = (req) => {
   const targets = [...req.prompt.matchAll(/^Target (\d+) /gm)].map((m) =>
      Number(m[1]),
   );
   const first = /^ {2}\[(\d+)\] /m.exec(req.prompt)?.[1];
   return {
      picks: targets.map((n) => ({
         target: n,
         candidates: first ? [Number(first)] : [],
         reason: `from ${sourceOf(req.prompt)}`,
      })),
      caveats: [],
   };
};
const reversed: Reply = (req) => ({
   sources: [...req.prompt.matchAll(/^\[(\d+)\] /gm)]
      .map((m) => Number(m[1]))
      .reverse(),
});
const never: Reply = () => new Promise(() => undefined);

const FAST = { attemptMs: 100, deadlineMs: 400, graceMs: 20 };

describe("rerankBounds", () => {
   it("gives a pick attempt a fifth of timeoutMs, at least 6 s and at most timeoutMs itself, and the stage two attempts", () => {
      expect(PICK_ATTEMPTS).toBe(2);
      expect(PICK_ATTEMPT_MS).toBe(6_000);
      expect(ORDER_GRACE_MS).toBe(300);
      expect(rerankBounds(30_000)).toEqual({
         attemptMs: 6_000,
         deadlineMs: 12_000,
         graceMs: 300,
      });
      expect(rerankBounds(120_000)).toMatchObject({
         attemptMs: 24_000,
         deadlineMs: 48_000,
      });
      expect(rerankBounds(3_000)).toMatchObject({
         attemptMs: 3_000,
         deadlineMs: 6_000,
      });
      expect(rerankBounds(1_000_000).deadlineMs).toBe(MAX_RERANK_DEADLINE_MS);
   });
});

describe("rerank (box 5)", () => {
   it("makes one pick call per kept source and one ordering call, both shown the question, and serves the ordering call's order", async () => {
      const g = grouped();
      expect(g.sources.length).toBeGreaterThan(1);
      const { chat, calls } = fakeChat(pickFirst, reversed);
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         question: "Which city has the most flights?",
         chat,
         concurrency: 2,
         bounds: FAST,
      });
      expect(calls.filter((c) => c.kind === "pick")).toHaveLength(
         g.sources.length,
      );
      expect(calls.filter((c) => c.kind === "order")).toHaveLength(1);
      expect(
         calls.every((c) =>
            c.prompt.includes('"Which city has the most flights?"'),
         ),
      ).toBe(true);
      expect(out.mode).toBe("judged");
      expect(out.order).toBe("ordered");
      expect(out.sources.map((s) => s.source)).toEqual(
         g.sources.map((s) => s.source).reverse(),
      );
      // Each source keeps its own call's reason.
      for (const s of out.sources) {
         const name = f.index.catalog.sources.get(s.source)!.name;
         expect(s.picks.every((p) => p.reason === `from ${name}`)).toBe(true);
      }
   });

   it("leaves out a source whose call fails twice; the others serve", async () => {
      const g = grouped();
      const failing = g.sources[0].source;
      const name = f.index.catalog.sources.get(failing)!.name;
      const { chat, calls } = fakeChat((req) => {
         if (sourceOf(req.prompt) === name) throw new Error("bad gateway");
         return pickFirst(req);
      }, reversed);
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat,
         concurrency: 4,
         bounds: FAST,
      });
      expect(out.mode).toBe("judged");
      expect(out.sources.map((s) => s.source)).not.toContain(failing);
      expect(out.sources).toHaveLength(g.sources.length - 1);
      expect(out.calls.find((c) => c.source === failing)).toMatchObject({
         outcome: "failed",
         attempts: 2,
         error: "bad gateway",
      });
      expect(
         calls.filter((c) => c.kind === "pick" && sourceOf(c.prompt) === name),
      ).toHaveLength(2);
      expect(out.warnings).toHaveLength(1);
      expect(out.warnings[0]).toStartWith(
         `The final ranking step failed for source ${name}, so its fields were not considered.`,
      );
      expect(out.warnings[0]).toContain("scopes[].source");
   });

   it("serves a failed source's top hits, unjudged, for a target only it held, and says so", async () => {
      const g = twoSources();
      const { chat } = fakeChat((req) => {
         if (sourceOf(req.prompt) === "cities") throw new Error("vendor 500");
         return pickFirst(req);
      }, reversed);
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TWO,
         chat,
         concurrency: 4,
         bounds: FAST,
      });
      expect(out.mode).toBe("judged");
      expect(out.calls.find((c) => c.source === CITIES)).toMatchObject({
         outcome: "failed",
      });
      // cities held target 1 alone: its hit is served, not read as a no.
      const cities = out.sources.find((s) => s.source === CITIES);
      expect(cities?.picks).toEqual([{ target: 1, keys: [STATE] }]);
      expect(cities?.picks[0].reason).toBeUndefined();
      expect(out.warnings).toEqual([
         "The final ranking step failed for source cities, so its fields were not considered. For a target no ranked source answered, the top search matches on cities are served without ranking. Calling get_context again, or with scopes[].source set to that source, may return its fields.",
      ]);
   });

   it("counts the ordering call once against maxCallsPerRequest: a limit of 5 sends both pick calls", async () => {
      const { sent, out } = await metered(5, () => undefined);
      expect(sent.sort()).toEqual(["order", "pick cities", "pick flights"]);
      expect(out.calls.map((c) => c.outcome)).toEqual(["answered", "answered"]);
      expect(out.warnings).toEqual([]);
   });

   it("names a source the call limit left unsent, and serves its only target unjudged", async () => {
      // 3 = the ordering call + one pick call (two slots: its JSON re-ask).
      const { sent, out } = await metered(3, () => undefined);
      expect(sent.sort()).toEqual(["order", "pick flights"]);
      expect(out.calls.find((c) => c.source === CITIES)).toMatchObject({
         outcome: "failed",
         attempts: 0,
      });
      expect(out.sources.find((s) => s.source === CITIES)?.picks).toEqual([
         { target: 1, keys: [STATE] },
      ]);
      expect(out.warnings).toEqual([
         "Source cities was not ranked because this request reached its limit on model calls, so its fields were not considered. For a target no ranked source answered, the top search matches on cities are served without ranking. Calling get_context again, or with scopes[].source set to that source, may return its fields.",
      ]);
   });

   it("retries a late attempt once, inside the attempt bound", async () => {
      const g = grouped([t(0, "measure", "number of flights")], () => true);
      let n = 0;
      const { chat } = fakeChat(
         (req) => (++n === 1 ? never(req) : pickFirst(req)),
         reversed,
      );
      const solo = { sources: g.sources.slice(0, 1), unresolved: [] };
      const started = Date.now();
      const out = await rerank({
         index: f.index,
         grouped: solo,
         targets: [t(0, "measure", "number of flights")],
         chat,
         concurrency: 1,
         bounds: FAST,
      });
      expect(out.calls[0]).toMatchObject({ outcome: "answered", attempts: 2 });
      expect(Date.now() - started).toBeLessThan(FAST.deadlineMs);
   });

   it("serves search's top hits with the warning, never an error, when every pick call fails", async () => {
      const g = grouped();
      const { chat } = fakeChat(() => {
         throw new Error("model down");
      }, reversed);
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat,
         concurrency: 4,
         bounds: FAST,
      });
      expect(out.mode).toBe("degraded");
      expect(out.order).toBe("box4");
      expect(out.warnings).toEqual([DEGRADED_WARNING]);
      expect(DEGRADED_WARNING).toStartWith(
         "The final ranking step was unavailable, so these results are the top few search matches without it.",
      );
      expect(out.sources).toEqual(unjudged(g, TARGETS));
      // A measure target serves its top two hits, a dimension its top five.
      const count = (target: number) =>
         out.sources.reduce(
            (n, s) =>
               n + (s.picks.find((p) => p.target === target)?.keys.length ?? 0),
            0,
         );
      expect(count(0)).toBe(2);
      expect(count(1)).toBeLessThanOrEqual(5);
   });

   it("ends at the stage deadline when every call hangs, and still answers", async () => {
      const g = grouped();
      const { chat } = fakeChat(never, never);
      const started = Date.now();
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat,
         concurrency: 1,
         bounds: { attemptMs: 1_000, deadlineMs: 150, graceMs: 20 },
      });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(out.mode).toBe("degraded");
   });

   it("keeps box 4's order when the ordering call is late, cut after the grace", async () => {
      const g = grouped();
      const { chat } = fakeChat(pickFirst, never);
      const started = Date.now();
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat,
         concurrency: 4,
         bounds: { attemptMs: 2_000, deadlineMs: 4_000, graceMs: 30 },
      });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(out.order).toBe("box4");
      const served = out.sources.map((s) => s.source);
      expect(served).toEqual(
         g.sources.map((s) => s.source).filter((s) => served.includes(s)),
      );
   });

   it("keeps box 4's order when the ordering reply is unusable", async () => {
      const g = grouped();
      for (const bad of [{ sources: [] }, { sources: [99] }, "nonsense"]) {
         const { chat } = fakeChat(pickFirst, () => bad);
         const out = await rerank({
            index: f.index,
            grouped: g,
            targets: TARGETS,
            chat,
            concurrency: 4,
            bounds: FAST,
         });
         expect(out.order).toBe("box4");
      }
   });

   it("makes no ordering call for one kept source", async () => {
      const g = grouped(
         TARGETS,
         (n: { source: string }) => n.source === "flights",
      );
      expect(g.sources).toHaveLength(1);
      const { chat, calls } = fakeChat(pickFirst, reversed);
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat,
         concurrency: 1,
         bounds: FAST,
      });
      expect(calls.map((c) => c.kind)).toEqual(["pick"]);
      expect(out.order).toBe("one_source");
   });

   it("calls nothing without a model: box 4's sources, each target's top hits", async () => {
      const g = grouped();
      const out = await rerank({
         index: f.index,
         grouped: g,
         targets: TARGETS,
         chat: null,
         concurrency: 1,
         bounds: FAST,
      });
      expect(out).toMatchObject({ mode: "unjudged", calls: [], warnings: [] });
      expect(out.sources.map((s) => s.source)).toEqual(
         g.sources.map((s) => s.source),
      );
   });
});
