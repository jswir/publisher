// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Box 1, authorize: what this Call may search, from the Call and the caller.
 * It reads the package's in-memory model once and passes it down; no other
 * box looks it up again.
 *
 * Out comes the scope (the request's model path, source and field, with the
 * deny-all sources, the sources whose `#(authorize)` lock cannot admit the
 * caller, and the hidden ones taken out), the package's model (its search
 * index), the stored-value filter the caller's givens name, the targets, and
 * the package's search settings. Or a refusal: the answer for an index that
 * is not ready yet.
 */

import { sourceContextKey } from "../model/package_entities";
import type { CatalogNode } from "../model/catalog";
import type { FcjIndex } from "../index/index_build";
import type { FcjState } from "../index/fcj_state";
import { callerKeyOf, lockedSourcesFor } from "../index/values_index";
import {
   searchAnswer,
   searchFailure,
   type JoinTopology,
   type PackageIndex,
   type ResolvedRequest,
   type SearchResult,
} from "../model/types";
import {
   fcjSettingsOf,
   type FcjSettings,
} from "../../service/package_retrieval_settings";
import { skillsFor } from "./response";
import { KINDS_BY_TARGET, type Target } from "./find";

/** Box 1's answer when the Call may be searched. */
export interface Authorized {
   /** The package's model: its search index, read once here. */
   index: FcjIndex;
   /** The Call's targets, in the caller's order. */
   targets: Target[];
   /** The scope: whether a node may be searched and returned. */
   allow: (node: CatalogNode) => boolean;
   /** The stored-value filter: the partition key the caller's givens name for a dimension's source. */
   callerKey: (dimension: string) => string | undefined;
   /** A value target was searched without its gated sources' values. */
   warnings: string[];
   /** The package's search settings in force. */
   settings: FcjSettings;
   /** The package's own pick instructions (`retrieval.prompts.judge`). */
   instructions?: string;
}

/** Box 1's answer when it may not: the response to send instead. */
export interface Refused {
   refusal: SearchResult;
}

/** The targets of the Call, from the resolved request, in the caller's order. */
export function targetsOf(request: ResolvedRequest): Target[] {
   const targets: Target[] = [
      ...request.searches.map((s) => ({
         index: s.targetIndex,
         type: s.targetType as Target["type"],
         text: s.text,
         kinds: KINDS_BY_TARGET[s.targetType as Target["type"]],
      })),
      ...request.valueSearches.map((s) => ({
         index: s.targetIndex,
         type: "dimensional_value" as const,
         text: s.text,
         kinds: KINDS_BY_TARGET.dimensional_value,
      })),
   ];
   return targets.sort((a, b) => a.index - b.index);
}

/**
 * Whether a node survives the request's model, source and field scope and the
 * caller's dropped sources: neither its own source nor, for a field reached
 * through joins, any source on its join path may be dropped.
 */
export function inScope(
   request: ResolvedRequest,
   pkgIndex: Pick<PackageIndex, "droppedSources" | "topology">,
) {
   /**
    * Sources this request may not see, by sourceContextKey: the deny-all
    * sources, plus those whose lock cannot admit the caller's givens
    * (get_context_tool.ts). The index is built once per package, so a
    * caller's lock is applied here, before any search.
    */
   const dropped: ReadonlySet<string> = pkgIndex.droppedSources;
   return (node: CatalogNode): boolean => {
      if (
         dropped.size > 0 &&
         node.modelPaths.some((mp) =>
            dropped.has(sourceContextKey(mp, node.source)),
         )
      ) {
         return false;
      }
      if (
         node.joinPath &&
         dropped.size > 0 &&
         passesDropped(node, pkgIndex.topology, dropped)
      ) {
         return false;
      }
      if (request.modelPath && !node.modelPaths.includes(request.modelPath)) {
         return false;
      }
      if (request.sourceName && node.source !== request.sourceName)
         return false;
      if (
         request.entityName &&
         node.kind !== "source" &&
         node.name !== request.entityName
      ) {
         return false;
      }
      return true;
   };
}

/**
 * Whether a field reached through joins (a joined copy the model holds, or a
 * field box 4 offers through a join) passes through, or lands on, a dropped
 * source: some prefix of its join path, read from its source's join
 * topology, reaches a deny-all source or one locked to this caller. Such a
 * field is never searched, offered or named, so neither the pick prompt's
 * "through the join" line nor a card's `join_path` can name the path.
 *
 * An `#(agent-hidden)` source on the path does not refuse it: a hidden
 * source is not dropped, only unlisted, and its fields reach the sources
 * that join it by design (catalog.ts, unservedCopies). A deny-all or locked
 * source is an access decision, so nothing is reached through it.
 */
function passesDropped(
   node: CatalogNode,
   topology: JoinTopology,
   dropped: ReadonlySet<string>,
): boolean {
   const path = node.joinPath!.split(".");
   return node.modelPaths.some((mp) =>
      (topology.get(sourceContextKey(mp, node.source)) ?? []).some(
         (reach) =>
            reach.path.length <= path.length &&
            reach.path.every((segment, i) => segment === path[i]) &&
            dropped.has(
               sourceContextKey(reach.targetModelPath, reach.targetSource),
            ),
      ),
   );
}

/**
 * The warning when a value target was searched without a pinned dimension
 * and the scope holds gated sources: their values were not searched.
 */
export function gatedValueWarning(
   index: FcjIndex,
   request: ResolvedRequest,
   targets: readonly Target[],
   allow: (node: CatalogNode) => boolean,
): string | undefined {
   if (request.entityName) return undefined;
   if (!targets.some((t) => t.type === "dimensional_value")) return undefined;
   const gated = [...index.catalog.sources.values()]
      .filter((s) => s.gated && allow(s.node))
      .map((s) => s.name);
   if (gated.length === 0) return undefined;
   return `The values of ${gated.length} source(s) with an access gate were not searched (${gated.slice(0, 5).join(", ")}${gated.length > 5 ? ", ..." : ""}). To search one, scope the target to its dimension (scopes[].source and entity_name) and send the givens its gate needs.`;
}

/** Box 1. */
export async function authorize(args: {
   request: ResolvedRequest;
   pkgIndex: PackageIndex;
   /** The package's index build: its model, once ready. */
   state: FcjState | undefined;
   /** The request's leading warnings, for a refusal. */
   warnings: readonly string[];
}): Promise<Authorized | Refused> {
   const { request, pkgIndex, state } = args;
   if (state?.status !== "ready") {
      return { refusal: unreadyAnswer(pkgIndex, state, args.warnings) };
   }
   const index = state.index;
   const pkg = pkgIndex.pkg;
   const retrieval = pkg.getRetrievalSettings?.();
   const targets = targetsOf(request);
   const allow = inScope(request, pkgIndex);
   const callerKey = callerKeyOf(
      index.catalog,
      request.givens,
      await lockedSourcesFor(index.catalog, request.givens, (path) =>
         pkg.getModel?.(path),
      ),
   );
   const gated = gatedValueWarning(index, request, targets, allow);
   const instructions = retrieval?.prompts.judge?.text;
   return {
      index,
      targets,
      allow,
      callerKey,
      warnings: gated ? [gated] : [],
      settings: fcjSettingsOf(retrieval),
      ...(instructions ? { instructions } : {}),
   };
}

/** The answer while the index is not ready: an error after a failed build, otherwise "indexing". */
function unreadyAnswer(
   pkgIndex: PackageIndex,
   state: FcjState | undefined,
   warnings: readonly string[],
): SearchResult {
   if (state?.status === "error") {
      return searchFailure(
         {
            message: `The fcj search index for this package could not be built: ${state.message}`,
            suggestions: [
               "Ask again in a minute; the build is retried by the next question after a short cool-down.",
               "The operator should read the server log.",
            ],
         },
         {
            sources: [],
            retrieval: "error",
            retrieval_reason: "unavailable",
         },
      );
   }
   return searchAnswer({
      sources: [],
      ranking: "relevance" as const,
      total_available: 0,
      returned: 0,
      retrieval: "indexing",
      ...skillsFor({ pkgIndex }),
      warnings: [
         ...warnings,
         "This package's search index is still being built, so there are no results yet. Nothing is wrong: ask the same question again in a few seconds. A request with no search_text (a listing) works now.",
      ],
   });
}
