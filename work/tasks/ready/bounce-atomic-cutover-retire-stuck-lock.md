---
title: 'PR-2a: flip all three bounce seams to surface + classifier fold + crash-recovery test (the mechanism, NOT the test migration)'
slug: bounce-atomic-cutover-retire-stuck-lock
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-surfaces-stuck-sidecar-and-releases-lock]
covers: [1, 3, 4]
---

## Why this is PR-2a (re-split 2026-07-13, after a second build agent stop)

The original PR-2 tried to do the seam cutover AND the ~84-assertion migration AND the exit-code flip in one change. A build agent verified four real under-specifications against the code and stopped rather than guess across the migration. The maintainer answered the open questions (below) and re-split PR-2 into **PR-2a (this task)** and **PR-2b (`bounce-migrate-stuck-assertions-and-flip-exit-codes`)**:

- **PR-2a = the MECHANISM.** Flip ALL THREE `stuck`-producing bounce sites to the PR-1 surface primitive, wire the narrow main-authoritative recovery predicate + the classifier fold, and prove it with focused NEW crash-recovery/surface tests. It keeps the tree GREEN by leaving the 84 pinned `stuckLockOnArbiter(...).toBe(true)` assertions PASSING — see "How PR-2a stays green" below.
- **PR-2b = the CHURN.** Migrate the 84 `stuckLockOnArbiter(...).toBe(true)` assertions to the A1 triple and flip the pinned exit-code assertions per the written policy. Blocked by PR-2a.

Both are BLOCKED BY PR-1 (`bounce-surfaces-stuck-sidecar-and-releases-lock`), which added `prepareTreelessSurfaceCommit` + the `sidecarSurfacedOnArbiterMain`/`needsAnswersOnArbiterMain` test helpers.

## The maintainer-answered decisions (resolve the four gaps the agent found)

These are DECIDED, not hints. Build to them; do not relitigate. If the CODE contradicts one, STOP with the specific obstruction rather than guessing an alternative.

### D1 — `itemPath` resolution: PROBE `<arbiter>/main`, no-op-if-absent, NO caller signature change

The bounce seams' callers pass only `{cwd, slug, reason, arbiter, …}`, not an `itemPath`. Do NOT add an `itemPath` parameter to the ~17 caller sites. Instead the seam RESOLVES the item's on-`main` body path itself by probing `<arbiter>/main` in a FIXED order for the namespace it is bouncing:

- a TASK (`task:<slug>` / bare slug): probe `work/tasks/ready/<slug>.md` then `work/tasks/backlog/<slug>.md`; take the first that exists on `<arbiter>/main`.
- a SPEC (`spec:<slug>`, the tasking bounce — see D2): probe `work/specs/ready/<slug>.md` then `work/specs/proposed/<slug>.md`.
- (an OBSERVATION bounce, if any seam reaches one: probe `work/notes/observations/<slug>.md`.)

If the body is NOT found on `<arbiter>/main` (a bounce for an item whose body never landed on main — e.g. a claim that lost/raced), the surface is a CLEAN NO-OP for the sidecar/`needsAnswers` write, but the seam STILL RELEASES the lock (never throw, never leave a held lock, never drop the bounce silently to a dead end). Note this "surfaced vs release-only" distinction in the seam result so a caller/test can tell them apart. Reuse the existing `pathInCommit`/`catBlob` helpers `prepareTreelessSurfaceCommit` already uses; the probe is a couple of `pathInCommit(base, candidate, …)` checks.

### D2 — the `tasking-lock.ts` bounce IS in scope, and it lands HERE (PR-2a)

There are THREE `stuck` producers on bounce paths, not two: the two `ledger-write.ts` seams (`applyNeedsAttentionTransition` cwd-bound + `applyTreelessNeedsAttentionTransition` tree-less) via `bounceToStuckLock`, AND `tasking-lock.ts`'s `releaseTaskingLock({routeToNeedsAttention})` via `markStuckItemLock` on the `spec:<slug>` lock (the tasker decomposition-unclear / task-SET-acceptance-`block` bounce). Retire ALL THREE here so that after PR-2a NO bounce produces `stuck` — otherwise the downstream `retire-stuck-lock-state` drift-check ("if any producer still writes `stuck`, stop") fails, and "no bounce leaves a stuck lock" is false.

The tasking bounce surfaces the SPEC body (which genuinely stays in `work/specs/ready/` under the tasking lock): set `needsAnswers:true` on the spec body + write a `spec-<slug>` sidecar via the SAME `prepareTreelessSurfaceCommit` primitive (its `itemPath` resolves via the D1 spec-folder probe). Its exit code is ALREADY `0` today (a routed-to-needs-attention release returns `exitCode: 0`), so keep it `0` — no exit-code change for this site, only the mechanism swap `markStuckItemLock → surface primitive + release`.

### D3 — exit-code policy (for PR-2b, stated here so PR-2a's new tests assert the right thing)

"A cleanly-surfaced bounce is GREEN (`exitCode: 0`) IFF its surface transition SUCCEEDED; a FAILED surface (sidecar not written / lock not released) stays non-zero." Applies to `agent-stopped`, `agent-failed`, `gate-failed`, `needs-attention`(rebase-conflict), and the tasking bounce (D2, already 0). The ONLY exclusion is the EMPTY-DIFF backstop, owned by `empty-diff-bounce-surfaces-dispose-defaulted-question` (#364) — do NOT touch its exit code or fixtures here or in PR-2b. PR-2a wires the behaviour + asserts it in its NEW focused tests; PR-2b flips the pre-existing pinned `exitCode).toBe(1)` assertions that this behaviour change falsifies.

## How PR-2a stays green WITHOUT migrating the 84 assertions (the load-bearing split rule)

Retiring `bounceToStuckLock` would instantly falsify all 84 `stuckLockOnArbiter(...).toBe(true)` assertions, which is exactly why the earlier single task was un-buildable. PR-2a MUST keep them passing so it is an independently-green, reviewable change and PR-2b owns the churn. Do it by NOT DELETING the old helpers' behaviour out from under the assertions in the SAME change:

- **KEEP `bounceToStuckLock`/`markStuckItemLock` as functions** (do not delete them yet — deletion is PR-2b/`retire-stuck-lock-state` territory). PR-2a changes what the bounce SEAMS CALL, not the existence of the old helpers.
- The 84 assertions call the test helper `stuckLockOnArbiter(repo, slug)`, which reads the lock ref's `state`. After PR-2a the seams surface+release, so a bounced item has NO lock and `stuckLockOnArbiter(...)` would read false → the 84 `.toBe(true)` would go RED. That is unavoidable if the seam flip lands. So PR-2a CANNOT flip the seams and keep the 84 green simultaneously — which means the split boundary is: **PR-2a lands the primitive-level pieces that are INDEPENDENTLY testable (the classifier fold, the recovery predicate, the tasking-bounce spec-surface, and NEW seam-level tests behind a fresh test file), and the actual SEAM re-point + the 84-assertion migration land TOGETHER in PR-2b.**

  RESOLUTION (decided): the seam re-point and the assertion migration are genuinely inseparable for green, so PR-2a's concrete deliverable is: (a) the classifier fold in `item-lock.ts` (independently testable — a held active lock + needsAnswers+sidecar on main classifies `cleared-stale`), (b) the narrow main-authoritative recovery predicate wired into `resumeItemLock`/`release-lock`/`gc --ledger` for the NEW state (additive; the old `stuck`-based recovery stays), (c) NEW focused tests for the surface-then-release ordering + crash-recovery + the classifier, driven directly against `prepareTreelessSurfaceCommit`/`reconcileItemLockAgainstMain` (NOT through the 84-assertion seams). PR-2a does NOT re-point the three bounce seams. **PR-2b re-points the three seams AND migrates the 84 assertions AND flips the exit codes in one atomic change** (they are inseparable for green, per the original insight). PR-2a de-risks PR-2b by landing + proving every mechanism PR-2b then wires in.

> If, on inspecting the code, you find a way to re-point the seams in PR-2a while keeping the 84 green (e.g. the assertions already tolerate release), PREFER doing the seam flip here and shrinking PR-2b to just the assertion migration — but do NOT turn the tree red to do it. The invariant is: every landed PR is independently green.

## What to build (PR-2a)

1. **Classifier fold** (`item-lock.ts`): teach `classifyItemLockAgainstMain` + `reconcileItemLockAgainstMain` that a NON-terminal held `active` lock whose item on `<arbiter>/main` is `needsAnswers:true` with a matching sidecar is a stranded-active crash-orphan ⇒ `cleared-stale` (cleared, main-authoritative), NOT `kept-in-flight`. A genuine live hold (`needsAnswers:false` / no sidecar) stays `kept-in-flight`, untouched. Leave the `stuck`-keyed branches in place (removed later by `retire-stuck-lock-state`).
2. **Narrow recovery predicate** (additive): wire the same main-authoritative check into `resumeItemLock` / `release-lock` / `gc --ledger` recovery so the crash-window orphan is CLEARABLE. ADD only; do NOT rewrite the `stuck`-based recovery (owned by `retire-stuck-lock-state`). The two coexist interim.
3. **The tasking-bounce spec-surface primitive path** (D2): make `releaseTaskingLock({routeToNeedsAttention})` surface the spec body (`needsAnswers:true` + `spec-<slug>` sidecar via `prepareTreelessSurfaceCommit`, itemPath by the D1 spec probe) THEN release — but land it so the tree stays green (if the tasking-lock tests pin `stuck`, this specific site's flip may need to ride PR-2b too; if it can flip green here because its tests already assert the release/exit-0 outcome, do it here). Follow the same green invariant.
4. **NEW focused tests** (a fresh test file, NOT the 84-assertion files): surface-then-release ORDERING (surface on `main` lands FIRST, lock released SECOND); crash-safety (simulated crash between step 1 and step 2, and before step 1, resolves deterministically from `main` via the predicate — never a dangling `needsAnswers` with no sidecar, never a held lock over an already-surfaced item); the classifier fold (the three lock/main combinations → `cleared-stale` vs `kept-in-flight`); the D1 body-absent no-op-but-release case.

## Acceptance criteria (PR-2a)

- [ ] Classifier: a held `active` lock over a bounced-and-surfaced item (`needsAnswers:true` + matching sidecar on `<arbiter>/main`, non-terminal) classifies as `cleared-stale`; a genuine live hold (`needsAnswers:false` / no sidecar) still classifies `kept-in-flight`. Covered by a new test.
- [ ] The narrow main-authoritative recovery predicate CLEARS the crash-window orphan via `resumeItemLock` / `release-lock` / `gc --ledger`, ADDITIVELY (the `stuck`-based recovery is untouched).
- [ ] New focused tests prove: surface-FIRST-release-SECOND ordering; crash-safety at both crash points resolves from `main`; the D1 body-absent case is a clean no-op surface that STILL releases the lock.
- [ ] The 84 `stuckLockOnArbiter(...).toBe(true)` assertions are UNCHANGED and still GREEN (PR-2a does not migrate them; PR-2b does). If a chosen approach reds any of them, it is out of PR-2a's scope — shrink PR-2a until the tree is green.
- [ ] `bounceToStuckLock` / `markStuckItemLock` still EXIST (not deleted here).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` (PR-1): consumes `prepareTreelessSurfaceCommit` + the two test helpers.

## Prompt

> Goal (PR-2a — the MECHANISM, not the test migration): land + PROVE every primitive the seam cutover needs, keeping the tree GREEN and NOT migrating the 84 `stuckLockOnArbiter(...).toBe(true)` assertions (that is PR-2b). Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user stories 1, 3, 4; decisions #1, #4).
>
> The FOUR previously-open gaps are DECIDED in the body (D1 itemPath probe / D2 tasking-lock in scope / D3 exit-code policy / the green-split rule). Build to them. Do NOT re-derive or relitigate; if the CODE contradicts a decision, STOP with the specific obstruction (do not silently pick an alternative).
>
> Deliver: (1) the classifier fold in `item-lock.ts` (`classifyItemLockAgainstMain` + `reconcileItemLockAgainstMain`): active + non-terminal + `needsAnswers:true` + matching sidecar on `<arbiter>/main` ⇒ `cleared-stale`, else `kept-in-flight` unchanged; (2) the narrow main-authoritative recovery predicate wired ADDITIVELY into `resumeItemLock` / `release-lock` / `gc --ledger` (do NOT touch the `stuck`-based recovery); (3) the D1 body-path probe helper (task: `tasks/ready`→`tasks/backlog`; spec: `specs/ready`→`specs/proposed`; body-absent ⇒ no-op surface + STILL release the lock; no caller signature change); (4) NEW focused tests in a FRESH file for ordering + crash-safety + the classifier + the body-absent case — driven against `prepareTreelessSurfaceCommit` / `reconcileItemLockAgainstMain` directly, NOT through the 84-assertion seams.
>
> KEEP `bounceToStuckLock` / `markStuckItemLock` alive (deletion is later). Do NOT re-point the three bounce seams if doing so reds the 84 `.toBe(true)` assertions — that seam flip + the assertion migration are PR-2b's atomic job. The invariant is: EVERY landed PR is independently green.
>
> Where to look: `packages/dorfl/src/needs-attention.ts` (`prepareTreelessSurfaceCommit` + `surfaceStuckToNeedsAttention` + `runTreelessLedgerMove` + `releaseItemLock`, and `pathInCommit`/`catBlob`); `ledger-write.ts` (the two bounce seams + `bounceToStuckLock`); `tasking-lock.ts` (`releaseTaskingLock` + `markStuckItemLock`, D2); `item-lock.ts` (`classifyItemLockAgainstMain` + `reconcileItemLockAgainstMain`, the four outcomes); the PR-1 helpers `sidecarSurfacedOnArbiterMain`/`needsAnswersOnArbiterMain`/`stuckLockOnArbiter` in `test/helpers/gitRepo.ts`.
>
> Ordering is load-bearing: surface-to-`main` FIRST, release SECOND. RETRY (rebase+re-push on CAS rejection) is orthogonal and still applies.
>
> Done = the classifier fold + additive recovery predicate + D1 probe helper + new focused tests all land, the 84 assertions stay green + unchanged, `bounceToStuckLock`/`markStuckItemLock` still exist, acceptance gate green. RECORD non-obvious in-scope decisions (the exact recovery predicate + classifier fold; the D1 probe order + body-absent behaviour) durably and linked from the done record; if a decision meets the ADR gate, write an ADR.

## Requeue 2026-07-13

Requeued after re-splitting into PR-2a (this, the mechanism) + PR-2b (the churn) with all four gaps answered (D1 itemPath probe, D2 all-three-producers, D3 exit-code policy, green-split rule). --reset: the stopped run produced no work branch.

## Requeue 2026-07-13

Requeued (continue) after resolving the integration rebase conflict in needs-attention.ts (merge of #364's envelope + PR-2a's optional itemPath). The branch now holds the cleanly-rebased tip; full suite green (223 files/3135 tests). Next claim re-hits the recovery path -> Gate 2 -> opens a reviewed PR.
