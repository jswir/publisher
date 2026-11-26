// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The fixed corpus of get_context requests the retrieval replay sends. Each
 * case is one call, or a short sequence of calls that belong together (a
 * page and the calls for the pages after it); its snapshot is
 * `tests/goldens/retrieval_replay/<id>.json`.
 *
 * Add a case at the end, run the replay with UPDATE_GOLDENS=1, and commit the
 * new snapshot. Never change a case's request in place: give the new request a
 * new id, so the diff shows a new snapshot rather than a rewritten one.
 */

export const ENVIRONMENT = "examples";

/**
 * The packages the replay loads, each from a committed fixture under
 * `tests/fixtures/`. `manifest` replaces the fixture's publisher.json in the
 * loaded copy, so one model serves under several retrieval settings.
 */
export interface ReplayPackage {
   /** The fixture directory, under tests/fixtures. */
   fixture: string;
   manifest?: Record<string, unknown>;
   /** Files added to the loaded copy, by path. */
   files?: Record<string, string>;
   /**
    * Built and searched with no embedding provider, as on a server with none
    * configured: the lexical mode.
    */
   lexical?: boolean;
}

/** A frozen copy of examples/storefront (its README says from which commit). */
export const PACKAGE = "storefront";
/** Dimensions tagged #(index), for the stored-value cases. */
export const VALUES_PACKAGE = "replay-values";

export const PACKAGES: Record<string, ReplayPackage> = {
   [PACKAGE]: { fixture: "retrieval-replay-storefront" },
   [VALUES_PACKAGE]: { fixture: "retrieval-replay-values" },
};

/**
 * Packages a listing shows that are not loaded, with the description each
 * one's publisher.json carried when this was written: listed, never searched.
 */
export const LISTED_ONLY: Record<string, Record<string, string>> = {
   [ENVIRONMENT]: {
      "html-data-app":
         "In-package HTML data app demo — a SaaS subscriptions dashboard. Put your web files in a public/ directory next to your .malloy files and Publisher serves them at /environments/<env>/packages/<pkg>/<file>. Live reload, embeddable iframe, no build step.",
   },
   governed: {
      "governed-analytics":
         "Givens, authorization, row-level access, and discovery curation in one small package.",
   },
};

const scope = { environment: ENVIRONMENT, package: PACKAGE };
const valuesScope = { environment: ENVIRONMENT, package: VALUES_PACKAGE };

export interface ReplayCase {
   /** The snapshot's file name; kebab-case, never reused. */
   id: string;
   /** What the case covers. */
   about: string;
   /** The get_context arguments, sent as written (through the tool's input schema). */
   params?: Record<string, unknown>;
   /** Several calls, in order, recorded together: a page and the pages after it. */
   steps?: Array<Record<string, unknown>>;
}

export const CASES: readonly ReplayCase[] = [
   {
      id: "measure-total-revenue",
      about: "One measure target.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "dimension-product-category",
      about: "One dimension target; the field exists on a source and through a join.",
      params: {
         search_targets: [
            {
               target_type: "dimension",
               search_text: "product category of the item sold",
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "view-monthly-revenue-trend",
      about: "One view target.",
      params: {
         search_targets: [
            { target_type: "view", search_text: "monthly revenue trend" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "value-returned",
      about: "A stored-value target with no pinned field (status holds 'Returned').",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Returned" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "value-pinned-category-jeans",
      about: "A stored-value target pinned to its dimension (order_items.category), in another case.",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "jeans" },
         ],
         scopes: [{ ...scope, source: "order_items", entity_name: "category" }],
      },
   },
   {
      id: "value-indexed-city",
      about: "A stored-value target beside its dimension target, over #(index) values (synthetic package).",
      params: {
         search_targets: [
            { target_type: "dimension", search_text: "city the store is in" },
            { target_type: "dimensional_value", search_text: "Denver" },
         ],
         scopes: [valuesScope],
      },
   },
   {
      id: "value-indexed-typo",
      about: "A misspelt stored value, matched by spelling (synthetic package).",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Outerwaer" },
         ],
         scopes: [valuesScope],
      },
   },
   {
      id: "source-people-who-ordered",
      about: "One source target.",
      params: {
         search_targets: [
            { target_type: "source", search_text: "people who placed orders" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "multi-margin-by-brand-and-region",
      about: "Several targets of different types in one call.",
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: "gross margin as a share of revenue",
            },
            { target_type: "dimension", search_text: "brand of the item sold" },
            {
               target_type: "dimension",
               search_text: "sales region for the customer's home state",
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "not-found-warehouse",
      about: "A target the model does not hold.",
      params: {
         search_targets: [
            {
               target_type: "dimension",
               search_text: "warehouse that shipped the parcel",
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "user-prompt-orders-per-customer",
      about: "A measure target with user_prompt, which is recorded and must not change matching.",
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: "average orders placed per customer",
            },
         ],
         scopes: [scope],
         user_prompt: "How many orders does the average customer place?",
      },
   },
   {
      id: "enumerate-measures-of-order-items",
      about: "A target with no search_text, scoped to one source: enumerates its measures.",
      params: {
         search_targets: [{ target_type: "measure" }],
         scopes: [{ ...scope, source: "order_items" }],
      },
   },
   {
      id: "list-no-arguments",
      about: "No arguments: the environments listing.",
      params: {},
   },
   {
      id: "list-environment-packages",
      about: "An environment and nothing else: its packages.",
      params: { environment: ENVIRONMENT },
   },
   {
      id: "list-package-sources",
      about: "A package in scopes and no targets: its sources, with package_info.",
      params: { scopes: [scope] },
   },
   {
      id: "list-source-fields",
      about: "A source in scopes and no targets: its fields.",
      params: { scopes: [{ ...scope, source: "order_items" }] },
   },
   {
      id: "search-without-package",
      about: "A ranked search that names no package on a server with several.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
         ],
      },
   },
];
