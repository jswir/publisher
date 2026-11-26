// Copyright (c) Credible Data Inc.
// SPDX-License-Identifier: MIT

/**
 * The fixed corpus of get_context requests the retrieval replay sends, over
 * the bundled `storefront` example. Each case is one call; its snapshot is
 * `tests/goldens/retrieval_replay/<id>.json`.
 *
 * Add a case at the end, run the replay with UPDATE_GOLDENS=1, and commit the
 * new snapshot. Never change a case's request in place: give the new request a
 * new id, so the diff shows a new snapshot rather than a rewritten one.
 */

export const ENVIRONMENT = "examples";
export const PACKAGE = "storefront";
/**
 * A synthetic package (tests/fixtures/retrieval-replay-values) whose
 * dimensions are tagged #(index), for the stored-value cases that need an
 * index to match against: storefront tags none.
 */
export const VALUES_PACKAGE = "replay-values";

const scope = { environment: ENVIRONMENT, package: PACKAGE };
const valuesScope = { environment: ENVIRONMENT, package: VALUES_PACKAGE };

export interface ReplayCase {
   /** The snapshot's file name; kebab-case, never reused. */
   id: string;
   /** What the case covers. */
   about: string;
   /** The get_context arguments, sent as written. */
   params: Record<string, unknown>;
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
      about: "A measure target with user_prompt, which the ranking step reads.",
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
   {
      id: "many-sources-keep-seven",
      about: "Targets whose hits span more sources than box 4 keeps (seven at most).",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "number of rows" },
            { target_type: "dimension", search_text: "name" },
            { target_type: "dimension", search_text: "identifier" },
            { target_type: "view", search_text: "summary overview" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "user-prompt-both-calls",
      about: "Targets on several sources with user_prompt: the pick calls and the ordering call all quote it.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Which states bring in the most revenue?",
      },
   },
   {
      id: "pick-call-fails-for-one-source",
      about: "One kept source's pick call fails (stand-in directive): that source is left out, the others serve.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by state [replay: fail pick order_items]",
      },
   },
   {
      id: "every-pick-call-fails",
      about: "Every pick call fails: the search's ranked fields are served with a warning, not an error.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by state [replay: fail every pick]",
      },
   },
   {
      id: "order-call-invalid",
      about: "The ordering call names no kept source: the sources keep box 4's order.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by state [replay: order invalid]",
      },
   },
   {
      id: "order-call-late",
      about: "The ordering call does not answer before the grace after the picks: box 4's order.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by state [replay: order late]",
      },
   },
   {
      id: "scoped-to-one-source",
      about: "A call scoped to one source: one pick call and no ordering call.",
      params: {
         search_targets: [
            { target_type: "dimension", search_text: "customer state" },
            { target_type: "measure", search_text: "number of customers" },
         ],
         scopes: [{ ...scope, source: "customers" }],
         user_prompt: "How many customers are in each state?",
      },
   },
   {
      id: "paged-last-source-moves-first",
      about: "limit 1 on a result of several sources: the first page holds the first source, the rest page on.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         limit: 1,
      },
   },
   {
      id: "field-limit-after-first-source",
      about: "A dimension target many sources answer: the first source keeps every pick, the others at most two per pick.",
      params: {
         search_targets: [
            {
               target_type: "dimension",
               search_text:
                  "date or time the order was created, shipped or delivered",
            },
         ],
         scopes: [scope],
      },
   },
];
