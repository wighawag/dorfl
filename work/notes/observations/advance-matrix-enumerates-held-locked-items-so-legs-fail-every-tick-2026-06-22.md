---
title: The advance-lifecycle propose matrix enumerates items whose per-item lock is HELD (active/stuck), so those legs fail the claim CAS every CI tick
type: observation
status: spotted
spotted: 2026-06-22
needsAnswers: true
---

## What was seen

On a CI `advance-lifecycle` run (propose mode), several matrix legs failed with
exit code 2 / "already claimed":

```
agent-runner advance "task:c2-rebase-until-real-on-durable-main-promotions" --propose --watch --arbiter origin
>> 'c2-rebase-until-real-on-durable-main-promotions' is already claimed on origin/main (its per-item lock is held). ...
Error: Process completed with exit code 2.
```

Same for `task:per-machine-config-override-layer` and
`task:prompt-guidance-testfirst-config-and-prompt-seam`.

Investigation (this repo, 2026-06-22):

- Each of those slugs had a HELD per-item lock on `origin`
  (`refs/agent-runner/lock/task-<slug>`), state `stuck` (Gate-2 review blocked) or
  `active` (a leaked crash hold). All three task bodies were already in
  `work/tasks/done/`. (Those specific leaked locks were cleared by hand via
  `release-lock` while diagnosing — that is the OPERATIONAL residue, not this bug.)
- The STRUCTURAL bug: the propose matrix is built from
  `agent-runner scan --json | jq` (`.github/workflows/advance-lifecycle.yml`,
  `enumerate` job). The IN-PLACE scan path (`scanRepoPaths`, the surface CI reads)
  does NOT subtract held-locked slugs from the LIFECYCLE pools, and the in-place
  `scoreItems` caller passes the DEFAULT empty `heldSlugs` set:
  - `src/scan.ts` (~L566) calls `gatherLifecycleInPlace({...})` with NO held-slug
    filter at all — triage/surface/apply pools never subtract held locks.
  - `src/scan.ts` `scanRepoPaths(...)` defaults `heldSlugs = new Set()` (~L535) and
    its in-place callers (`do-autopick`, `advance-drivers`) pass `new Set()`, so the
    in-place item pool is not subtracted either. The held-slug subtraction is wired
    only on the MIRROR-side scan (`heldSliceSlugs(mirror.path, 'origin', env)`,
    ~L418) — but CI runs IN-PLACE, so that branch is not taken.
- Net: a stuck/active-locked item stays in the enumerated matrix. Its leg then
  ALWAYS loses the claim CAS (`src/claim-cas.ts:127-132`, "already claimed on
  origin/main"), exiting non-zero EVERY tick. Because a `stuck` lock is by design
  the needs-attention surface (the human resumes it via `resume`/`start`, NOT via
  `advance --propose`), enumerating it into the autonomous propose matrix is wrong:
  the leg can never succeed.

## Why it matters

This reds CI on EVERY scheduled tick for as long as any item is stuck (which is the
NORMAL state after a Gate-2 review block — `review: true` is on, so stuck holds are
expected and routine). Unlike the benign stale-snapshot race
(`advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21`), this is NOT a
timing race that clears itself: the item is enumerated as eligible at snapshot time
because the in-place scan never consulted the lock refs. The operator is trained to
ignore a red CI that is "just the stuck items again", which masks real failures.

## The idea (NOT decided here)

Thread held-lock subtraction onto the IN-PLACE scan path so the propose matrix
never enumerates a held item:

- `scanRepoPaths` should gather `heldSliceSlugs(path, arbiter, env)` for the
  in-place repo (the matrix's substrate) and pass it BOTH to `scoreItems` AND into
  `gatherLifecycleInPlace` so triage/surface/apply pools also subtract held slugs —
  mirroring what the mirror-side scan already does. (`scanRepoPaths` is currently
  sync; reading lock refs is async, so this likely means an async variant or
  pre-fetching the held set in the CLI `scan` action and handing it in, the same
  way the held set is supplied to the mirror path.)
- Alternatively/additionally, the `advance` leg could treat "item is held by a
  STUCK lock" as a benign skip (exit 0 / a tolerated code) rather than exit 2, the
  same shape the sibling observation proposes for the already-done race — so even if
  a stuck item slips into the matrix, it does not red CI.

To weigh: subtract-at-enumerate (matrix never lists held items) vs
benign-skip-at-leg (leg tolerates a held item) vs BOTH (defence in depth). The
enumerate-side fix is the root cause; the leg-side fix is the belt-and-suspenders
that also covers the enumerate→fan-out race window where an item becomes held
between snapshot and leg.

## Provenance / refs

- `.github/workflows/advance-lifecycle.yml` (`enumerate` job: `scan --json | jq`;
  the `advance-propose` matrix legs).
- `src/scan.ts`: `scanRepoPaths` (~L512-595, default empty `heldSlugs`, in-place
  `gatherLifecycleInPlace` call with no held filter); the mirror-side branch (~L418)
  that DOES subtract via `heldSliceSlugs`.
- `src/lifecycle-gather.ts`: `gatherLifecycleInPlace` (no held-slug parameter).
- `src/claim-cas.ts:127-132` (the "already claimed ... per-item lock is held"
  message + exit).
- `src/item-lock.ts`: `heldSliceSlugs` (the held-set reader the mirror path already
  uses).
- ADR `docs/adr/ci-config-policy-and-gate-family.md` (§7 the claim CAS, not the
  matrix, is the safety mechanism — but it assumes the matrix does not REPEATEDLY
  enumerate a permanently-held item).
- Sibling note (the already-done benign race + done/typo conflation):
  `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`.

## Note on scope

Root cause is the in-place scan not subtracting held locks (a real selection
defect), compounded by the leg exiting loud on a designed-held item. Both are
small, well-scoped CI-correctness improvements. A human decides whether to slice
one task (subtract-at-enumerate) or also fold in the benign-skip-at-leg behaviour
shared with the sibling observation.
