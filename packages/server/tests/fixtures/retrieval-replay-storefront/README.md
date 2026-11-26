<!--
Copyright (c) Credible Data Inc.
SPDX-License-Identifier: MIT
-->

# Frozen storefront for the retrieval replay

A copy of `examples/storefront` as it was at commit `bc51e5ef` (where the copied files were last
changed by `c3aabaea`), so an edit to the live example never moves a retrieval replay snapshot. Only
what the replay loads is kept: the `.malloy` files, `skills/` (a ranked answer lists the package's
skills) and `data/`. `data/order_items.parquet` holds 300 rows of the original (`ORDER BY ALL`),
with the same columns: the replay reads schemas, not rows, because no storefront dimension is tagged
`#(index)`. `publisher.json` drops the `agents` block, whose files are not copied.

Change this copy only on purpose, re-recording the replay in the same commit. See
`docs/retrieval-replay.md`.
