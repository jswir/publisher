// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
   GET_CONTEXT_BOXES,
   recordGetContextBox,
   resetGetContextTelemetryForTesting,
} from "./get_context_metrics";
import {
   startMetricsHarness,
   type MetricsHarness,
} from "./test_helpers/metrics_harness";

describe("get_context_metrics", () => {
   let harness: MetricsHarness;

   beforeEach(async () => {
      harness = await startMetricsHarness();
      resetGetContextTelemetryForTesting();
   });

   afterEach(async () => {
      resetGetContextTelemetryForTesting();
      await harness.shutdown();
   });

   it("records one duration per box, labelled by the box", async () => {
      expect(GET_CONTEXT_BOXES).toEqual([
         "authorize",
         "queries",
         "search",
         "group",
         "rerank",
         "format",
      ]);
      recordGetContextBox("rerank", 1_200);
      recordGetContextBox("rerank", 800);
      recordGetContextBox("search", 3);
      const rerank = await harness.collectHistogram(
         "publisher_get_context_box_duration_ms",
         { box: "rerank" },
      );
      expect(rerank.count).toBe(2);
      expect(rerank.sum).toBe(2_000);
   });
});
