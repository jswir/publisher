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

The spec is `packages/server/tests/component/retrieval_replay/retrieval_replay.spec.ts`. It loads a
copy of the bundled `examples/storefront` package, plus a small synthetic package
(`tests/fixtures/retrieval-replay-values`) whose dimensions are tagged `#(index)` (storefront tags
none, so its stored-value searches have no value index to match). It builds each package's search
index into a real DuckDB catalog, then sends every case in `cases.ts`, in order, through the
`get_context` tool's handler: the same code the MCP endpoint calls, without the transport.

Two providers are stood in for (`stand_ins.ts`):

- **Embeddings**: the real OpenAI-compatible client over a stub endpoint that returns a
  bag-of-words vector for each text, so texts that share words are close.
- **The chat model** (the judge, and the index-time doc parts, questions and source summaries): the
  real chat client over replies computed by rule from the prompt, not recorded from a model. The
  judge rule picks the candidates listed under each target that share a word with the target's
  text (a value target: the values matched by spelling), so a target nothing matches comes back
  unresolved. The ordering call's rule puts the sources whose block shares the most words with
  the targets first. A case can steer the stand-in through its `user_prompt`, which both judge
  prompts quote: `[replay: fail pick <source>]`, `[replay: fail every pick]`,
  `[replay: order invalid]` and `[replay: order late]`. A rule never goes missing when a prompt
  changes, and the snapshot shows that the prompt changed.

The stand-ins make the replay a record of what the engine does, not a measure of how good its
answers are. Use the `eval-loop` skill against a real model for that.

## Run it

```bash
cd packages/server
bun test --timeout 200000 tests/component/retrieval_replay
```

It takes a few seconds. CI runs it with the other component specs (`bun run test:component`, in the
`Linux: server component` jobs of `.github/workflows/cross-platform-tests.yml`); there is no
separate job.

## Re-record after an intended change

```bash
cd packages/server
UPDATE_GOLDENS=1 bun test --timeout 200000 tests/component/retrieval_replay
git diff tests/goldens/retrieval_replay
```

Commit the changed snapshots with the change that caused them, and say in the pull request which
snapshots moved and why. Re-recording refuses to run when `CI` is set: a snapshot changes only in a
commit someone wrote. A recording also deletes the snapshot of a case that no longer exists.

To add a case, append it to `CASES` in `cases.ts` with a new `id` and re-record. Do not edit a
case's request in place; give the new request a new id.

## Read a snapshot

The snapshots are in `packages/server/tests/goldens/retrieval_replay/`, one JSON file per case:

| key                        | what it holds                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`                  | the `get_context` arguments, as sent                                                                                                                                                                                             |
| `response.is_error`        | whether the tool answered with an error result                                                                                                                                                                                   |
| `response.payload`         | the whole response a caller receives, byte for byte as JSON                                                                                                                                                                      |
| `traffic.embedding_calls`  | calls to the embedding endpoint during this request, and `embedded_texts`, what they sent                                                                                                                                        |
| `traffic.judge_calls`      | judge calls during this request (one pick call per kept source, and the ordering call), and under `judge` each one's `call` (`pick` or `order`), `system_sha256`, `prompt_sha256`, the prompt as lines, and the stand-in's reply |
| `traffic.other_chat_calls` | present only when a request made a chat call that is not the judge                                                                                                                                                               |

Two more files are not cases:

- `_index_build.json`: each package's index build report (timings removed) and the calls the build
  made: embedding calls and texts, chat calls by kind, and the hash of every chat prompt.
- `_system_prompts.json`: the text of each judge system prompt, keyed by the `system_sha256` the
  cases cite, so a change to the judge's instructions is one readable diff.

When a snapshot differs, the failure prints the changed lines and the command to re-record. Read
the diff by what moved:

- only `response.payload` moved: callers see a different answer.
- `traffic.judge[].prompt` moved: the judge is shown something different; a different reply and
  payload often follow.
- `embedding_calls` or `judge_calls` moved: the request costs more, or less.
- `_index_build.json` moved: the index is built differently, which usually moves many cases.
