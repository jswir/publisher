// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PackageManifestError } from "../errors";
import {
   DEFAULT_FCJ_SETTINGS,
   DEFAULT_PACKAGE_RETRIEVAL,
   fcjSettingsOf,
   assertRequiredStagesAvailable,
   ignoredRetrievalWarnings,
   parsePackageRetrieval,
   readPackageRetrieval,
   resolvePromptPath,
   sourceSummaryConfigOf,
} from "./package_retrieval_settings";

describe("publisher.json retrieval block", () => {
   it("defaults to no overrides, so every package gets the engine's defaults", async () => {
      expect(await readPackageRetrieval("/nonexistent", undefined)).toEqual(
         DEFAULT_PACKAGE_RETRIEVAL,
      );
      expect(DEFAULT_PACKAGE_RETRIEVAL).toEqual({ prompts: {} });
      expect(fcjSettingsOf(DEFAULT_PACKAGE_RETRIEVAL)).toEqual(
         DEFAULT_FCJ_SETTINGS,
      );
   });

   it("rejects a block that is not an object, with a fix", () => {
      expect(() => parsePackageRetrieval("on")).toThrow(
         "Invalid publisher.json retrieval: expected an object",
      );
   });

   it("reads the fcj knobs, defaulting each unset knob", () => {
      const parsed = parsePackageRetrieval({
         fcj: { valueCap: 50, judge: false },
      });
      expect(parsed.fcj).toEqual({
         ...DEFAULT_FCJ_SETTINGS,
         valueCap: 50,
         judge: false,
      });
      expect(fcjSettingsOf(undefined)).toEqual(DEFAULT_FCJ_SETTINGS);
      expect(DEFAULT_FCJ_SETTINGS).toEqual({
         questions: "auto",
         docParts: "auto",
         values: true,
         valueCap: 5_000,
         valueEmbeddings: true,
         judge: "auto",
      });
   });

   it("rejects a bad knob with the range and a fix", () => {
      expect(() => parsePackageRetrieval({ fcj: { valueCap: 2.5 } })).toThrow(
         'Invalid publisher.json retrieval.fcj.valueCap: expected an integer from 1 to 1000000, got 2.5. Fix: "valueCap": 5000',
      );
      expect(() => parsePackageRetrieval({ fcj: { values: "yes" } })).toThrow(
         'Invalid publisher.json retrieval.fcj.values: expected true or false, got "yes". Fix: "values": true',
      );
      expect(() => parsePackageRetrieval({ fcj: { window: 3 } })).toThrow(
         "Invalid publisher.json retrieval.fcj: unknown key 'window'. Valid keys: questions, docParts, values, valueCap, valueEmbeddings, judge, perTarget,",
      );
   });

   it("loads a retired fcj knob, whatever its value, ignores it, and warns once naming it", () => {
      const raw = {
         fcj: {
            connect: "clusters",
            perTarget: "not even a number",
            listRoutes: 3,
            judgeLlm: { model: "m" },
            values: false,
         },
      };
      expect(parsePackageRetrieval(raw).fcj).toEqual({
         ...DEFAULT_FCJ_SETTINGS,
         values: false,
      });
      const warnings = ignoredRetrievalWarnings(raw);
      expect(warnings).toHaveLength(4);
      expect(warnings[0]).toBe(
         "publisher.json retrieval.fcj.perTarget no longer does anything and is ignored: the search engine it tuned is gone; get_context now ranks by source with one judge call per source. Fix: remove the key.",
      );
      expect(warnings.map((w) => w.split(" ")[1])).toEqual([
         "retrieval.fcj.perTarget",
         "retrieval.fcj.connect",
         "retrieval.fcj.listRoutes",
         "retrieval.fcj.judgeLlm",
      ]);
      expect(ignoredRetrievalWarnings({ fcj: { values: false } })).toEqual([]);
   });

   it("an unknown key is an error that names the valid keys, so a typo or a later release's key is not silently ignored", () => {
      let error: unknown;
      try {
         parsePackageRetrieval({ rephrase: { enabled: true } });
      } catch (e) {
         error = e;
      }
      expect(error).toBeInstanceOf(PackageManifestError);
      expect((error as Error).message).toBe(
         "Invalid publisher.json retrieval: unknown key 'rephrase'. Valid keys: sourceSummary, prompts, fcj.",
      );
      expect(() =>
         parsePackageRetrieval({ prompts: { rephrase: "p.md" } }),
      ).toThrow(
         "retrieval.prompts: unknown key 'rephrase'. Valid keys: sourceSummary, judge, docParts, questions.",
      );
   });
});

describe("keys of the retrieval block that an earlier release read", () => {
   const OLD_BLOCK = {
      representation: "facets",
      keyphrases: "always",
      refine: { enabled: true, minLevel: "HIGH" },
      rerank: { enabled: true, topSources: 3 },
      sourceMatch: { enabled: true },
      prompts: {
         keyphrase: "prompts/k.md",
         refine: "prompts/r.md",
         rerank: "prompts/rr.md",
         sourceMatch: "prompts/s.md",
      },
   };

   it("load, whatever their value, and leave the settings as the defaults", async () => {
      // None of the prompt files exists, and the block has a stage turned on
      // that needs an LLM: neither stops the load, because none is read.
      const settings = await readPackageRetrieval("/nonexistent", OLD_BLOCK);
      expect(settings).toEqual(DEFAULT_PACKAGE_RETRIEVAL);
      expect(() =>
         assertRequiredStagesAvailable(settings, false),
      ).not.toThrow();
      // Not even a value the old release refused.
      expect(parsePackageRetrieval({ refine: "on", rerank: 3 })).toEqual({
         promptPaths: {},
      });
   });

   it("do not include engine, which no release read: it is an unknown key", () => {
      expect(() => parsePackageRetrieval({ engine: "fcj" })).toThrow(
         "unknown key 'engine'",
      );
   });

   it("keep the keys that still work beside them", async () => {
      const parsed = parsePackageRetrieval({
         ...OLD_BLOCK,
         fcj: { valueCap: 50 },
         sourceSummary: { enabled: false },
      });
      expect(parsed.fcj?.valueCap).toBe(50);
      expect(parsed.sourceSummary).toEqual({ enabled: false });
   });

   it("are reported once each, naming the key and saying it no longer does anything", () => {
      const warnings = ignoredRetrievalWarnings(OLD_BLOCK);
      expect(warnings).toEqual([
         "publisher.json retrieval.representation no longer does anything and is ignored: the search index no longer keeps a per-entity text representation. Fix: remove the key.",
         "publisher.json retrieval.keyphrases no longer does anything and is ignored: the search index no longer writes keyphrases. Fix: remove the key.",
         "publisher.json retrieval.refine no longer does anything and is ignored: the engine's judge step replaces it (retrieval.fcj.judge turns that step off). Fix: remove the key.",
         "publisher.json retrieval.rerank no longer does anything and is ignored: the engine's judge step replaces it (retrieval.fcj.judge turns that step off). Fix: remove the key.",
         "publisher.json retrieval.sourceMatch no longer does anything and is ignored: the engine's judge step replaces it (retrieval.fcj.judge turns that step off). Fix: remove the key.",
         "publisher.json retrieval.prompts.keyphrase no longer does anything and is ignored: the search index no longer writes keyphrases. Fix: remove the key.",
         "publisher.json retrieval.prompts.refine no longer does anything and is ignored: the refine step is gone; retrieval.prompts.judge replaces the judge's instructions. Fix: remove the key.",
         "publisher.json retrieval.prompts.rerank no longer does anything and is ignored: the rerank step is gone; retrieval.prompts.judge replaces the judge's instructions. Fix: remove the key.",
         "publisher.json retrieval.prompts.sourceMatch no longer does anything and is ignored: the source match step is gone; retrieval.prompts.judge replaces the judge's instructions. Fix: remove the key.",
      ]);
   });

   it("say nothing for a block that sets none of them", () => {
      expect(ignoredRetrievalWarnings(undefined)).toEqual([]);
      expect(ignoredRetrievalWarnings("on")).toEqual([]);
      expect(
         ignoredRetrievalWarnings({
            fcj: { valueCap: 50 },
            sourceSummary: { enabled: "auto" },
            prompts: { judge: "prompts/j.md" },
         }),
      ).toEqual([]);
   });

   it("do not make a typo pass: an unknown key is still an error", () => {
      expect(() => parsePackageRetrieval({ rerankk: {} })).toThrow(
         "unknown key 'rerankk'",
      );
   });
});

describe("retrieval.sourceSummary", () => {
   it("defaults to auto and parses enabled", () => {
      expect(sourceSummaryConfigOf(DEFAULT_PACKAGE_RETRIEVAL)).toEqual({
         enabled: "auto",
      });
      expect("sourceSummary" in parsePackageRetrieval({})).toBe(false);
      for (const enabled of ["auto", true, false] as const) {
         expect(
            parsePackageRetrieval({ sourceSummary: { enabled } }).sourceSummary,
         ).toEqual({ enabled });
      }
      expect(
         parsePackageRetrieval({ sourceSummary: {} }).sourceSummary,
      ).toEqual({ enabled: "auto" });
   });

   it("rejects a bad value or an unknown key, naming the key and a fix", () => {
      expect(() =>
         parsePackageRetrieval({ sourceSummary: { enabled: "yes" } }),
      ).toThrow(
         'Invalid publisher.json retrieval.sourceSummary.enabled: expected "auto", true or false, got "yes". Fix:',
      );
      expect(() =>
         parsePackageRetrieval({ sourceSummary: { maxFields: 3 } }),
      ).toThrow(
         "retrieval.sourceSummary: unknown key 'maxFields'. Valid keys: enabled.",
      );
      expect(() => parsePackageRetrieval({ sourceSummary: true })).toThrow(
         "Invalid publisher.json retrieval.sourceSummary: expected an object, got true. Fix:",
      );
   });

   it("enabled: true without an LLM stops the load and names both fixes", () => {
      const settings = readSync({ sourceSummary: { enabled: true } });
      expect(() => assertRequiredStagesAvailable(settings, false)).toThrow(
         PackageManifestError,
      );
      expect(() => assertRequiredStagesAvailable(settings, false)).toThrow(
         /retrieval\.sourceSummary\.enabled: true needs an LLM.*retrieval\.llm.*LLM_API_KEY.*"auto"/s,
      );
      expect(() => assertRequiredStagesAvailable(settings, true)).not.toThrow();
      for (const enabled of ["auto", false]) {
         expect(() =>
            assertRequiredStagesAvailable(
               readSync({ sourceSummary: { enabled } }),
               false,
            ),
         ).not.toThrow();
      }
   });

   it("reads the sourceSummary prompt, with the same path rules as the others", async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-summary-"));
      const root = path.join(base, "pkg");
      fs.mkdirSync(path.join(root, "prompts"), { recursive: true });
      try {
         fs.writeFileSync(path.join(root, "prompts", "s.md"), "Summarize.");
         const s = await readPackageRetrieval(root, {
            prompts: { sourceSummary: "prompts/s.md" },
         });
         expect(s.prompts.sourceSummary).toMatchObject({
            path: "prompts/s.md",
            text: "Summarize.",
         });
         expect(s.prompts.sourceSummary?.hash).toMatch(/^[0-9a-f]{64}$/);
         await expect(
            readPackageRetrieval(root, {
               prompts: { sourceSummary: "../x.md" },
            }),
         ).rejects.toThrow(
            /retrieval\.prompts\.sourceSummary: "\.\.\/x\.md" resolves outside the package directory\. Fix: use a path inside the package, e\.g\. "prompts\/sourceSummary\.md"/,
         );
         await expect(
            readPackageRetrieval(root, {
               prompts: { sourceSummary: path.join(base, "x.md") },
            }),
         ).rejects.toThrow("is an absolute path");
         await expect(
            readPackageRetrieval(root, {
               prompts: { sourceSummary: "prompts/none.md" },
            }),
         ).rejects.toThrow("retrieval.prompts.sourceSummary: cannot read");
      } finally {
         fs.rmSync(base, { recursive: true, force: true });
      }
   });
});

/** Settings as readPackageRetrieval would return them, with no prompt files. */
function readSync(raw: unknown) {
   const parsed = parsePackageRetrieval(raw);
   return {
      ...(parsed.sourceSummary ? { sourceSummary: parsed.sourceSummary } : {}),
      prompts: {},
   };
}

describe("prompt file", () => {
   let root: string;
   let outside: string;
   beforeEach(() => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-retrieval-"));
      root = path.join(base, "pkg");
      outside = path.join(base, "secret.txt");
      fs.mkdirSync(path.join(root, "prompts"), { recursive: true });
      fs.writeFileSync(outside, "TOP SECRET");
   });
   afterEach(() => {
      fs.rmSync(path.dirname(root), { recursive: true, force: true });
   });

   it("reads the file at load and hashes its text", async () => {
      fs.writeFileSync(path.join(root, "prompts", "k.md"), "Write a phrase.");
      const s = await readPackageRetrieval(root, {
         prompts: { judge: "prompts/k.md" },
      });
      expect(s.prompts.judge).toMatchObject({
         path: "prompts/k.md",
         text: "Write a phrase.",
      });
      expect(s.prompts.judge?.hash).toMatch(/^[0-9a-f]{64}$/);
      fs.writeFileSync(path.join(root, "prompts", "k.md"), "Different.");
      const again = await readPackageRetrieval(root, {
         prompts: { judge: "prompts/k.md" },
      });
      expect(again.prompts.judge?.hash).not.toBe(s.prompts.judge?.hash);
   });

   it("reads the questions prompt, with the same path rules as the others", async () => {
      fs.writeFileSync(path.join(root, "prompts", "s.md"), "Write questions.");
      const s = await readPackageRetrieval(root, {
         prompts: { questions: "prompts/s.md" },
      });
      expect(s.prompts.questions).toMatchObject({
         path: "prompts/s.md",
         text: "Write questions.",
      });
      await expect(
         readPackageRetrieval(root, { prompts: { questions: "../x.md" } }),
      ).rejects.toThrow(
         /retrieval\.prompts\.questions: "\.\.\/x\.md" resolves outside the package directory\. Fix: use a path inside the package, e\.g\. "prompts\/questions\.md"/,
      );
      await expect(
         readPackageRetrieval(root, { prompts: { questions: outside } }),
      ).rejects.toThrow("is an absolute path");
   });

   it("rejects an absolute path", async () => {
      await expect(
         readPackageRetrieval(root, { prompts: { judge: outside } }),
      ).rejects.toThrow("is an absolute path");
   });

   it("rejects a path that climbs out of the package", async () => {
      await expect(
         readPackageRetrieval(root, {
            prompts: { judge: "../secret.txt" },
         }),
      ).rejects.toThrow("resolves outside the package directory");
      await expect(
         readPackageRetrieval(root, {
            prompts: { judge: "prompts/../../secret.txt" },
         }),
      ).rejects.toThrow("resolves outside the package directory");
   });

   it("rejects a symlink that points outside the package", async () => {
      fs.symlinkSync(outside, path.join(root, "prompts", "link.md"));
      await expect(
         readPackageRetrieval(root, {
            prompts: { judge: "prompts/link.md" },
         }),
      ).rejects.toThrow("through a link");
   });

   it("a missing or empty file stops the load with a message naming the key", async () => {
      await expect(
         readPackageRetrieval(root, {
            prompts: { judge: "prompts/no.md" },
         }),
      ).rejects.toThrow("retrieval.prompts.judge: cannot read");
      fs.writeFileSync(path.join(root, "prompts", "e.md"), "  \n");
      await expect(
         readPackageRetrieval(root, { prompts: { judge: "prompts/e.md" } }),
      ).rejects.toThrow("is empty");
   });

   it("resolvePromptPath refuses the package root itself", () => {
      expect(() => resolvePromptPath(root, ".")).toThrow("outside");
   });

   it("accepts a directory or a file whose name only starts with two dots", async () => {
      // `..foo` is an ordinary name, not a step up. Only `..` itself, as a whole
      // path segment, climbs out of the package.
      fs.mkdirSync(path.join(root, "..prompts"), { recursive: true });
      fs.writeFileSync(path.join(root, "..prompts", "k.md"), "Dotted dir.");
      fs.writeFileSync(path.join(root, "..k.md"), "Dotted file.");
      const inDir = await readPackageRetrieval(root, {
         prompts: { judge: "..prompts/k.md" },
      });
      expect(inDir.prompts.judge?.text).toBe("Dotted dir.");
      const file = await readPackageRetrieval(root, {
         prompts: { judge: "..k.md" },
      });
      expect(file.prompts.judge?.text).toBe("Dotted file.");
      expect(resolvePromptPath(root, "..prompts/k.md")).toBe(
         path.join(path.resolve(root), "..prompts", "k.md"),
      );
   });

   it("still refuses a path that steps up, however it is written", () => {
      for (const rel of ["..", "../k.md", "prompts/../../k.md"]) {
         expect(() => resolvePromptPath(root, rel)).toThrow();
      }
   });
});
