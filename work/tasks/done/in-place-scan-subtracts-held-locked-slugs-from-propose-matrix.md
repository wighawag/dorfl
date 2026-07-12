## Context

The CI `advance-lifecycle` (propose mode) matrix is built from `dorfl scan --json | jq` in `.github/workflows/advance-lifecycle.yml` (`enumerate` job). CI runs IN-PLACE, so the enumeration goes through `scanRepoPaths` in `src/scan.ts`, which:

- Defaults `heldSlugs = new Set()` (~L535) and its in-place callers (`do-autopick`, `advance-drivers`) pass `new Set()`, so the item pool is not subtracted.
- Calls `gatherLifecycleInPlace({...})` (~L566) with NO held-slug filter at all — triage/surface/apply pools never subtract held locks either.
- The held-slug subtraction via `heldSliceSlugs(mirror.path, 'origin', env)` (~L418) is wired ONLY on the mirror-side scan, which CI does not take.

Net effect (confirmed on 2026-06-22 in this repo): stuck/active-locked items (e.g. `task:c2-rebase-until-real-on-durable-main-promotions`, `task:per-machine-config-override-layer`, `task:prompt-guidance-testfirst-config-and-prompt-seam`) stay in the enumerated propose matrix. Their legs then ALWAYS lose the claim CAS (`src/claim-cas.ts:127-132`, "already claimed on origin/main (its per-item lock is held)"), exiting 2 every tick. Because `stuck` is by design the needs-attention surface (resumed via `resume`/`start`, NOT `advance --propose`), enumerating stuck items into the autonomous propose matrix is wrong: the leg can never succeed, CI is red every scheduled tick as long as any item is stuck (which is the normal state under `review: true`), and operators are trained to ignore "just the stuck items again" — masking real failures.

Unlike the benign stale-snapshot race in the sibling observation (`work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`), this is NOT a timing race that clears itself: the item is enumerated as eligible at snapshot time because the in-place scan never consulted the lock refs.

## Decision (from triage answer)

Mint this task for the ROOT-CAUSE enumerate-side fix: thread held-lock subtraction onto the in-place scan path so the propose matrix never enumerates a held/stuck item. Coordinate with the sibling observation's benign-skip-at-leg behaviour as a belt-and-suspenders SECOND layer covering the enumerate→fan-out race window (an item becoming held between snapshot and leg), rather than duplicating it here. Enumerate-side is primary; leg-side skip is referenced.

## Scope — what to change

Primary (this task):

1. `src/scan.ts` `scanRepoPaths(...)`: gather `heldSliceSlugs(path, arbiter, env)` for the in-place repo (the matrix's substrate) and pass it BOTH to `scoreItems` AND into `gatherLifecycleInPlace`, mirroring what the mirror-side branch (~L418) already does. Because `heldSliceSlugs` reads lock refs (async) and `scanRepoPaths` is currently sync, this likely means either:
   - an async variant of `scanRepoPaths` used by the in-place callers, OR
   - pre-fetching the held set in the CLI `scan` action and handing it in (the same shape the mirror path uses).
   Pick whichever keeps the diff small and the call sites honest; document the choice in the PR.
2. `src/lifecycle-gather.ts` `gatherLifecycleInPlace`: accept a `heldSlugs` parameter and subtract it from the triage / surface / apply pools, symmetric to the mirror-side gather.
3. In-place callers (`do-autopick`, `advance-drivers`, the CLI `scan` action feeding the workflow's `enumerate` job) plumb a REAL held set through instead of `new Set()`.

Secondary (belt-and-suspenders, coordinate — do NOT duplicate):

- The sibling observation proposes a benign-skip-at-leg tolerance for `advance` when the item is already-done / already-held. Land the enumerate-side fix here first; the sibling's leg-side skip then covers the residual enumerate→fan-out race window where an item becomes held between snapshot and leg. If the sibling has not landed by the time this ships, reference it from the PR so it is not lost, but do not fold its implementation into this task.

Out of scope:

- Reworking the mirror-side scan (already correct — this task copies its shape).
- Changing the Gate-2 / `review: true` stuck-hold semantics; stuck is intentional and this task just stops enumerating stuck items into autonomous propose.
- The operational residue (hand-cleared leaked locks on 2026-06-22 via `release-lock`) — that was diagnostic, not part of the bug.

## Acceptance

- On an in-place scan (the CI substrate), a slug whose `refs/dorfl/lock/task-<slug>` is HELD (state `stuck` or `active`) on the configured arbiter is NOT present in the propose matrix output of `dorfl scan --json`, nor in the triage / surface / apply pools produced by `gatherLifecycleInPlace`.
- Unit / integration test: seed an in-place repo with a held per-item lock (stuck) for an otherwise-eligible task; assert `scanRepoPaths` output omits it from both the item pool and the lifecycle pools, symmetric to the existing mirror-side coverage.
- Regression check against the observed failures: with `c2-rebase-until-real-on-durable-main-promotions` (or an equivalent seeded stuck item) held on `origin`, a propose-mode enumerate produces zero matrix legs for that slug, so no leg can hit the `claim-cas.ts:127-132` "already claimed" exit-2 path for a held-at-snapshot item.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Refs

- `.github/workflows/advance-lifecycle.yml` (`enumerate` job).
- `src/scan.ts` `scanRepoPaths` (~L512-595); mirror-side held subtraction (~L418).
- `src/lifecycle-gather.ts` `gatherLifecycleInPlace`.
- `src/item-lock.ts` `heldSliceSlugs`.
- `src/claim-cas.ts:127-132` (the exit-2 site this fix stops triggering for held-at-snapshot items).
- ADR `docs/adr/ci-config-policy-and-gate-family.md` §7 (claim CAS is the safety mechanism, but assumes the matrix does not repeatedly enumerate a permanently-held item).
- Sibling observation (leg-side benign-skip, coordinate): `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`.
- Originating observation: `work/notes/observations/advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22.md`.

## Prompt

> Build the task 'in-place-scan-subtracts-held-locked-slugs-from-propose-matrix', described above.
