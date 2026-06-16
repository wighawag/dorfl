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

Three fixes, one per defect, that compose (sliced 2026-06-16 — the build detail now lives in the slices below):

- **A — gate the auto-recover on "NOTHING TO COMMIT".** The stranded-done auto-recover may fire only when the working tree has nothing to commit AND the branch is done-stranded; a dirty tree (the agent produced new work this run) takes the normal build→commit→integrate path so the work lands. The runner decides from tree state; no agent signal. The explicit `complete --isolated` surface is unchanged. → slice `recover-autodetect-gated-on-nothing-to-commit` (the urgent data-loss fix, standalone first).

- **B — make the advancing-lock release crash-safe.** A throw in the post-lock dispatch (recover/integrate/gate) must still clear the `advancing` borrow, so a failed run never leaves an orphaned marker + a one-slug-two-folder ledger. → slice `advancing-lock-release-crash-safe` (introduces the `advancingMarkerPath(entry)` path seam).

- **C — a human-invoked release verb + a report (no automatic sweep).** Because the lock has no liveness heartbeat, there is no auto-reaper: a human clears a NAMED stuck marker (`release-advancing <slug>`, tree-less CAS, never `--force`), and `gc --ledger`/`status` REPORTS orphaned markers so the stuck state is discoverable. → slice `advancing-lock-human-release-verb-and-surface` (introduces `listAdvancingMarkers()`; `blockedBy` B).

## User Stories

1. As the runner on an autonomous CONTINUE, when the agent produces new work on a kept branch whose slice is already in `done/`, I want the new work BUILT + COMMITTED + integrated (the normal path), NOT discarded by the stranded-done auto-recover, so a continue never silently loses a fix.
2. As the runner, when the kept branch is a genuine FINISHED STRAND (no new work this run, tip ahead of main), I want the auto-recover to still integrate the kept commit (the slice-1 behaviour preserved) — the narrowing must not break the original recover.
3. As the operator using `complete --isolated <slug>`, I want the explicit stranded-worktree recovery UNCHANGED (it is the deliberate finish-a-strand surface; only the autonomous auto-detect is narrowed).
4. As the runner, after ANY `advance` run (success or failure, including a throwing recover/integrate), I want the `advancing` borrow CLEARED and the slug in exactly ONE lifecycle folder, so a crash never leaves a one-slug-two-folder ledger or a stuck lock.
5. As a human who hit a stuck advancing lock, I want a SUPPORTED command to clear a named orphaned `work/advancing/<slug>` marker (tree-less CAS, never `--force`), so I never have to hand-craft a git commit to recover.
6. As a maintainer, I want `gc --ledger` / `status` to SURFACE an orphaned advancing marker (a slug in `work/advancing/` with no active run) the same way it surfaces a multi-folder slug, so the stuck state is discoverable, not silent.
7. As a maintainer, I want regression tests that reproduce the live incident: a continue with new work on a `done/`-on-branch kept branch ⇒ the new work lands (not discarded); a throwing integrate ⇒ no stuck advancing marker; and the reaper clears a planted orphan — so these never recur.

## Sliced 2026-06-16

The build detail (the per-defect mechanics, the chosen disambiguators, the test seams) moved into the slices; the durable cross-PRD composition notes are kept below. Slices (in `work/backlog/`):

- `recover-autodetect-gated-on-nothing-to-commit` (covers 1,2,3) — Defect A, the urgent data-loss fix; standalone, `blockedBy: []`; touches `complete.ts` only.
- `advancing-lock-release-crash-safe` (covers 4) — Defect B; `blockedBy: []`; introduces `advancingMarkerPath(entry)`.
- `advancing-lock-human-release-verb-and-surface` (covers 5,6) — Defect C; `blockedBy: [advancing-lock-release-crash-safe]` (same-module serialise + reuse); introduces `listAdvancingMarkers()`.

(Story 7's regression tests are not a separate slice — each slice carries its own incident-reproducing test, per the tracer-bullet rule.) All three slices are agent-buildable (no `humanOnly` — building each is mechanical/well-specified; this PRD's `humanOnly` gates only the slicing, which a human drove). None carries `needsAnswers` — the two design cruxes (A = gate on nothing-to-commit; C = human-invoked named release, no auto-sweep) were decided before slicing.

Durable composition notes:

- **`branch-carries-code-not-ledger-status-main-owns-status`:** Defect B's corruption is an instance of the on-branch-`→done`-move self-conflict that PRD targets. These fixes are the IMMEDIATE crash-safety + data-loss fixes; that PRD is the deeper "branch carries no ledger status" consolidation. Separate efforts.
- **folder-taxonomy reorg (cross-session, DECIDED 2026-06-16):** B/C stay on the FLAT `work/advancing/<entry>.md` path and ship first, routing all marker addressing through `advancingMarkerPath(entry)` + `listAdvancingMarkers()`; `<type>-<slug>` stays in the lock branch name. The folder-taxonomy PRD (`work/ideas/folder-taxonomy-and-prd-edit-handshake.md`) relocates the marker to a co-located `<slug>.lock.md` in a later slice that `sliceAfter`s this PRD and reuses `listAdvancingMarkers()` (recorded reciprocally on the taxonomy side).

## Out of Scope

- The deeper "branch carries no ledger status, main owns status" redesign (that is `branch-carries-code-not-ledger-status-main-owns-status`). This PRD is the targeted crash-safety + data-loss + reaper fix, not that consolidation.
- Adding a liveness heartbeat / owner-TTL to the advancing lock and any AUTOMATIC advancing-lock sweep (DECIDED out: C is human-invoked named-release only). If a future need for a safe automatic sweep arises, a heartbeat becomes its own PRD/slice.
- The immediate one-off operational cleanup of the specific stuck item from the incident (a human clears the orphaned `work/advancing/` marker + `requeue --reset`); that is a manual recovery, not a slice.

## Further Notes

- Originating evidence: `work/observations/recover-already-committed-discards-continue-agent-new-work.md`.
- Code anchors (verified on `origin/main`): the auto-detect `const committedRecovery = !onInProgress && !onNeedsAttention && onDone;` at `complete.ts` ~L476; `recoverAlreadyCommitted` at `integration-core.ts` ~L1352 (dispatch ~L490); the advancing acquire/release in `advancing-lock.ts` (`acquireAdvancingLock` ~L131, `releaseAdvancingLock` ~L421) and `advance.ts`'s `finally` release ~L903; `gc --ledger` REPORT-only in `cli.ts` ~L2580; the explicit `complete --isolated` recover in `recover-isolated.ts` ~L178 (to leave UNCHANGED).
- The incident's commit trail on `origin/main`: `029b58d` advancing-lock → `5c2a3e1` claim → (no release) — the missing release commit is the visible signature of Defect B.
