---
'dorfl': patch
---

A question surfaced in CI (the tree-less phase split of `advance --phase`) now keeps the context and suggested default the `surface-questions` agent gave it, so its sidecar is the same as the laptop's. In `handoff.json` (still schema 1) each entry of the `surface` and `triage` `questions` list is either the bare question text or the closed object `{question, context?, default?}`; any other key, a non-string value or a text over the 10,000-character limit is rejected. An `apply-decision` `ask` with several questions now appends each as its own sidecar question instead of joining them into one.
