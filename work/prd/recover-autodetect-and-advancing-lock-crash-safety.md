---
title: The stranded-done auto-recover must not DISCARD a continue-agent's new work, the advancing lock must be CRASH-SAFE, and a stuck advancing lock must be REAPABLE — three coupled defects exposed by a live advance run that lost a Gate-2 fix and left a one-slug-two-folder ledger
slug: recover-autodetect-and-advancing-lock-crash-safety
humanOnly: true
---

> Launch snapshot — records intent at creation. Current truth on slicing: the slices in `work/backlog/`. Originating evidence: `work/observations/recover-already-committed-discards-continue-agent-new-work.md` (the live incident) + the commit/ledger archaeology in this PRD.

## Problem Statement

A live `agent-runner advance "slice:autonomous-integration-refusal-surfaces-not-strands-in-progress" --propose --watch` (2026-06-16) was supposed to CONTINUE a requeued slice (kept work branch) and add the small in-place `performDo` mapping a Gate-2 review had demanded. The agent did exactly that and reported the gate GREEN in its working tree. The run nonetheless ended in failure, the agent's fix was LOST, and the arbiter ledger was left corrupt. Three distinct defects combined:

**Defect A — the stranded-done auto-recover DISCARDS a continue-agent's new work.** The `autonomous-path-auto-recovers-already-committed-stranded-branch` slice (merged) added an auto-detect in `complete.ts` that, on the autonomous path, sets the recover-already-committed mode purely from BRANCH FOLDER STATE:

```
const committedRecovery = !onInProgress && !onNeedsAttention && onDone;   // complete.ts ~L476 on origin/main
```

When `committedRecovery` is true the integration core SKIPS the build/done-move/COMMIT steps and only rebases+integrates the ALREADY-committed kept tip (`recoverAlreadyCommitted`, `integration-core.ts` ~L1352, dispatched at ~L490). But on a CONTINUE the slice is ALSO in `done/` on the kept branch (the prior attempt done-moved it), so the predicate fires even when the agent just produced NEW, uncommitted work THIS run. The new edits are never committed; the run prints `>> recovered a stranded already-complete branch … integrating the kept commit (no rebuild)` and integrates the STALE tip. Verified: the branch tip `36ceca5` (dated this run) does NOT contain the in-place `strand-surfaced` mapping at `do.ts` ~L1073 — the agent's fix evaporated. This is the exact "a `done/` slice genuinely being CONTINUED vs a finished STRAND is folder-indistinguishable" hazard the `finish-already-committed-branch` slice flagged; the auto-detect resolves it by FOLDER + tip-ahead alone, which is insufficient on the continue path.

**Defect B — the advancing lock is not CRASH-SAFE across a throwing recover/integrate.** `advance` takes the `advancing` CAS borrow (`work/advancing/<type>-<slug>.md`) and releases it in a `finally` (`advance.ts` ~L903). But when the recover path threw (the rebase conflict), the release's CAS micro-commit never landed on the arbiter (the run exited 1 with no `advancing: release` commit). The commit archaeology on `origin/main` shows `advancing: lock` (`029b58d`) then `claim` (`5c2a3e1`) then NOTHING — the release is missing. Result: the slug is left in BOTH `work/advancing/slice-<slug>.md` (a STUCK lock) AND `work/in-progress/<slug>.md` — a one-slug-two-folder ledger that violates the core invariant and blocks/contends the next advance.

**Defect C — a stuck advancing lock is not REAPABLE by any command.** `releaseAdvancingLock` is internal to `advance` (no CLI surface), and `gc --ledger` only REPORTS a multi-folder slug (belt-and-suspenders) — it does not reap a stale `work/advancing/` marker, and `gc --remote-branches` / the worktree reaper do not touch it either. So a human who hits Defect B has NO supported command; they must hand-craft a tree-less commit to delete the orphaned marker. There is no recovery verb for the lock the system itself created and orphaned.

These are coupled: A is what made the run throw mid-recover; B is why the throw corrupted the ledger; C is why the corruption is hard to clean. Each is independently a real defect, and together they turned a one-line continue into lost work + a stuck arbiter.

## Solution

Three fixes, one per defect, that compose:

- **A — gate the auto-recover on "NOTHING TO COMMIT" (the runner decides from tree state; the agent signals nothing).** DECIDED (human, 2026-06-16): the robust rule is structural, not a heuristic. The recover-already-committed auto-detect (`committedRecovery`, `complete.ts` ~L476) must additionally require that the working tree has NO new work to commit. By definition the recover path SKIPS the `git add -A` + commit step (`integration-core.ts` step 3) and integrates the already-committed kept tip — so if the agent produced ANY uncommitted changes this run, recover mode would DISCARD them and is therefore ALWAYS wrong on a build tick. Verified flow: in `do`/`advance` the agent ALWAYS runs before `performComplete` and leaves its edits UNCOMMITTED (the core's step-3 commit is what captures them); the merged auto-detect keys purely off branch FOLDER state (`!onInProgress && !onNeedsAttention && onDone`) and never checks the tree, so it fires on a dirty continue and the new work evaporates. Fix: `committedRecovery` fires ONLY when there is nothing to commit (reuse the SAME `nothingStaged`/`git status --porcelain` check the core already uses at step 3) AND the branch is done-stranded. This needs NO agent signal, NO claim-base comparison, NO onboard-decision threading — it keys off the exact thing recover skips (the commit). The continue-vs-strand question dissolves: dirty tree ⇒ normal build path (commit + done-move + integrate); clean tree + done-stranded tip ⇒ recover the kept commit (the genuine strand, slice-1 behaviour preserved). The explicit `complete --isolated` surface is UNCHANGED (it deliberately recovers a stranded worktree and sets `committedRecovery` directly via `recover-isolated.ts`).

- **B — make the advancing lock release crash-safe / self-healing.** A throw anywhere in the post-lock dispatch (recover, integrate, gate) must STILL clear the `advancing` borrow, OR a subsequent run must reconcile it. The `finally` already calls release; the gap is that the release CAS did not land when the tree/refs were mid-operation. Make the release robust to a dirty/mid-rebase state (run it from a known-clean ref state, or retry against fresh main), so a failed run NEVER leaves a stuck advancing marker. The invariant to restore: after any `advance` run (success OR failure), the slug is in exactly ONE lifecycle folder and holds NO orphaned advancing borrow.

- **C — give the stuck advancing lock a HUMAN-INVOKED release verb + a REPORT (no automatic sweep).** DECIDED (human, 2026-06-16): because the advancing lock has NO liveness heartbeat, "provably orphaned" cannot be inferred safely (an old marker may belong to a slow-but-live run). So there is NO automatic reaper. Instead: (1) an explicit human command that releases a NAMED stuck lock — `agent-runner release-advancing <slug>` (or `gc --advancing <slug>`) — tree-lessly + CAS-published through the SAME `ledgerWrite` seam every other transition uses, NEVER `--force`, reusing the existing internal `releaseAdvancingLock`; and (2) `gc --ledger` / `status` REPORT (never delete) any slug present in `work/advancing/` so the human can SEE a stuck lock and choose to release it. The human asserts the lock is dead by naming it (the same trust model as `requeue` — a human putting a stuck item back); the tool never guesses.

## User Stories

1. As the runner on an autonomous CONTINUE, when the agent produces new work on a kept branch whose slice is already in `done/`, I want the new work BUILT + COMMITTED + integrated (the normal path), NOT discarded by the stranded-done auto-recover, so a continue never silently loses a fix.
2. As the runner, when the kept branch is a genuine FINISHED STRAND (no new work this run, tip ahead of main), I want the auto-recover to still integrate the kept commit (the slice-1 behaviour preserved) — the narrowing must not break the original recover.
3. As the operator using `complete --isolated <slug>`, I want the explicit stranded-worktree recovery UNCHANGED (it is the deliberate finish-a-strand surface; only the autonomous auto-detect is narrowed).
4. As the runner, after ANY `advance` run (success or failure, including a throwing recover/integrate), I want the `advancing` borrow CLEARED and the slug in exactly ONE lifecycle folder, so a crash never leaves a one-slug-two-folder ledger or a stuck lock.
5. As a human who hit a stuck advancing lock, I want a SUPPORTED command to clear a named orphaned `work/advancing/<slug>` marker (tree-less CAS, never `--force`), so I never have to hand-craft a git commit to recover.
6. As a maintainer, I want `gc --ledger` / `status` to SURFACE an orphaned advancing marker (a slug in `work/advancing/` with no active run) the same way it surfaces a multi-folder slug, so the stuck state is discoverable, not silent.
7. As a maintainer, I want regression tests that reproduce the live incident: a continue with new work on a `done/`-on-branch kept branch ⇒ the new work lands (not discarded); a throwing integrate ⇒ no stuck advancing marker; and the reaper clears a planted orphan — so these never recur.

### Autonomy notes

- **`humanOnly: true` (set):** these touch load-bearing recovery/lock invariants and a just-shipped slice's behaviour; a human should drive the slicing (sequencing, and the safety predicate for the reaper in C). Per the contract this does NOT propagate to the produced slices' own gates.
- **`needsAnswers`:** the two design cruxes are now DECIDED (A = gate recover on nothing-to-commit; C = human-invoked named-release, no auto-sweep). The only residual is slice ORDERING/serialisation (see Open Questions), which is a slicing-level call, not an open design question.

## Implementation Decisions (to confirm at slicing)

- **A is the priority / tracer.** It is the active data-loss bug; it should land first and standalone. The disambiguator (did-this-run-produce-work) is the crux — prefer a signal already in scope at the `complete.ts` `committedRecovery` computation (~L476): e.g. "is there new staged/committed work on the branch beyond the kept tip the recover would integrate", or "did onboard CONTINUE vs the kept tip == this-run's claim base". Record the chosen signal.
- **B reuses the existing release.** The `finally` already calls `releaseAdvancingLock`; the fix is making that release LAND from a mid-operation state (clean-ref publish / retry against fresh main), not a new mechanism. Compose with the abort path (the recover rebase aborts cleanly; ensure the release runs AFTER the abort restores a clean state).
- **C reuses the tree-less CAS seam.** The reaper publishes the marker deletion through `ledgerWrite`'s tree-less transition (the same one `requeue`/surface use), keyed on the advancing marker's identity. Surface via `gc --ledger` REPORT + (likely) an explicit `agent-runner release-advancing <slug>` / `gc --advancing` verb. Never auto-delete without a provable-safety predicate.
- **Composition with `branch-carries-code-not-ledger-status-main-owns-status`:** Defect B's corruption is an instance of the on-branch-`→done`-move self-conflict that PRD targets, and the kept branch here baked in a stale `work/advancing/` marker too. These fixes are the IMMEDIATE crash-safety + data-loss fixes; that PRD is the deeper "branch carries no ledger status" consolidation. Keep them separate; note the relationship.

## Open Questions (for the human at slicing — NOT pre-answered)

- **Ordering:** A first (data loss, standalone). Do B and C serialise (both touch the advancing-lock module / `advance.ts`) or are they file-orthogonal enough to parallelise?

## Out of Scope

- The deeper "branch carries no ledger status, main owns status" redesign (that is `branch-carries-code-not-ledger-status-main-owns-status`). This PRD is the targeted crash-safety + data-loss + reaper fix, not that consolidation.
- Adding a liveness heartbeat / owner-TTL to the advancing lock and any AUTOMATIC advancing-lock sweep (DECIDED out: C is human-invoked named-release only). If a future need for a safe automatic sweep arises, a heartbeat becomes its own PRD/slice.
- The immediate one-off operational cleanup of the specific stuck item from the incident (a human clears the orphaned `work/advancing/` marker + `requeue --reset`); that is a manual recovery, not a slice.

## Further Notes

- Originating evidence: `work/observations/recover-already-committed-discards-continue-agent-new-work.md`.
- Code anchors (verified on `origin/main`): the auto-detect `const committedRecovery = !onInProgress && !onNeedsAttention && onDone;` at `complete.ts` ~L476; `recoverAlreadyCommitted` at `integration-core.ts` ~L1352 (dispatch ~L490); the advancing acquire/release in `advancing-lock.ts` (`acquireAdvancingLock` ~L131, `releaseAdvancingLock` ~L421) and `advance.ts`'s `finally` release ~L903; `gc --ledger` REPORT-only in `cli.ts` ~L2580; the explicit `complete --isolated` recover in `recover-isolated.ts` ~L178 (to leave UNCHANGED).
- The incident's commit trail on `origin/main`: `029b58d` advancing-lock → `5c2a3e1` claim → (no release) — the missing release commit is the visible signature of Defect B.
