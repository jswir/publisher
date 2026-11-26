// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * Box 2, build queries: one Query per target, with every target's text
 * embedded in ONE batched call to the embedding provider (the box's one
 * outside system). With no provider, or an index built without vectors, a
 * Query has no vector and box 3 ranks it by keyword and stored value alone.
 */

import { EMBEDDING_QUERY_TIMEOUT_MS } from "../llm/embedding_provider";
import type { EmbeddingModel } from "../llm/types";
import { toUnit } from "../index/vectors";
import type { Query, Target } from "./find";

export type { Query };

/**
 * The Queries of `targets`, in their order. Throws when the provider fails:
 * the pipeline answers that as a provider error, never with a cheaper search.
 */
export async function buildQueries(args: {
   targets: readonly Target[];
   /** The provider the package's index was embedded with; null without one. */
   provider: Pick<EmbeddingModel, "embedBatch" | "queryPrefix"> | null;
}): Promise<Query[]> {
   const { targets, provider } = args;
   if (!provider || targets.length === 0)
      return targets.map((target) => ({ target }));
   const vectors = await provider.embedBatch(
      targets.map((t) => (provider.queryPrefix ?? "") + t.text),
      EMBEDDING_QUERY_TIMEOUT_MS,
   );
   return targets.map((target, i) => ({ target, vector: toUnit(vectors[i]) }));
}
