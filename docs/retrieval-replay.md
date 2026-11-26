<!--
Copyright (c) Credible Data Inc.
SPDX-License-Identifier: MIT
-->

# The retrieval replay

> What this is: a fixed set of `get_context` calls whose whole responses are committed as snapshots
> and replayed on every pull request, so a change to the retrieval engine
> (`packages/server/src/retrieval/`) states exactly which answers it changes. It needs no network
> and no API key.

## What it runs

The spec is `packages/server/tests/component/retrieval_replay/retrieval_replay.spec.ts`. It loads
the packages `cases.ts` lists (`PACKAGES`), each from a committed fixture under
`packages/server/tests/fixtures/`, builds each package's search index into a real DuckDB catalog,
and sends every case in `cases.ts` the way an MCP client would: through the `get_context` tool's
input schema (zod validation, unknown keys stripped), then the tool's instrumented handler, with the
request `extra` (headers, abort signal) the production handler receives. That is the same code the
MCP endpoint calls, without the transport.

### The fixtures

| fixture                       | loaded as                                                | what it is for                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retrieval-replay-storefront` | `storefront`                                             | A frozen copy of `examples/storefront` (its README names the commit), so an edit to the live example never moves a snapshot. Joins, route options, twins of one fact under three names, a model per report.                                                                                                                                                                                     |
| `retrieval-replay-values`     | `replay-values`                                          | Dimensions tagged `#(index)`, for stored-value targets (storefront tags none).                                                                                                                                                                                                                                                                                                                  |
| `retrieval-replay-many`       | `replay-many`, `replay-judge-off`, `replay-custom-judge` | Eleven sources that share `amount` and `region`: a base and three extensions, six unrelated tables and one that joins another. More sources than a judge call may keep, and more candidates per target than `perTarget` and `listTopK` keep. The two other names load the same model with `retrieval.fcj.judge: false`, and with `retrieval.prompts.judge` and no embedding provider (lexical). |
| `retrieval-replay-clusters`   | `replay-clusters`                                        | `connect: "clusters"`, `collapseCopies` and `twinRule` on: an orders star with more measures than `clusterTopK`, two extensions that hold other rows under the same fields (twins), and four islands that each answer one target (one more than `maxClusters`).                                                                                                                                 |
| `retrieval-replay-governed`   | `replay-governed`                                        | A source behind an `#(authorize)` lock on a secure given, a row-gated (`#(access_filter)`) source with indexed values, an `#(agent-hidden)` source that holds the best match for a target, and (in `open.malloy`) an ungated source with indexed values that several spellings match.                                                                                                           |

All of them are synthetic or copied from this repository. A listing also shows `html-data-app` and an
environment `governed`, by name and description only (`LISTED_ONLY` in `cases.ts`): listed, never
loaded.

### The stand-ins

Two providers are stood in for (`stand_ins.ts`):

- **Embeddings**: the real OpenAI-compatible client over a stub endpoint that returns a
  bag-of-words vector for each text, so texts that share words are close.
- **The chat model** (the judge, and the index-time doc parts, questions and source summaries): the
  real chat client (JSON extraction, the one repair re-ask, retries) over replies computed by rule
  from the prompt, not recorded from a model. A rule never goes missing when a prompt changes, and
  the snapshot shows that the prompt changed.

The chat model is set to the production default concurrency (`retrieval.llm.concurrency`, 4), and
each stand-in reply waits a few milliseconds that depend on its prompt, so calls the engine sends
together finish out of order. `REPLAY_JITTER_SEED=<anything>` moves every delay; a run under any seed
must record the same snapshots. The snapshot records calls by content, not by completion order.

The stand-ins make the replay a record of what the engine does, not a measure of how good its
answers are. Use the `eval-loop` skill against a real model for that.

#### How the stand-in judge reads a prompt

The judge rule reads the prompt through a small grammar: the `<targets>` block, a `Target N (type):
"text"` line per target, then candidate lines `[n] name (kind, type; source s[; how it is reached]):
doc[ | stored values ...][ | added because: ...]`, route option lines (`[n] s.path.name (route from s
through path, join_kind): ...`) under their field, `From s:` headers, the `Also in this group:`
extras, and the reply format. A prompt it cannot read, a line before the first target, a target
block with no target, stored values in another shape, or an index-time prompt missing the part its
rule reads, throws a `StandInError`, and the case fails naming the line ("the stand-in chat model
could not read N prompt(s) ... Update stand_ins.ts for the new prompt format"). It never turns into
an empty reply, which the engine would answer as "No source in this package answered ...".

#### The judge's decision rule

For each target, independently of every other line in the call and of the order they are listed in:

- **Words.** A text's content words are its lower-case runs of letters and digits (`total_amount`
  is `total` and `amount`), three letters or longer, with a plural `s` or a past `ed` dropped, then
  stop words (`the`, `of`, `item`, ...) and the markers below removed; `number` reads as `count`.
- **Score.** A field scores 2 for each target word in its name and 1 for each other target word in
  its doc. It depends only on the target's text and the field's own name and doc.
- **Pick.** A field is picked when it scores 2 or more. There is no cap per call: the same field gets
  the same decision in one big call or in one call per source. Picks are listed by score, then
  name, then source; the first is `best`. The reason says how many scored high enough; it never
  names a field.
- **Routes.** A route option (a field reached from another listed source) is picked in place of its
  field when the field qualifies and every content word of the joining source's name is in the
  target ("number of products that were ordered" reads `order_items.products.product_count`).
- **Values.** A `dimensional_value` target picks every candidate shown with a stored value matched by
  spelling (`exact`, `words`, `typo`), or equal to the target ignoring case. In `values` it names
  the ones that hold every word of the target as a whole word, or, when none does, every one it
  matched: "Springfield" names "West Springfield" and "Springfield Gardens", not "Springfeld
  Heights". A candidate shown with `no stored values` is picked only when it is the target's only
  candidate (a dimension the caller pinned with `entity_name`).
- **Extras** (`Also in this group`) are never picked, and a reply carries no caveat or `readings`
  unless a marker asks.

#### Markers

A case asks for a harder reply by putting a reserved word in a target's `search_text`. A marker is
never a word of the target, so it changes only the reply (and the target's text as embedded and
shown).

| marker        | the stand-in's reply for that target                                                                       | what it exercises                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `zzbest2`     | `best` is the second pick, not the first                                                                   | the engine moving `best` to the front of the picks  |
| `zzreadings`  | `readings: true`                                                                                           | `twinRule` keeping twins the judge read both ways   |
| `zzcaveat`    | a caveat naming the best field (`stand-in caveat: <field> on <source> was a close call for target N.`)     | caveats on the first query group, or on the cluster |
| `zzroutes`    | every route option shown under a picked field is picked beside it                                          | `dropRoutesAt`                                      |
| `zzbadpick`   | the first reply also names a candidate number that was not offered; the repair re-ask gets the valid reply | the reply check and the repair re-ask               |
| `zzjudgefail` | every reply is not JSON, so the call fails after its repair re-ask                                         | the judge-step error a request answers with         |
| `zzname_<f>`  | a caveat naming field `<f>` (`stand-in caveat: <f> may answer target N too.`), picked or not               | the "also likely" fields a caveat names             |

#### The source-first engine's calls

The engine sends one pick call per kept source and one ordering call (configuration.md, "The
judge"). Both are read through a grammar, as above, and throw a `StandInError` on a line they do not
know:

- **A pick call** is the judge prompt above with a header that names its one source (`Source: name[ -
description]`, then `Its doc: "<json>"`) and, after `</targets>`, the caller's question (the
  question header line, then the question as one JSON string). Its candidate lines say
  `; through the join j` for a field reached through a join. The decision rule is the one above.
- **The ordering call** lists `What the caller is looking for:` (one `  type: "text"` line per
  target), then `<sources>` with `[n] name - "<doc as json>"` and, under `  Fields search found
here:`, a `    for "text": a, b` line per target. The stand-in orders the sources by the summed
  name score (`fieldScore`, with no doc) of the fields listed under each target, most first,
  ties by source name. That is not box 4's order, so a reordering shows in the snapshot.

What a marker cannot say goes in the case's `user_prompt`, which both calls quote:

| directive                      | the stand-in's reply                         | what it exercises                                                         |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| `[replay: fail pick <source>]` | that source's pick call fails (each attempt) | a source left out and named in a warning; its only target served unjudged |
| `[replay: order invalid]`      | the ordering reply names no kept source      | the ordering reply's check: box 4's order                                 |
| `[replay: order late]`         | the ordering call never answers              | the cut 0.3 s after the pick calls: box 4's order                         |

`zzjudgefail` fails every pick call and the ordering call, so the request is served from search's
top hits with a warning. A snapshot records each box 5 call with `call: "pick"` or `"order"`.

### What the corpus covers

`cases.ts` holds the cases, each with a sentence saying what it covers. Besides one target of each
type and the listings, they cover: many sources sharing a field (more than seven sources in one
answer), paging (`limit`, a page served from the held result, `offset` past the end, an offset that
misses the held result and runs again), the judge off, a package's own judge prompt with no
embeddings, every marker above (a caveat naming a field it did not pick, too), a route pick, routes past `dropRoutesAt`, a `join` target, a
`model_path` scope, a ranked `include_code`, `connect: "clusters"` (more islands than `maxClusters`,
more measures than `clusterTopK`, twins with and without `readings`, a dimension one join away and
one three joins away), a source
locked on a secure given (no givens, givens it refuses, givens that unlock it), a value search pinned
to a row-gated field with and without givens and with `filter_params`, several stored values of one
field matching one value, an `#(agent-hidden)` source holding the best match, and an answer over the
35,000-character page.

## Run it

```bash
cd packages/server
bun test --timeout 200000 tests/component/retrieval_replay
```

It takes about ten seconds. CI runs it with the other component specs (`bun run test:component`):
in the `Linux: server component` jobs of `.github/workflows/cross-platform-tests.yml` on every pull
request, and in the macOS and Windows legs of the same workflow (nightly, on a pull request labelled
`cross-platform`, and before a release). There is no separate job. Fixtures are loaded with LF line
endings whatever the checkout did, and snapshots are compared with LF line endings.

The replay means the same in any order, in any subset and repeated: each case starts with no held
result, and a case's snapshot holds everything that case recorded. `--randomize`, `--seed=<n>`,
`--rerun-each=<n>` and `-t <pattern>` all work for a check.

## Re-record after an intended change

```bash
cd packages/server
UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay
git diff tests/goldens/retrieval_replay
```

Commit the changed snapshots with the change that caused them, and say in the pull request which
snapshots moved and why. Re-recording refuses to run when `CI` is set: a snapshot changes only in a
commit someone wrote. It writes nothing, and fails saying so, unless every case recorded, so never
under a test-name filter (`-t`): the snapshots the cases share (the index builds, the judge system
prompts) and the clean-up of snapshots no case records any more belong to a whole run. A whole
recording deletes the snapshot of a case that no longer exists, and a judge system prompt no case
cites.

To add a case, append it to `CASES` in `cases.ts` with a new `id` and re-record. Do not edit a
case's request in place; give the new request a new id. A new fixture goes under
`packages/server/tests/fixtures/` and into `PACKAGES`; it must be synthetic or public.

## Read a snapshot

The snapshots are in `packages/server/tests/goldens/retrieval_replay/`, one JSON file per case:

| key                               | what it holds                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`                         | the `get_context` arguments, as sent                                                                                                                             |
| `request_keys_the_schema_dropped` | present only when the tool's input schema dropped an argument the case sent                                                                                      |
| `response.is_error`               | whether the tool answered with an error result                                                                                                                   |
| `response.payload`                | the whole response a caller receives, as JSON (a judge-step error's stage trace carries timings, which are removed)                                              |
| `traffic.embedding_calls`         | calls to the embedding endpoint during this request, and `embedded_texts`, what they sent                                                                        |
| `traffic.judge_calls`             | judge calls during this request, and under `judge` each one's `system_sha256`, `prompt_sha256`, the prompt as lines, and the stand-in's reply, ordered by prompt |
| `traffic.other_chat_calls`        | present only when a request made a chat call that is not the judge                                                                                               |
| `steps`                           | in place of the keys above, for a case of several calls: one entry per call, in order                                                                            |

The other files are not cases:

- `_index_build.json`: each package's index build report (timings removed), the calls the build made
  (embedding calls and texts, chat calls by kind, the hash of every chat prompt) and the warm-up
  call that started the build, which answers `retrieval: "indexing"` while it runs.
- `_index_inputs.<package>.json`: what that build sent, readable: every embedded text, every
  index-time chat prompt as lines, and each distinct system prompt. A package whose build sent the
  same inputs as another's says `same_as`.
- `judge_system_prompts/<hash>.txt`: the text of each judge system prompt, named by the first 16
  hex digits of the `system_sha256` the cases cite, so a change to the judge's instructions is one
  readable diff.

When a snapshot differs, the failure prints the changed lines and the command to re-record. Read
the diff by what moved:

- only `response.payload` moved: callers see a different answer.
- `traffic.judge[].prompt` moved: the judge is shown something different; a different reply and
  payload often follow.
- `embedding_calls` or `judge_calls` moved: the request costs more, or less.
- `_index_build.json` or an `_index_inputs` file moved: the index is built differently, which
  usually moves many cases.
