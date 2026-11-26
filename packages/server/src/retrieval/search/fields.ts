// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * A field as a kept source offers it (box 4), its judge call reads it (box 5)
 * and its card shows it (box 6): either a node of the catalog (a field of the
 * source itself, or a joined copy the model holds there), or a field of
 * another source reached through the source's joins, under the dotted path a
 * query from the source types (`customers.state` on `order_items`). The
 * second has no node of its own; its key names the joining source, the join
 * path and the field it reaches ({@link joinedKey}).
 */

import type { Relationship } from "@malloydata/malloy-interfaces";
import type { Catalog, CatalogNode } from "../model/catalog";
import { entityId } from "./response";

const JOINED = "joined\u0000";

/** The key of `node` reached from source `from` through `path`. */
export function joinedKey(
   from: string,
   path: readonly string[],
   node: string,
): string {
   return `${JOINED}${from}\u0000${path.join(".")}\u0000${node}`;
}

/** A {@link joinedKey}'s parts, or undefined for any other key. */
export function parseJoinedKey(
   key: string,
): { from: string; path: string[]; node: string } | undefined {
   if (!key.startsWith(JOINED)) return undefined;
   const [from, path, node] = key.slice(JOINED.length).split("\u0000");
   return from && path && node
      ? { from, path: path.split("."), node }
      : undefined;
}

/** One offered field, as the boxes after box 4 read it. */
export interface Field {
   key: string;
   /** The catalog node the field is: the source's own, or the joined source's. */
   node: CatalogNode;
   /** The source whose card it is on. */
   sourceKey: string;
   sourceName: string;
   /** Its name on that card (`customers.state` through a join). */
   name: string;
   /** The wire id a card gives it. */
   id: string;
   /** The join path from the card's source, when it is reached through one. */
   joinPath?: string;
   /** For a joined field: the join's widest relationship, or the field's own many. */
   relationship?: Relationship;
   /** True for a field of another source reached through a join, with no node of its own. */
   joined: boolean;
}

/**
 * The relationship of a field reached through a join: the join's, unless the
 * field itself fans out (a repeated record's member is `many` even behind a
 * join_one).
 */
export function throughFanout(
   join: Relationship | undefined,
   field: Relationship | undefined,
): Relationship | undefined {
   return field === "many" ? "many" : (join ?? field);
}

/** The field a key names, or undefined when the catalog holds no such thing. */
export function fieldOf(catalog: Catalog, key: string): Field | undefined {
   const joined = parseJoinedKey(key);
   if (!joined) {
      const node = catalog.nodes.get(key);
      if (!node) return undefined;
      return {
         key,
         node,
         sourceKey: node.sourceKey,
         sourceName: node.source,
         name: node.name,
         id: node.id,
         ...(node.joinPath ? { joinPath: node.joinPath } : {}),
         joined: false,
      };
   }
   const node = catalog.nodes.get(joined.node);
   const from = catalog.sources.get(joined.from);
   if (!node || !from) return undefined;
   const joinPath = joined.path.join(".");
   const hop = catalog.joins
      .get(joined.from)
      ?.find((h) => h.path.join(".") === joinPath);
   const own =
      node.kind === "dimension" || node.kind === "measure"
         ? node.relationship
         : undefined;
   const relationship = throughFanout(hop?.fanout, own);
   const name = `${joinPath}.${node.name}`;
   return {
      key,
      node,
      sourceKey: joined.from,
      sourceName: from.name,
      name,
      id: entityId(node.kind, from.name, name),
      joinPath,
      ...(relationship ? { relationship } : {}),
      joined: true,
   };
}
