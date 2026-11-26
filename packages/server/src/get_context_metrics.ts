// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Telemetry for a ranked get_context call: how long each of its six boxes
 * took. One histogram, labelled `box`, whose values are the fixed list
 * {@link GET_CONTEXT_BOXES}, so the label set is bounded. A box that did not
 * run (a refused Call, a page served from a held result) records nothing.
 *
 * Created lazily for the same reason as ./llm_metrics.ts: an instrument
 * created before `setGlobalMeterProvider` binds to a NoOp meter.
 */

import { lazyHistogram, resetInstrumentsForTesting } from "./telemetry";

/** The boxes of a ranked call, in the order they run. */
export const GET_CONTEXT_BOXES = [
   "authorize",
   "queries",
   "search",
   "group",
   "rerank",
   "format",
] as const;
export type GetContextBox = (typeof GET_CONTEXT_BOXES)[number];

const boxHistogram = lazyHistogram(
   "publisher_get_context_box_duration_ms",
   "Wall-clock duration of one box of a ranked get_context call. Label: box (" +
      `${GET_CONTEXT_BOXES.map((b) => `'${b}'`).join("|")}).`,
);

export function recordGetContextBox(box: GetContextBox, ms: number): void {
   boxHistogram().record(ms, { box });
}

/** Test seam: drop cached instruments so they re-bind to a new MeterProvider. */
export function resetGetContextTelemetryForTesting(): void {
   resetInstrumentsForTesting();
}
