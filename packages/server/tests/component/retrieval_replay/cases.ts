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
 *
 * A target's search_text may carry a reserved `zz...` word that asks the
 * stand-in judge for a harder reply (stand_ins.ts, MARKERS;
 * docs/retrieval-replay.md lists them).
 */

import { MARKERS } from "./stand_ins";

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
/** Eleven sources sharing `amount` and `region`. */
export const MANY_PACKAGE = "replay-many";
/** The same model with the judge off. */
export const JUDGE_OFF_PACKAGE = "replay-judge-off";
/** The same model with its own judge instructions, and no embeddings. */
export const CUSTOM_JUDGE_PACKAGE = "replay-custom-judge";
/** `connect: "clusters"` and `twinRule` on: a star, a twin, four islands. */
export const CLUSTERS_PACKAGE = "replay-clusters";
/** A locked source, a row-gated source, an #(agent-hidden) one. */
export const GOVERNED_PACKAGE = "replay-governed";
/** Three sources, each with a dozen measures documented at length. */
export const LONG_DOCS_PACKAGE = "replay-long-docs";

const manyManifest = (name: string, retrieval: Record<string, unknown>) => ({
   name,
   version: "1.0.0",
   description: `The replay-many model, served with ${JSON.stringify(retrieval)}.`,
   retrieval,
});

export const PACKAGES: Record<string, ReplayPackage> = {
   [PACKAGE]: { fixture: "retrieval-replay-storefront" },
   [VALUES_PACKAGE]: { fixture: "retrieval-replay-values" },
   [MANY_PACKAGE]: { fixture: "retrieval-replay-many" },
   [JUDGE_OFF_PACKAGE]: {
      fixture: "retrieval-replay-many",
      manifest: manyManifest(JUDGE_OFF_PACKAGE, { fcj: { judge: false } }),
   },
   [CUSTOM_JUDGE_PACKAGE]: {
      fixture: "retrieval-replay-many",
      manifest: manyManifest(CUSTOM_JUDGE_PACKAGE, {
         prompts: { judge: "prompts/judge.md" },
      }),
      files: {
         "prompts/judge.md":
            "You pick, for each target, the candidates that answer it. This package's own judge instructions: prefer a field whose source's doc says it holds every row.",
      },
      lexical: true,
   },
   [CLUSTERS_PACKAGE]: { fixture: "retrieval-replay-clusters" },
   [GOVERNED_PACKAGE]: { fixture: "retrieval-replay-governed" },
   [LONG_DOCS_PACKAGE]: { fixture: "retrieval-replay-long-docs" },
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
const manyScope = { environment: ENVIRONMENT, package: MANY_PACKAGE };
const clustersScope = { environment: ENVIRONMENT, package: CLUSTERS_PACKAGE };
const governedScope = { environment: ENVIRONMENT, package: GOVERNED_PACKAGE };

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

/** The ranked request most cases on the many-sources fixture send. */
const amountByRegion = [
   { target_type: "measure", search_text: "total amount" },
   { target_type: "dimension", search_text: "region" },
];

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

   // The many-sources fixture: more sources than a judge call may keep.
   {
      id: "many-sources-shared-field",
      about: "A measure and a dimension that eleven sources share by name or by word: some extend one base, some are unrelated, one reaches another's field through a join.",
      params: { search_targets: amountByRegion, scopes: [manyScope] },
   },
   {
      id: "many-sources-paging",
      about: "One source per page: the first page holds the result; offset 1 is served from the held result, as is offset 99, past its end, and a page of another size (limit is not part of the held result's key); a request that differs (include_code) with an offset runs the search again, and says so.",
      steps: [
         { search_targets: amountByRegion, scopes: [manyScope], limit: 1 },
         {
            search_targets: amountByRegion,
            scopes: [manyScope],
            limit: 1,
            offset: 1,
         },
         {
            search_targets: amountByRegion,
            scopes: [manyScope],
            limit: 1,
            offset: 99,
         },
         {
            search_targets: amountByRegion,
            scopes: [manyScope],
            limit: 2,
            offset: 2,
         },
         {
            search_targets: amountByRegion,
            scopes: [manyScope],
            include_code: true,
            limit: 1,
            offset: 1,
         },
      ],
   },
   {
      id: "judge-off-unjudged-picks",
      about: "retrieval.fcj.judge false: no judge call; every target keeps its first few listed candidates.",
      params: {
         search_targets: amountByRegion,
         scopes: [{ environment: ENVIRONMENT, package: JUDGE_OFF_PACKAGE }],
      },
   },
   {
      id: "custom-judge-prompt-lexical",
      about: "retrieval.prompts.judge replaces the judge's instructions; the package is built and searched with no embedding provider (lexical).",
      params: {
         search_targets: amountByRegion,
         scopes: [{ environment: ENVIRONMENT, package: CUSTOM_JUDGE_PACKAGE }],
      },
   },

   // Harder judge replies, asked for by MARKERS in the target text.
   {
      id: "judge-best-not-first",
      about: `The judge's best is its second candidate (${MARKERS.best2}): the engine lists it first.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `total revenue ${MARKERS.best2}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-caveat-list",
      about: `A reply with a caveat naming a field (${MARKERS.caveat}), in a list: it rides on the first query group.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `total revenue ${MARKERS.caveat}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-caveat-names-unpicked-field",
      about: `Each pick call's caveat names order_count (${MARKERS.name}order_count), a field search offered that no call picked and no card serves: the caveat is dropped, so no caveat points at a field the response does not carry.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `total revenue ${MARKERS.name}order_count`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-repair",
      about: `The first reply names a candidate that was not offered (${MARKERS.badPick}); the re-ask, which quotes the rejection, gets a valid one.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `total revenue ${MARKERS.badPick}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-fails",
      about: `Every judge reply is not JSON (${MARKERS.fail}): the request answers with the judge-step error.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `total revenue ${MARKERS.fail}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "route-products-that-were-ordered",
      about: "A measure reached through a join, the target naming the joining source: the judge picks the route (order_items through products), not the field on its own source.",
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: "number of products that were ordered",
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-routes-beside-fields",
      about: `The judge picks every route shown beside each field it picks (${MARKERS.routes}): past dropRoutesAt, the routes are dropped and the fields kept.`,
      params: {
         search_targets: [
            {
               target_type: "dimension",
               search_text: `state and city ${MARKERS.routes}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "judge-routes-beside-one-field",
      about: `The judge picks one field and the three routes shown beside it (${MARKERS.routes}): fewer than dropRoutesAt, so they are all kept.`,
      params: {
         search_targets: [
            {
               target_type: "dimension",
               search_text: `city ${MARKERS.routes}`,
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "join-target",
      about: "A join target.",
      params: {
         search_targets: [
            {
               target_type: "join",
               search_text: "the customer who placed the order",
            },
         ],
         scopes: [scope],
      },
   },
   {
      id: "model-path-scope",
      about: "A ranked search narrowed to one model file (scopes[].model_path).",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
         ],
         scopes: [{ ...scope, model_path: "data_app.malloy" }],
      },
   },
   {
      id: "include-code-ranked",
      about: "A ranked search with include_code: each entity carries its definition.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "gross margin" },
         ],
         scopes: [scope],
         include_code: true,
      },
   },

   // connect: "clusters", twinRule on.
   {
      id: "clusters-four-islands",
      about: "Four targets that four separate sources each answer alone: more than maxClusters, so one is left unresolved.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "freight cost" },
            { target_type: "dimension", search_text: "warehouse zone" },
            { target_type: "measure", search_text: "payroll gross" },
            { target_type: "dimension", search_text: "advertising medium" },
         ],
         scopes: [clustersScope],
      },
   },
   {
      id: "clusters-order-total-twins",
      about: "One measure that a source and its twin (same fields, another name) both hold, among more measures than a cluster keeps per target; twinRule keeps one of the twins.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "order total" },
         ],
         scopes: [clustersScope],
      },
   },
   {
      id: "clusters-twins-readings-caveat",
      about: `The judge marks readings (${MARKERS.readings}), so twinRule keeps both twins, and names a caveat (${MARKERS.caveat}) that rides on the cluster.`,
      params: {
         search_targets: [
            {
               target_type: "measure",
               search_text: `order total ${MARKERS.readings} ${MARKERS.caveat}`,
            },
         ],
         scopes: [clustersScope],
      },
   },
   {
      id: "clusters-joined-dimension",
      about: "A measure on the home and a dimension one join away: the joined field is on the home's card, its score discounted per hop.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "order total" },
            { target_type: "dimension", search_text: "customer segment" },
         ],
         scopes: [clustersScope],
      },
   },

   {
      id: "clusters-three-joins-away",
      about: "A measure on the home and a dimension three joins away (orders, customer, city, state): the home covers it only at hopDiscount cubed, against coverFraction.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "order total" },
            { target_type: "dimension", search_text: "census region name" },
         ],
         scopes: [clustersScope],
      },
   },

   // Access controls and hidden sources.
   {
      id: "givens-locked-source-no-givens",
      about: "A source behind an #(authorize) lock on a secure given, with no givens sent: nothing is omitted.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "payroll gross" },
         ],
         scopes: [governedScope],
      },
   },
   {
      id: "givens-locked-source-other-role",
      about: "The same search with givens the lock cannot admit: the locked source is omitted.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "payroll gross" },
         ],
         scopes: [governedScope],
         givens: { ROLE: "sales" },
      },
   },
   {
      id: "givens-locked-source-unlocked",
      about: "The same search with the givens that unlock the source.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "payroll gross" },
         ],
         scopes: [governedScope],
         givens: { ROLE: "finance" },
      },
   },
   {
      id: "givens-locked-source-mid-join-unlocked",
      about: "payslip_prints reaches departments only through payroll_ledger (payment.dept_row); with the givens that unlock payroll_ledger, the department fields reached through it are offered on payslip_prints.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "payslips printed" },
            { target_type: "dimension", search_text: "department head" },
         ],
         scopes: [governedScope],
         user_prompt: "Payslips printed by department head",
         givens: { ROLE: "finance" },
      },
   },
   {
      id: "givens-locked-source-mid-join-locked",
      about: "The same search with givens payroll_ledger's lock cannot admit: payroll_ledger is omitted, and nothing is offered on payslip_prints through it (no payment.* field, no join_path naming payment), though departments itself still answers.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "payslips printed" },
            { target_type: "dimension", search_text: "department head" },
         ],
         scopes: [governedScope],
         user_prompt: "Payslips printed by department head",
         givens: { ROLE: "sales" },
      },
   },
   {
      id: "value-gated-pinned-no-givens",
      about: "A stored-value target pinned to a row-gated source's field, with no givens: its values are not read.",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Springfield" },
         ],
         scopes: [
            {
               ...governedScope,
               source: "tenant_orders",
               entity_name: "order_city",
            },
         ],
      },
   },
   {
      id: "value-gated-pinned-with-givens",
      about: "The same pinned value search with the givens the row gate reads: the caller's rows' values are read through the query path.",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Springfield" },
         ],
         scopes: [
            {
               ...governedScope,
               source: "tenant_orders",
               entity_name: "order_city",
            },
         ],
         givens: { TENANTS: ["acme"] },
      },
   },
   {
      id: "value-several-matches",
      about: "A value whose spelling matches several stored values of one field: the judge names the ones that hold the value as a word, and the one it passed over is dropped. The package has a gated source, whose values were not searched.",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Springfield" },
         ],
         scopes: [governedScope],
      },
   },
   {
      id: "agent-hidden-best-match",
      about: "The best-matching field is on an #(agent-hidden) source, which never appears.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "freight cost total" },
         ],
         scopes: [governedScope],
      },
   },
   {
      id: "filter-params-gated-value",
      about: "filter_params beside givens on a pinned value search of a row-gated source that declares a (deprecated) #(filter): the values read are the filtered rows' only.",
      params: {
         search_targets: [
            { target_type: "dimensional_value", search_text: "Springfield" },
         ],
         scopes: [
            {
               ...governedScope,
               source: "tenant_orders",
               entity_name: "order_city",
            },
         ],
         givens: { TENANTS: ["acme", "globex"] },
         filter_params: { tenant: "globex" },
      },
   },
   {
      id: "page-over-35000-chars",
      about: "Three cards of about 12,000 characters each (a dozen measures with long docs): the answer is over the 35,000-character page, so the first page ends early by size, and the call with its next_offset is served from the held result.",
      steps: [
         {
            search_targets: [
               { target_type: "measure", search_text: "total amount" },
            ],
            scopes: [{ environment: ENVIRONMENT, package: LONG_DOCS_PACKAGE }],
         },
         {
            search_targets: [
               { target_type: "measure", search_text: "total amount" },
            ],
            scopes: [{ environment: ENVIRONMENT, package: LONG_DOCS_PACKAGE }],
            offset: 2,
         },
      ],
   },
   {
      id: "source-first-user-prompt-both-calls",
      about: "A measure and a dimension on different sources, with user_prompt: every pick call and the ordering call quote the question, and the ordering call's order (the stand-in's name score, not box 4's) is the cards' order. order_items offers the customer's state through its join (customers.state), not a field of its own.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Which customer states bring in the most revenue?",
      },
   },
   {
      id: "source-first-pick-call-fails-for-one-source",
      about: "One kept source's pick call fails twice ([replay: fail pick order_items] in user_prompt): that source is left out and the others, which hold both targets too, serve; a warning names order_items as left out of the ranking.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt:
            "Revenue by customer state [replay: fail pick order_items]",
      },
   },
   {
      id: "source-first-pick-call-fails-for-the-only-holder",
      about: "The pick call of freight, the only source holding freight cost, fails twice ([replay: fail pick freight]): freight cost is not reported as unresolved; freight's top hit for it is served without a judge reason, after the answered source, and a warning names freight.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "order total" },
            { target_type: "measure", search_text: "freight cost" },
         ],
         scopes: [clustersScope],
         user_prompt:
            "Order total and freight cost [replay: fail pick freight]",
      },
   },
   {
      id: "source-first-order-call-invalid",
      about: "The ordering call names no kept source ([replay: order invalid]): the cards keep box 4's order.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by customer state [replay: order invalid]",
      },
   },
   {
      id: "source-first-order-call-late",
      about: "The ordering call does not answer ([replay: order late]): it is cut 0.3 s after the pick calls end, and the cards keep box 4's order.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "total revenue" },
            { target_type: "dimension", search_text: "customer state" },
         ],
         scopes: [scope],
         user_prompt: "Revenue by customer state [replay: order late]",
      },
   },
   {
      id: "source-first-scoped-to-one-source",
      about: "A call scoped to one source: one pick call, no ordering call.",
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
      id: "source-first-period-in-question",
      about: "Only a measure target, and a question that names a period (month by month in 2025): each kept source also offers its date fields for an implicit target, and a card shows at most one, marked also_likely.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "orders per customer" },
         ],
         scopes: [scope],
         user_prompt:
            "How many orders does the average customer place, month by month in 2025?",
      },
   },
   {
      id: "source-first-joined-customer-id",
      about: "A dimension whose answer on order_items is the joined copy customers.customer_id: search finds customer_id on customers, and order_items offers it through its join.",
      params: {
         search_targets: [
            { target_type: "dimension", search_text: "customer id" },
            { target_type: "measure", search_text: "number of customers" },
         ],
         scopes: [scope],
      },
   },
   {
      id: "source-first-field-limit-after-first-source",
      about: "Eleven sources share amount and region: the first card keeps every field its call picked, every later card at most two per pick, and a target at most eight in all.",
      params: {
         search_targets: [
            { target_type: "measure", search_text: "amount total" },
            { target_type: "dimension", search_text: "region" },
         ],
         scopes: [manyScope],
      },
   },
   {
      id: "retired-fcj-keys-load",
      about: "replay-clusters sets retired retrieval.fcj keys (connect, collapseCopies, twinRule): the package still loads and lists its sources; _index_build.json records one load warning naming each key.",
      params: { scopes: [clustersScope] },
   },
];
