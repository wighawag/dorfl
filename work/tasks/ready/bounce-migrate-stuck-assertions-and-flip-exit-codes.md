---
title: 'PR-2b: re-point the three bounce seams + migrate the 84 stuck assertions + flip exit codes (atomic)'
slug: bounce-migrate-stuck-assertions-and-flip-exit-codes
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-atomic-cutover-retire-stuck-lock]
covers: [1, 3, 8]
---

## Why this is PR-2b (re-split 2026-07-13)

PR-2 was re-split after a build agent found the seam cutover + the ~84-assertion migration + the exit-code flip were too much (and under-specified) for one confident build. **PR-2a** (`bounce-atomic-cutover-retire-stuck-lock`) landed + PROVED the mechanism (the classifier fold, the narrow main-authoritative recovery predicate, the D1 body-path probe, and focused ordering/crash-safety tests) WITHOUT re-pointing the bounce seams, keeping the 84 `stuckLockOnArbiter(...).toBe(true)` assertions green. **THIS task (PR-2b) does the atomic, inseparable churn:** re-point the three bounce seams to the PR-2a surface primitive AND migrate the 84 assertions to the A1 triple AND flip the pinned exit codes — in ONE change, because re-pointing the seams instantly falsifies the 84 `.toBe(true)` assertions, so the flip and the migration cannot land separately and stay green.

BLOCKED BY PR-2a (it consumes PR-2a's classifier fold + recovery predicate + probe helper + the primitive wiring PR-2a proved).

## The decisions are ALREADY MADE in PR-2a's body — read them, do not relitigate

D1 (itemPath probe: task `tasks/ready`→`tasks/backlog`, spec `specs/ready`→`specs/proposed`, body-absent ⇒ no-op surface + still release, no caller signature change), D2 (all THREE `stuck` producers retired — the two `ledger-write.ts` seams + `tasking-lock.ts`), and D3 (exit-code policy: clean surface ⇒ 0 iff the surface succeeded; the EMPTY-DIFF backstop is EXCLUDED, owned by `empty-diff-bounce-surfaces-dispose-defaulted-question` #364) are stated in `work/tasks/ready/bounce-atomic-cutover-retire-stuck-lock.md`. Build to them.

## What to build (PR-2b)

1. **Re-point all THREE bounce sites** from the pure lock-amend (`bounceToStuckLock` / `markStuckItemLock`) to PR-2a's surface primitive: ONE ordered crash-safe transition (write/append the `stuck`-kind sidecar + set `needsAnswers:true` in one commit on `<arbiter>/main` via `prepareTreelessSurfaceCommit` with the D1-probed `itemPath`, THEN `releaseItemLock`). The three sites: `applyNeedsAttentionTransition` (cwd-bound) + `applyTreelessNeedsAttentionTransition` (tree-less) in `ledger-write.ts`, and `releaseTaskingLock({routeToNeedsAttention})` in `tasking-lock.ts` (unless PR-2a already flipped the tasking one green — then only the two ledger seams remain here).
2. **Retire `stuck` PRODUCTION from the bounce path**: after this task NO bounce leaves a `stuck` lock; a bounced item rests as a plain `needsAnswers:true` pool item (`eligible:false` by construction). Whether `bounceToStuckLock`/`markStuckItemLock` are DELETED here or left as now-uncalled dead code for `retire-stuck-lock-state` to remove is a judgement call — prefer deleting them IF nothing else calls them and the tree stays green; otherwise leave them uncalled and note it (do NOT delete the `stuck` STATE or its readers — that is `retire-stuck-lock-state`).
3. **Migrate ALL 84 `stuckLockOnArbiter(...).toBe(true)` assertions** (across ~31 test files) to the A1 triple using the PR-1 helpers: (a) `stuckLockOnArbiter(repo, slug)` is now `false` (lock RELEASED), (b) `sidecarSurfacedOnArbiterMain(repo, slug)` (the sidecar exists on `<arbiter>/main`), (c) `needsAnswersOnArbiterMain(repo, slug)` (the body reads `needsAnswers:true` on `<arbiter>/main`). Migrate faithfully per-file; the item's on-main folder for the `needsAnswers` read follows D1 (usually `tasks/ready`).
4. **Flip the pinned exit codes** per D3: the pre-existing `expect(result.exitCode).toBe(1)` assertions on bounce outcomes that now surface-cleanly become `.toBe(0)` (for `agent-stopped` / `agent-failed` / `gate-failed` / `needs-attention`(rebase-conflict); the tasking bounce is already 0). A bounce whose surface FAILED stays non-zero — keep those. **Do NOT touch the empty-diff backstop's exit code or fixtures** (owned by #364): identify its sites by the empty-diff fixture/`agent-stopped`-on-empty-diff cause and leave them exactly as they are.

## Acceptance criteria (PR-2b)

- [ ] All three bounce sites surface (sidecar + `needsAnswers:true` in one commit on `main`) THEN release the lock, in order, for BOTH the cwd-bound and tree-less paths (the tree-less one touches no working tree).
- [ ] After a bounce, NO `stuck` lock remains; the item is a `needsAnswers:true` pool item that is `eligible:false`.
- [ ] All 84 `stuckLockOnArbiter(...).toBe(true)` assertions are migrated to the A1 triple; NO `stuck`-producing bounce remains; the tree is green.
- [ ] Bounce exit codes are `0` on a clean surface (`agent-stopped`/`agent-failed`/`gate-failed`/`needs-attention`(rebase-conflict)/tasking), non-zero on a FAILED surface; the empty-diff backstop's exit code + fixtures are UNTOUCHED.
- [ ] The downstream `retire-stuck-lock-state` drift-check would now PASS (no producer writes `stuck` on a bounce path) — sanity-grep `markStuckItemLock`/`bounceToStuckLock` call sites and confirm none remain on a bounce path.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-atomic-cutover-retire-stuck-lock` (PR-2a): consumes its classifier fold, recovery predicate, D1 probe helper, and the proven surface-then-release wiring.

## Prompt

> Goal (PR-2b — the atomic churn): re-point ALL THREE `stuck`-producing bounce sites to PR-2a's surface primitive, migrate the 84 `stuckLockOnArbiter(...).toBe(true)` assertions to the A1 triple, and flip the pinned bounce exit codes to 0-on-clean-surface — ALL IN ONE change (re-pointing the seams falsifies the 84 assertions, so they are inseparable for a green tree). Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user stories 1, 3, 8; decisions #1, #4). BLOCKED BY PR-2a.
>
> The four design decisions (D1 itemPath probe / D2 all-three-producers / D3 exit-code policy / green invariant) are ALREADY MADE in PR-2a's body (`work/tasks/ready/bounce-atomic-cutover-retire-stuck-lock.md`). Read them; build to them; do NOT relitigate. If the CODE contradicts one, STOP with the specific obstruction.
>
> The three bounce sites: `applyNeedsAttentionTransition` + `applyTreelessNeedsAttentionTransition` (`ledger-write.ts`) and `releaseTaskingLock({routeToNeedsAttention})` (`tasking-lock.ts`). Each surfaces via `prepareTreelessSurfaceCommit` (itemPath by the D1 probe) THEN `releaseItemLock`, ordering surface-FIRST-release-SECOND.
>
> Migrate the 84 assertions faithfully per-file to the A1 triple (`stuckLockOnArbiter(...).toBe(false)` + `sidecarSurfacedOnArbiterMain(...)` + `needsAnswersOnArbiterMain(...)`). Flip `exitCode).toBe(1)`→`.toBe(0)` ONLY on the clean-surface bounce sites (D3); a FAILED surface stays non-zero. Do NOT touch the EMPTY-DIFF backstop's exit code or fixtures (owned by #364) — identify it by its empty-diff fixture / agent-stopped-on-empty-diff cause and leave it exactly as-is.
>
> Ordering is load-bearing (surface FIRST, release SECOND). RETRY (rebase+re-push on CAS rejection) is orthogonal and still applies.
>
> Done = three seams re-pointed + no `stuck` producer left on a bounce path + 84 assertions migrated + exit codes flipped (empty-diff untouched) + acceptance gate green. RECORD non-obvious in-scope decisions durably; if a decision meets the ADR gate, write an ADR.

## Requeue 2026-07-13

Clearing the orphaned active lock left by the 120min SIGKILL (run 29268967187, cancelled) — the hard kill discarded all WIP and never released the lock (the exact trap graceful-pre-timeout-wip-checkpoint fixes). --reset: no branch to preserve. Hold from auto-pick until the checkpoint feature merges + a short deadline is set to validate it.
