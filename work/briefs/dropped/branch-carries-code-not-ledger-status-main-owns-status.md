---
title: The work branch carries CODE (plus only the atomic →done move); MAIN owns ledger status — eliminate the on-branch needs-attention move and the bookkeeping-drop rebase mechanism it forces
slug: branch-carries-code-not-ledger-status-main-owns-status
humanOnly: true
reason: superseded
---

> **RETIRED / SUPERSEDED 2026-06-19.** This PRD's own SUPERSESSION NOTICE said:
> "DO NOT slice this PRD independently... if the lock PRD is adopted, retire/fold
> this one into it." `work/prd/ledger-status-per-item-lock-refs.md` is now FULLY
> ADOPTED (all 12 slices in `work/done/`): all transient ledger status moved off
> `main` onto per-item lock refs, so a work branch inherits NO ledger status, the
> on-branch needs-attention move is gone, and `drop-bookkeeping-rebase` is deleted
> — exactly this PRD's goals, achieved as a side-effect. The preserved PRINCIPLE
> ("main owns ledger status; the branch carries code") is generalised by the lock
> ADR (`main` owns the DURABLE records; the lock ref owns the transient holds).
> Nothing remains to build here. Retired to `work/dropped/` (reason: superseded).
> The original body is kept below for provenance.

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. (The technical-detail sections below are trimmed by `to-slices` once the work is sliced — they move into slices/ADRs and this PRD settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

> **SUPERSESSION NOTICE (2026-06-17): this PRD's MECHANISM is subsumed by `work/prd/ledger-status-per-item-lock-refs.md`** (ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`). That PRD moves ALL transient ledger status off `main` onto per-item lock refs, so a work branch cut from `main` inherits NO ledger status at all, which makes THIS PRD's on-branch needs-attention-move removal AND the `drop-bookkeeping-rebase` deletion fall out for free (there is no transient status on a branch to drop). The PRINCIPLE here ("main owns ledger status; the branch carries code") is PRESERVED and generalised by the lock PRD (main owns the DURABLE records; the lock ref owns the transient holds). DO NOT slice this PRD independently of that decision: if the lock PRD is adopted, retire/fold this one into it (the `→done` atomicity it keeps becomes the lock PRD's durable-promotion move); if the lock PRD is NOT adopted (the Set-1 fallback), this PRD stands as-is. Reconcile at slicing time, not before.

## Problem Statement

When an autonomous build fails (red acceptance gate, agent failure) or a recovery `complete` runs, the runner has to do two things: (1) PRESERVE the partial work so it is recoverable cross-machine, and (2) SURFACE the stuck state on the ledger so `scan`/`status`/another machine can see it. Today it does BOTH by, among other things, committing a `chore(<slug>): route to needs-attention; <reason>` MOVE-ONLY commit (a `git mv work/in-progress/<slug>.md → work/needs-attention/<slug>.md`) onto the `work/<slug>` branch AND, separately, tree-lessly moving the same ledger file on `main`.

That dual authoring is the root of a recurring, expensive class of defect: the branch now carries a ledger-folder transition that `main` ALSO owns, so when the branch is later rebased onto a `main` the runner has independently advanced (`needs-attention → backlog → in-progress` on re-claim, or a surfaced `needs-attention` state on recovery), the branch's stale move-only commit REPLAYS onto a main whose ledger file is in a different folder and CONFLICTS — the agent self-conflicting with the runner's own protocol bookkeeping. The codebase already names this a "DESIGN DEFECT" in `continue-branch.ts`.

The current mitigation is a `drop-bookkeeping-rebase` mechanism that, at BOTH rebase sites (the integration-recovery rebase and the onboard continue-rebase), identifies and DROPS the branch's bookkeeping move-only commit before replay so it never conflicts. That mitigation is itself fragile: it identified the commit to drop by pattern-matching git's RENDERED rebase-todo text, which is version-unstable and silently broke on the git 2.54 CI runner (the live `complete-from-needs-attention` failures), forcing a follow-up hardening slice (`identify-bookkeeping-commits-by-trailer-not-rendered-todo-text`, still in backlog). Every iteration treats a symptom: the move should not be on the branch at all.

The conceptual error is a LAYER violation. `backlog` / `in-progress` / `needs-attention` are properties of the LEDGER on `main` — they describe where an item sits in the shared workflow. They are NOT properties of a work branch: from the branch's point of view the work is simply "in progress" (commits accumulating) until it is done. By authoring a `→needs-attention` move on the branch, the runner puts a main-owned concept on the wrong layer, then needs an ongoing mechanism to undo the collision it created.

## Solution

Establish and enforce one principle:

> The work branch carries CODE, plus exactly ONE ledger move — the `→done` move — which is the atomic exception (it must land together with the artifacts it asserts, so `main` never shows `done/` without the code). The branch NEVER authors a `→needs-attention` (or `→backlog`/`→in-progress`) move. ALL non-done ledger-status transitions are tree-less compare-and-swap moves on `main`, reproduced from main's own current state.

Concretely, the autonomous failure bounce (red gate / agent failure) and any other "this item is stuck" path SAVE the work as a `wip` (code) commit on `work/<slug>` and PUSH the branch (preserve work, unchanged) but surface `in-progress → needs-attention` ONLY tree-lessly on `main` — they stop committing the `route to needs-attention` move onto the branch. Recovery `complete` first RESTORES `needs-attention → in-progress` on `main` (the existing resolve-protocol step `start` already performs), so the branch's `→done` move has a matching source folder and the integration rebase replays cleanly.

Because the branch no longer edits `work/<slug>.md` for status, there is nothing on the branch that can collide with main's ledger state on a rebase. The `drop-bookkeeping-rebase` mechanism — and the in-flight `identify-bookkeeping-commits-by-trailer-not-rendered-todo-text` slice that hardens it — become UNNECESSARY and are removed. The recurring self-conflict class is eliminated at the root rather than mitigated.

From the user's perspective: autonomous runs that fail still preserve and surface their work exactly as before (recoverable branch on the arbiter + visible needs-attention on main); recovery `complete` of a good item still lands it in `done/`; but the runner stops manufacturing self-conflicts, so the git-version-fragility and the "rebase-conflict where there is no real conflict" failures disappear, and there is less machinery to maintain.

## User Stories

1. As the runner, when an autonomous build fails, I want to SAVE the agent's partial work as a `wip` commit on `work/<slug>` and push the branch, so the work is recoverable cross-machine (UNCHANGED from today).
2. As the runner, when an autonomous build fails, I want to surface `in-progress → needs-attention` ONLY tree-lessly on `main`, NOT as a commit on the work branch, so the branch never carries a ledger-status move.
3. As the runner, I want the work branch to carry only code commits plus (at completion) the atomic `→done` move, so the branch never edits `work/<slug>.md` for a non-done status.
4. As a maintainer, I want `backlog`/`in-progress`/`needs-attention` to be defined as ledger status owned by `main` (transitioned tree-lessly), and the branch to be "just code in progress", so the layering is coherent and the glossary pins the concept.
5. As the runner performing a recovery `complete` from `needs-attention`, I want to first restore `needs-attention → in-progress` on `main` (via the existing CAS resolve transition), so the branch's `→done` move has a matching source folder on main.
6. As the runner, I want the `→done` move authored from `in-progress/` (main's restored truth), so the integration rebase replays with no folder mismatch, and the existing divergent-base guard remains the backstop if placement is unexpectedly different.
7. As the runner integrating a recovery, I want the rebase to be a PLAIN rebase onto `<arbiter>/main` with no bookkeeping-drop step, because the branch carries no `→needs-attention` move to drop.
8. As the runner onboarding a continued (kept) `work/<slug>` branch, I want the continue-vs-fresh decision to stay ancestry-based (the branch tip is ahead of main ⇔ continue), unaffected by ledger folders, and the continue rebase to be plain (no drop), because the branch never edited the ledger file.
9. As the runner, when two recoverers race to restore the same item, I want the restore to be serialised by the SAME compare-and-swap the ledger write seam already uses (one wins; the loser re-fetches and finds it already in-progress), so concurrency is safe with no new primitive.
10. As a maintainer, I want the `drop-bookkeeping-rebase` module and its two call sites removed once the branch no longer authors the move, so the version-fragile rebase-todo matching is gone for good.
11. As a maintainer, I want the in-flight `identify-bookkeeping-commits-by-trailer-not-rendered-todo-text` slice retired/superseded by this PRD (it hardens a mechanism this PRD deletes), with the disposition recorded so the backlog does not carry both.
12. As a maintainer, I want this PRD's slices to compose with `onboard-and-reset-reconcile-mirror-to-arbiter` (arbiter is the source of truth for ledger state; the branch is code) rather than contradict it, since both express the same "main/arbiter owns status, branch carries code" principle.
13. As a maintainer, I want the protocol docs updated at the SOURCE (`skills/setup/protocol/*`, e.g. `WORK-CONTRACT.md`'s "self-conflict on a rebase" rule, which currently describes the on-branch bookkeeping move and the drop) and mirrored byte-identically into `work/protocol/*`, so the contract reflects "the branch carries no needs-attention move".
14. As a CI operator, I want the `complete-from-needs-attention` behaviour to pass on any git version (it no longer depends on rebase-todo rendering), and the test un-quarantined from `RACE_SENSITIVE` (it was wrongly tagged a parallel-load flake).
15. As the runner, I want the autonomous red-gate surface and the recovery restore to remain crash-safe: if the code lands but a subsequent tree-less ledger flip fails, the item is left RECOVERABLE (code on the arbiter, ledger behind), never in a corrupt or lost state.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (DECIDED, set):** a human must drive the SLICING of this PRD. It reshapes a load-bearing invariant (where ledger status lives), removes a module, and supersedes an already-written peer slice — the kind of change whose slicing benefits from human judgement on sequencing and on the retire-vs-supersede decision for the trailer slice. (Per the contract this does NOT propagate to the produced slices' own gates; individual slices may be fully agent-buildable once cut.)
- **`needsAnswers` (NOT set):** the design is resolved. The one detail that moves from "automatic" to "must be specified" — recovery-complete restores in-progress first, the `→done` move is authored from `in-progress/`, the existing divergent-base guard backstops it — is a slicing-level specification, not an open question that would mis-cut slices. The concurrency, atomicity, and continue-detection questions were each checked against existing code and resolved (see Implementation Decisions). If a slicer discovers the recovery-restore-then-done sequencing needs a new sub-decision (e.g. a distinct crash-recovery handling), THAT is the point to raise a question, not now.

## Implementation Decisions

- **Status lives on `main`, transitioned tree-lessly; the branch carries code + the atomic `→done` move only.** This is the governing decision; everything else follows. It likely warrants an ADR (it is hard to reverse, surprising without context, and trades the old "branch self-describes its ledger state" for "main is authoritative").
- **The autonomous failure bounce stops committing the `route to needs-attention` move on the branch.** It keeps the `wip` (code) save + branch push (preserve work) and keeps the tree-less surface on `main` (already exists via the ledger-write surface transition). The in-worktree author of the on-branch move (in `needs-attention.ts`) is removed from the bounce path; the tree-less surface becomes the sole needs-attention authoring.
- **Recovery `complete` restores `needs-attention → in-progress` on `main` FIRST**, reusing the existing `applyResolveNeedsAttentionTransition` (the same CAS/leased publish `start` uses before onboarding) — NOT a new mechanism. The done-move is then authored from `in-progress/`.
- **The integration-recovery rebase and the onboard continue-rebase become PLAIN rebases.** With no `→needs-attention` move on the branch there is nothing to drop. `rebaseDroppingNeedsAttentionSurface` / `rebaseDroppingBookkeepingMoves` and the `drop-bookkeeping-rebase` module are removed, along with their call sites in `integration-core.ts` and `continue-branch.ts`.
- **Continue-detection (`branchAheadOf`) is unchanged** — it is ancestry-based and never reads the ledger file, so removing the on-branch ledger move does not affect continue-vs-fresh.
- **The divergent-base / one-slug-one-folder guard (`readArbiterLedgerPlacement`) stays** as the backstop that FAILS LOUD if the arbiter holds the slug in an unexpected folder when the done-move integrates.
- **The trailer slice is superseded.** `identify-bookkeeping-commits-by-trailer-not-rendered-todo-text` hardens the mechanism this PRD deletes; record its disposition (retire it, or keep it ONLY as the interim CI-green fix until this PRD's slices land, then delete). Do not leave both live.
- **Composition with `onboard-and-reset-reconcile-mirror-to-arbiter`:** both assert arbiter/main authority over ledger state. Slice ordering should respect any file-overlap in `continue-branch.ts` (serialise via `blockedBy` if the same functions are touched), exactly as that slice already does.

## Testing Decisions

- Seam: the autonomous failure path (`do`/`run`) — assert the work branch after a red gate carries the `wip` (code) commit and is pushed, but carries NO `route to needs-attention` move-only commit; and that `main` shows the item in `needs-attention/` (tree-less surface). Prior art: `do.test.ts`, `run.test.ts`, `needs-attention-surface-on-main.test.ts`, `treeless-surface-transition.test.ts`.
- Seam: recovery `complete` from needs-attention (`complete-from-needs-attention.test.ts`) — assert it restores `in-progress` on main first, the rebase is plain (no drop), and the item lands in `done/` with no `rebase-conflict`, on the repo's normal git (version-independent).
- Seam: onboard continue (`continue-branch.test.ts`, `do.test.ts` continue paths, `requeue-continue-and-reset.test.ts`) — assert continue still works from a kept branch and from a fresh clone, with a plain rebase and no bookkeeping drop.
- Seam: concurrency — two recoverers racing the restore → exactly one wins via the existing CAS; the loser is a clean no-op (mirror the existing claim/CAS race tests).
- Crash-safety: if the post-code ledger flip is interrupted, the item is recoverable (code on arbiter, ledger behind) — assert no corrupt 2-folder state and that a re-run converges.
- Removal coverage: assert the `drop-bookkeeping-rebase` module and its call sites are gone and the suite is green without them; un-quarantine `complete-from-needs-attention.test.ts` from `RACE_SENSITIVE` and confirm it passes in the parallel project.
- Use throwaway `--bare` `file://` arbiters + real clones/mirrors as the existing isolation/continue tests do; no network. Run the acceptance gate under the repo's normal git.

## Out of Scope

- Making the `→done` move itself tree-less. The done-move stays a real branch commit, atomic with the code — that atomicity is the reason done is the exception. (An earlier exploration of "make done tree-less too" is deliberately NOT pursued here; it would put the code-land/ledger-flip atomicity at risk for no gain.)
- Auto-resolving genuine code conflicts. The "never auto-resolve a real content clash; abort → needs-attention" invariant is untouched; this PRD removes a FALSE conflict (the runner's own bookkeeping), it does not soften the real-conflict guard.
- Changing the claim/lock protocol or the slicing lifecycle transitions beyond what "status is tree-less on main" already implies.
- The immediate CI-green fix itself: `identify-bookkeeping-commits-by-trailer-not-rendered-todo-text` may land first as the interim mitigation; this PRD's relationship to it (supersede/retire) is in scope, but re-litigating that slice's internal design is not.

## Further Notes

- This PRD COMPLETES a direction the codebase is already half-committed to: on re-claim the runner ALREADY tree-lessly advances `main` (`needs-attention → backlog → in-progress`), and `start` ALREADY restores in-progress on main before onboarding. The defect is only that the autonomous bounce ALSO writes the move on the branch. So this is a coherence/consolidation change, not a new subsystem.
- The originating discussion: the `drop-bookkeeping-rebase` regex broke on git 2.54 (`# %s` became the default rebase `instructionFormat`), surfacing as `complete-from-needs-attention` CI failures green on git 2.47/2.53. The trailer slice was written as the robust same-shape fix; this PRD is the deeper "don't create the commit to drop" fix that the trailer slice's existence prompted.
- Glossary: pin (in `CONTEXT.md`) that `backlog`/`in-progress`/`needs-attention`/`done` are LEDGER statuses owned by `main`, and that a work branch is "code in progress" carrying at most the atomic `→done` move — so a future author cannot re-introduce an on-branch status move.
- ADJACENT-BUT-DISTINCT (do NOT fold in when slicing): two backlog slices from a 2026-06-16 CI incident — `autonomous-path-auto-recovers-already-committed-stranded-branch` (a re-claim landing on an already-done-moved+committed-but-unmerged branch must integrate the kept commit / no-op, not crash with `nothing to complete`) and `autonomous-integration-refusal-surfaces-not-strands-in-progress` (an autonomous integration REFUSAL must surface to needs-attention, not silently strand `in-progress/`) — concern the branch state this PRD KEEPS (the atomic `→done` move on the branch) and the recover/refuse paths, NOT the on-branch `→needs-attention` move this PRD removes. They COMPOSE with this PRD and are independent of it: this PRD does not fix them, and they do not block it. Note especially that the failure-bounce slice is written in THIS PRD's direction (it forbids `saveAgentFailure`'s on-branch `→needs-attention` move and surfaces tree-lessly), so the two reinforce rather than collide. When slicing this PRD, treat them as already-cut neighbours, not as stories to re-derive.
