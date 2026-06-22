---
needsAnswers: true
---

# Stale `work/needs-attention/` folder prose in `ledger-write.ts`, `complete.ts`, `do.ts`, `integration-core.ts` after the lock cutover

2026-06-22

While removing the dead folder readers (slice `remove-dead-needs-attention-folder-readers-after-lock-cutover`), noticed that several docstrings and human-facing strings outside `needs-attention.ts`/`status.ts`/`ledger-read.ts` still describe the retired folder-move behavior as if it were live:

- `ledger-write.ts:161` (`ApplyNeedsAttentionTransitionInput` docstring: "to bounce to `work/needs-attention/` with its reason"), `:325`, `:634`, `:697`.
- `complete.ts:45`, `:93`, `:294`, `:473`, `:502`, `:755` (notes say `git mv work/in-progress|done/<slug>.md -> work/needs-attention/<slug>.md`).
- `do.ts:1360`, `:1362`, `:1475`, `:1478`, `:2337`, `:2339` (human-facing strings: "routed it to work/needs-attention/").
- `integration-core.ts:425`, `:621`, `:650`.
- `cli.ts:3026` (the `requeue` help text mentions recovering from `work/needs-attention/<slug>.md`).
- `slicer-review-loop.ts:62`, `slicing.ts:1086`, `:1105`.

The behavior is already on the per-item lock `state: stuck` (the `ledger-write.ts` strategy delegates to `routeToNeedsAttention` which no longer moves; the OBSERVABLE half is the lock amend). Out of scope for that slice, but worth a small follow-up pass to reconcile the prose so the user-facing `do`/`run`/`requeue` messages stop pointing humans at a folder that no longer exists.
