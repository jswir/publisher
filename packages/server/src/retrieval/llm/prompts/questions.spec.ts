// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { QUESTIONS_INSTRUCTIONS } from "./questions";
import { QUESTIONS_PER_NODE } from "../../index/questions";

const hash = (t: string) =>
   createHash("sha256").update(t).digest("hex").slice(0, 16);

describe("the index-time question instructions", () => {
   it("keeps the text the stored rows were written with", () => {
      // 042ba2dc... is the prompt_hash of the node_questions rows already
      // stored, so a build reuses them. Editing the text changes it, and
      // every package regenerates its rows on its next build: update this
      // pin only on purpose.
      expect(hash(QUESTIONS_INSTRUCTIONS)).toBe("042ba2dc0849f726");
      expect(QUESTIONS_INSTRUCTIONS).toContain(
         `write ${QUESTIONS_PER_NODE} short questions`,
      );
   });
});
