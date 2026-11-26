// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The two prompts of box 5 (rerank) and the checks on their replies. Pure:
 * the calls themselves are rerank.ts's.
 *
 * - The pick prompt shows ONE kept source: its doc, every target with the
 *   fields search found on this source for it (each with its kind, type and
 *   full doc, rules included; for a value target, the stored values that
 *   matched, labelled), and the caller's question. Its reply names, per
 *   target, this source's fields that answer it, best first, or none.
 * - The ordering prompt shows every kept source's doc (quoted as JSON, so a
 *   doc cannot pass for the prompt's own lines; the docs together cut to
 *   {@link ORDER_DOCS_MAX_CHARS}) with the names of the fields search found
 *   on it, every target and the question. Its reply is the sources, best
 *   first.
 *
 * Stored values shown come only from `#(index)` dimensions: on ungated
 * sources, and on gated sources keyed by the givens
 * `retrieval.dimensionValues.givens` lists, only the values under the key the
 * caller's givens name. Authored expressions are never sent.
 */

import {
   DEFAULT_JUDGE_INSTRUCTIONS,
   JUDGE_READINGS_RULES,
   JUDGE_REPLY_FORMAT,
   JUDGE_VALUE_RULES,
   ORDER_INSTRUCTIONS,
   ORDER_REPLY_FORMAT,
   QUESTION_HEADER,
} from "../llm/prompts/judge";
import { humanizeName } from "../index/embedding_index";
import type { ValueMatch } from "../index/values_index";
import type { FcjIndex } from "../index/index_build";
import type { Target } from "./find";
import type { SourceGroup } from "./group";

/** One numbered field a pick call may pick. */
export interface JudgeOption {
   number: number;
   key: string;
   /** Targets it is listed under. */
   targets: number[];
}

/** What one pick call said about one target. */
export interface JudgePick {
   target: number;
   /** Picked fields, best first. */
   keys: string[];
   reason?: string;
   /**
    * For a value target, the stored values the judge named, by field key. A
    * key is here when the reply had a `values` list and the judge was shown
    * that field's values; box 6 keeps only what {@link keptValues} allows. A
    * key that is absent keeps every value.
    */
   values?: Record<string, string[]>;
}

/** One pick call's checked reply. */
export interface JudgeVerdict {
   picks: JudgePick[];
   caveats: string[];
}

/** How many of a field's matched values the judge is shown. */
export const JUDGE_VALUES_SHOWN = 5;
/** Doc text the judge reads for one field; a long doc is cut here, not dropped. */
const JUDGE_DOC_MAX_CHARS = 1_500;
/** Doc text of the source a pick call is shown. */
const JUDGE_SOURCE_DOC_MAX_CHARS = 4_000;
/** The most characters of the question a prompt quotes. */
export const QUESTION_MAX_CHARS = 600;
/** The most characters of source docs one ordering prompt carries, shared equally among its sources. */
export const ORDER_DOCS_MAX_CHARS = 12_000;
/** Field names shown per target under a source in the ordering prompt. */
export const ORDER_FIELDS_SHOWN = 3;

/** The judge's word for each way a value matched. */
const HOW_SHOWN: Record<ValueMatch["how"], string> = {
   exact: "exact",
   words: "words",
   ngram: "typo",
   meaning: "meaning",
};

function oneLine(text: string): string {
   return text.replace(/\s+/g, " ").trim();
}

function cut(text: string, max: number): string {
   return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A value's label: its field's number and a letter, "3a". */
function valueLabel(option: number, i: number): string {
   return `${option}${String.fromCharCode(97 + i)}`;
}

/** The stored values that nominated `key` for target `t` on this source, best first. */
function matchedValues(
   group: SourceGroup,
   t: number,
   key: string,
): readonly ValueMatch[] {
   return group.offers.get(t)?.find((o) => o.hit.key === key)?.hit.values ?? [];
}

/** Number the source's offered fields once, so a field listed under two targets has one number. */
export function judgeOptions(
   group: SourceGroup,
   targets: readonly Target[],
): JudgeOption[] {
   const byKey = new Map<string, JudgeOption>();
   for (const t of targets) {
      for (const o of group.offers.get(t.index) ?? []) {
         const prev = byKey.get(o.hit.key);
         if (prev) prev.targets.push(t.index);
         else
            byKey.set(o.hit.key, {
               number: byKey.size + 1,
               key: o.hit.key,
               targets: [t.index],
            });
      }
   }
   return [...byKey.values()];
}

/**
 * Every value label the judge is shown, by `<target index>:<label>`. Only a
 * `dimensional_value` target shows any.
 */
export function valueLabels(
   group: SourceGroup,
   targets: readonly Target[],
   options: readonly JudgeOption[],
): Map<string, { key: string; value: string }> {
   const out = new Map<string, { key: string; value: string }>();
   for (const t of targets) {
      if (t.type !== "dimensional_value") continue;
      for (const o of options) {
         if (!o.targets.includes(t.index)) continue;
         matchedValues(group, t.index, o.key)
            .slice(0, JUDGE_VALUES_SHOWN)
            .forEach((v, i) =>
               out.set(`${t.index}:${valueLabel(o.number, i)}`, {
                  key: o.key,
                  value: v.value,
               }),
            );
      }
   }
   return out;
}

/**
 * The values a picked dimension keeps for a value target: all of them when
 * the judge named none for it (`named` undefined: it was shown none, or its
 * reply had no `values`). Otherwise a value is kept when the judge named it,
 * when it holds a named value as whole words ("Denver Metro" for "Denver"),
 * or when it was past the ones shown; a shown value the judge passed over is
 * dropped.
 */
export function keptValues<T extends { value: string }>(
   all: readonly T[],
   named: readonly string[] | undefined,
): T[] {
   if (named === undefined) return [...all];
   const words = named.map(
      (n) =>
         new RegExp(
            `(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
            "iu",
         ),
   );
   return all.filter(
      (v, i) =>
         i >= JUDGE_VALUES_SHOWN ||
         named.includes(v.value) ||
         words.some((w) => w.test(v.value)),
   );
}

/** A source's one-line description: its name and stored summary, or its doc. */
function sourceLine(index: FcjIndex, key: string): string {
   const source = index.catalog.sources.get(key);
   const summary = oneLine(index.summaries.get(key) ?? source?.node.doc ?? "");
   return `${source?.name ?? key}${summary ? ` - ${cut(summary, 300)}` : ""}`;
}

function optionLine(
   index: FcjIndex,
   option: JudgeOption,
   valueNote: string | undefined,
): string {
   const node = index.catalog.nodes.get(option.key)!;
   const kind = node.dataType ? `${node.kind}, ${node.dataType}` : node.kind;
   const doc = oneLine(node.doc);
   const join = node.joinPath ? `; through the join ${node.joinPath}` : "";
   return [
      `[${option.number}] ${node.name} (${kind}${join})`,
      doc
         ? `: ${cut(doc, JUDGE_DOC_MAX_CHARS)}`
         : `: (no doc; name in words: ${humanizeName(node.name)})`,
      valueNote ? ` | ${valueNote}` : "",
   ].join("");
}

/** The question as a prompt quotes it, or undefined when there is none. */
export function questionText(question: string | undefined): string | undefined {
   const q = question?.trim();
   return q ? JSON.stringify(q.slice(0, QUESTION_MAX_CHARS)) : undefined;
}

/** The pick call's system text: the instructions (the package's or the default) and the rules every call carries. */
export function pickSystemPrompt(
   targets: readonly Target[],
   instructions?: string,
): string {
   return [
      instructions ?? DEFAULT_JUDGE_INSTRUCTIONS,
      JUDGE_READINGS_RULES,
      ...(targets.some((t) => t.type === "dimensional_value")
         ? [JUDGE_VALUE_RULES]
         : []),
   ].join("\n\n");
}

/** The pick call's user message for one kept source. Targets are numbered from 1 in the Call's order. */
export function renderPickPrompt(
   index: FcjIndex,
   group: SourceGroup,
   targets: readonly Target[],
   options: readonly JudgeOption[],
   question?: string,
): string {
   const source = index.catalog.sources.get(group.source);
   const doc = oneLine(source?.node.doc ?? "");
   const lines = [`Source: ${sourceLine(index, group.source)}`];
   if (doc)
      lines.push(
         `Its doc: ${JSON.stringify(cut(doc, JUDGE_SOURCE_DOC_MAX_CHARS))}`,
      );
   const noteOf = (t: Target, o: JudgeOption) => {
      const values = matchedValues(group, t.index, o.key);
      if (values.length === 0)
         return t.type === "dimensional_value" ? "no stored values" : undefined;
      const shown = values
         .slice(0, JUDGE_VALUES_SHOWN)
         .map(
            (v, i) =>
               `${t.type === "dimensional_value" ? `${valueLabel(o.number, i)} ` : ""}${JSON.stringify(v.value)} (${HOW_SHOWN[v.how]}, ${v.score.toFixed(2)})`,
         );
      const more = values.length - shown.length;
      return `stored values matching the target: ${shown.join(", ")}${more > 0 ? `, and ${more} more not shown` : ""}`;
   };
   lines.push("", "<targets>");
   targets.forEach((t, i) => {
      lines.push(`Target ${i + 1} (${t.type}): ${JSON.stringify(t.text)}`);
      const listed = options.filter((o) => o.targets.includes(t.index));
      if (listed.length === 0) lines.push("  (no candidates on this source)");
      for (const o of listed)
         lines.push(`  ${optionLine(index, o, noteOf(t, o))}`);
   });
   lines.push("</targets>");
   const q = questionText(question);
   if (q) lines.push("", QUESTION_HEADER, q);
   lines.push("", JUDGE_REPLY_FORMAT);
   return lines.join("\n");
}

/**
 * The pick reply's output cap: a reason per target (120 tokens), the JSON
 * around it (300), and room to list every offered number once (4 tokens
 * each, with its comma and space).
 */
export function judgeMaxTokens(targets: number, options: number): number {
   return 120 * targets + 300 + 4 * options;
}

/** Check one pick reply against what was offered; the message says what to fix. */
export function validateVerdict(
   targets: readonly Target[],
   options: readonly JudgeOption[],
   /** {@link valueLabels}: the value labels shown, empty when none were. */
   labels: ReadonlyMap<string, { key: string; value: string }> = new Map(),
) {
   const byNumber = new Map(options.map((o) => [o.number, o]));
   return (value: unknown): JudgeVerdict => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
         throw new Error('expected {"picks": [...], "caveats": [...]}');
      }
      const v = value as { picks?: unknown; caveats?: unknown };
      if (!Array.isArray(v.picks)) throw new Error('"picks" must be a list');
      const bad: string[] = [];
      const picks: JudgePick[] = [];
      for (const raw of v.picks) {
         const p = (raw ?? {}) as {
            target?: unknown;
            candidates?: unknown;
            reason?: unknown;
            best?: unknown;
            values?: unknown;
         };
         const tn = typeof p.target === "number" ? p.target : Number(p.target);
         if (!Number.isInteger(tn) || tn < 1 || tn > targets.length) {
            bad.push(
               `target ${JSON.stringify(p.target)} is not a target number (1 to ${targets.length})`,
            );
            continue;
         }
         const keys: string[] = [];
         for (const x of Array.isArray(p.candidates) ? p.candidates : []) {
            const o = byNumber.get(typeof x === "number" ? x : Number(x));
            if (!o) {
               bad.push(`candidate ${JSON.stringify(x)} was not offered`);
               continue;
            }
            if (!keys.includes(o.key)) keys.push(o.key);
         }
         // "best" is read leniently: a number not among the picks is ignored.
         const bn = typeof p.best === "number" ? p.best : Number(p.best);
         const best = Number.isInteger(bn) ? byNumber.get(bn)?.key : undefined;
         if (best !== undefined && keys.includes(best)) {
            keys.splice(keys.indexOf(best), 1);
            keys.unshift(best);
         }
         const target = targets[tn - 1].index;
         // A reply that names values decides, for every picked field it was
         // shown values of, which of them stay; one with no "values" list
         // leaves them all.
         let named: Record<string, string[]> | undefined;
         if (Array.isArray(p.values)) {
            named = {};
            for (const k of keys) {
               for (const [id, l] of labels)
                  if (id.startsWith(`${target}:`) && l.key === k) named[k] = [];
            }
            for (const x of p.values) {
               const shown = labels.get(
                  `${target}:${String(x).trim().toLowerCase()}`,
               );
               if (!shown) {
                  bad.push(
                     `value ${JSON.stringify(x)} was not listed under target ${tn}`,
                  );
                  continue;
               }
               if (named[shown.key] && !named[shown.key].includes(shown.value))
                  named[shown.key].push(shown.value);
            }
            if (Object.keys(named).length === 0) named = undefined;
         }
         picks.push({
            target,
            keys,
            ...(named ? { values: named } : {}),
            ...(typeof p.reason === "string" && p.reason.trim()
               ? { reason: p.reason.trim().slice(0, 300) }
               : {}),
         });
      }
      if (bad.length > 0) throw new Error(bad.join("; "));
      const caveats = Array.isArray(v.caveats)
         ? v.caveats
              .filter(
                 (c): c is string => typeof c === "string" && c.trim() !== "",
              )
              .map((c) => c.trim().slice(0, 300))
              .slice(0, 10)
         : [];
      return { picks, caveats };
   };
}

/** The ordering call's system text. */
export function orderSystemPrompt(): string {
   return ORDER_INSTRUCTIONS;
}

/**
 * The ordering call's user message: the question, every target, and each
 * kept source (box 4's order), numbered from 1, with its doc quoted as JSON
 * and cut to its share of {@link ORDER_DOCS_MAX_CHARS} (its one-line
 * description when it has no doc), and per target the names of the first
 * {@link ORDER_FIELDS_SHOWN} fields search found on it.
 */
export function renderOrderPrompt(
   index: FcjIndex,
   groups: readonly SourceGroup[],
   targets: readonly Target[],
   question?: string,
): string {
   const lines: string[] = [];
   const q = questionText(question);
   if (q) lines.push(`Question: ${q}`);
   lines.push("What the caller is looking for:");
   for (const t of targets)
      lines.push(`  ${t.type}: ${JSON.stringify(t.text)}`);
   lines.push("", "<sources>");
   const share = Math.floor(ORDER_DOCS_MAX_CHARS / Math.max(1, groups.length));
   groups.forEach((g, i) => {
      const source = index.catalog.sources.get(g.source);
      const doc = oneLine(source?.node.doc ?? "");
      lines.push(
         doc
            ? `[${i + 1}] ${source?.name ?? g.source} - ${JSON.stringify(cut(doc, share))}`
            : `[${i + 1}] ${sourceLine(index, g.source)}`,
      );
      lines.push("  Fields search found here:");
      for (const t of targets) {
         const names: string[] = [];
         for (const o of g.offers.get(t.index) ?? []) {
            const name = index.catalog.nodes.get(o.hit.key)?.name;
            if (name && !names.includes(name)) names.push(name);
         }
         lines.push(
            `    for ${JSON.stringify(t.text)}: ${names.slice(0, ORDER_FIELDS_SHOWN).join(", ") || "(nothing found)"}`,
         );
      }
   });
   lines.push("</sources>", "", ORDER_REPLY_FORMAT);
   return lines.join("\n");
}

/** The ordering reply's output cap: the JSON around the list and 4 tokens per source. */
export function orderMaxTokens(sources: number): number {
   return 40 + 4 * sources;
}

/**
 * The ordering reply's shape check: `{"sources": [<numbers>]}` with at least
 * one integer. Which numbers name a kept source, and each once, is
 * {@link orderSources}' check.
 */
export function validateOrder(value: unknown): number[] {
   const list =
      typeof value === "object" && value !== null && !Array.isArray(value)
         ? (value as { sources?: unknown }).sources
         : undefined;
   if (
      !Array.isArray(list) ||
      list.length === 0 ||
      !list.every((n) => typeof n === "number" && Number.isInteger(n))
   ) {
      throw new Error(
         'the reply must be {"sources": [<source numbers, best first>]}',
      );
   }
   return list as number[];
}

/**
 * How box 5 reached the order of the kept sources: the reply named every
 * kept source once (`ordered`); it named some, repeated one or named an
 * unknown number (`partial`); one source was kept, so there was no call
 * (`one_source`); or there was no usable reply (`box4`: late, failed, no
 * model, or nothing it named was kept), so the order is box 4's.
 */
export type OrderOutcome = "ordered" | "partial" | "one_source" | "box4";

/**
 * The kept sources in served order. `kept` is box 4's order; `reply` the
 * checked ordering reply (source numbers from 1 in `kept`'s order), or
 * undefined. The reply's sources come first, in its order; an unknown number
 * and a repeat are passed over; a kept source it left out follows in box 4's
 * order. So the result is always `kept` reordered: never a source dropped,
 * never one added.
 */
export function orderSources<T>(
   kept: readonly T[],
   reply: readonly number[] | undefined,
): { order: T[]; outcome: OrderOutcome } {
   if (kept.length <= 1) return { order: [...kept], outcome: "one_source" };
   if (!reply) return { order: [...kept], outcome: "box4" };
   const named: T[] = [];
   for (const n of reply) {
      if (n >= 1 && n <= kept.length && !named.includes(kept[n - 1]))
         named.push(kept[n - 1]);
   }
   if (named.length === 0) return { order: [...kept], outcome: "box4" };
   const rest = kept.filter((s) => !named.includes(s));
   return {
      order: [...named, ...rest],
      outcome:
         rest.length === 0 && reply.length === kept.length
            ? "ordered"
            : "partial",
   };
}
