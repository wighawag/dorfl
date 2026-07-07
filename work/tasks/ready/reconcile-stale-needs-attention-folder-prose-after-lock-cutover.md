## Context

After the lock cutover (per-item lock `state: stuck` replaced the physical `work/needs-attention/<slug>.md` folder move), several docstrings and — more importantly — human-facing runtime strings across the codebase still describe the retired folder-move behavior as if it were live. The observable half is now the lock amend; nothing actually moves files into `work/needs-attention/` anymore, so any message that points a human at that folder is actively misleading.

This was spotted while removing the dead folder readers (slice `remove-dead-needs-attention-folder-readers-after-lock-cutover`) but was out of scope there. A sibling nit already ratified deferring the prose reconciliation to a follow-up; this is that follow-up.

## Scope

Text-only cleanup. No behavior change. Prioritise the human-facing RUNTIME strings that users actually see over pure docstring/comment drift — the runtime strings are the ones that actively mislead. Docstring/comment cleanup is welcome in the same pass but is secondary.

### Priority 1 — user-visible runtime strings (must fix)

These are what humans see when they run `do` / `run` / `requeue`:

- `do.ts` around lines 1360/1362, 1475/1478, 2337/2339 (line numbers approximate; the observation captured them at 1432/1434, 1547/1550, 2432/2434 at a later snapshot — grep for the phrase `work/needs-attention/` and for `routed it to` to locate them). These emit strings like "routed it to work/needs-attention/" that no longer reflect reality — the item is now marked `stuck` on its per-item lock, not moved.
- `cli.ts` `requeue` help text (around line 3026 / later 3207) which tells users they can recover from `work/needs-attention/<slug>.md`. Update to describe the lock-based `stuck` state and the correct recovery path.

Rewrite these to describe what actually happens now: the item's per-item lock is amended to `state: stuck` with the reason, and `requeue` clears that state (whatever the current mechanism is — verify against the code, don't guess).

### Priority 2 — docstring / comment drift (fix if cheap)

Same pass, lower stakes:

- `ledger-write.ts:161` (`ApplyNeedsAttentionTransitionInput` docstring: "to bounce to `work/needs-attention/` with its reason"), plus `:325`, `:634`, `:697`.
- `complete.ts:45`, `:93`, `:294`, `:473`, `:502`, `:755` — notes that say `git mv work/in-progress|done/<slug>.md -> work/needs-attention/<slug>.md`.
- `integration-core.ts:425`, `:621`, `:650`.
- `slicer-review-loop.ts:62`, `slicing.ts:1086`, `:1105`.

Line numbers are drift-prone; treat them as hints and grep for `needs-attention/` and `git mv` patterns to find the actual sites.

## Non-goals

- No behavior change. The `ledger-write.ts` strategy already delegates to `routeToNeedsAttention` which no longer moves files; leave that wiring alone.
- Not touching `needs-attention.ts`, `status.ts`, or `ledger-read.ts` — those were already reconciled.
- Not renaming `routeToNeedsAttention` or `ApplyNeedsAttentionTransitionInput` — the identifiers are fine; only the prose describing them is stale.

## Acceptance

- `rg -n 'work/needs-attention/' src/` (or the equivalent for this repo layout) returns no hits in user-facing runtime strings in `do.ts` and `cli.ts` requeue help; any remaining hits are in code paths that are genuinely about the historical folder (there should be none post-cutover) or have been deliberately kept with an updated framing.
- The `requeue` `--help` output describes the lock-based `stuck` state, not a folder.
- `pnpm -r build && pnpm -r test && pnpm format:check` passes.

## Notes

Purely a text pass; risk is low. If while doing this you discover a runtime path that DOES still try to move files into `work/needs-attention/`, stop and surface it — that would mean the lock cutover left a live remnant and is out of scope for a prose-only slice.