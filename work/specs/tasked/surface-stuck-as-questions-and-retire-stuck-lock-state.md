---
title: Surface every "needs a human" bounce as a question sidecar on main, and retire the `stuck` lock state
slug: surface-stuck-as-questions-and-retire-stuck-lock-state
humanOnly: true
needsAnswers: false
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (Technical-detail sections below are trimmed by `to-task` once tasked; the spec then settles to Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

When an autonomous leg cannot finish an item it BOUNCES the item to needs-attention. Post the `needs-attention → lock stuck` cutover (`cutover-needs-attention-becomes-lock-stuck-recovery-surface`), that bounce is a PURE LOCK AMEND: the per-item lock is set `state: stuck` with the reason (and any agent-surfaced questions) recorded on the lock entry. This has two compounding problems observed live on lifecycle run `29206312575`:

1. **A stuck item is a DEAD END with no human-visible outcome on `main`.** The stuck record lives ONLY on a hidden `refs/dorfl/lock/<entry>` ref. There is no `work/questions/` sidecar, no `main` change, no folder — nothing a human browsing the repo would ever see. Worse, `advance-drivers.ts` SUBTRACTS held (`active`/`stuck`) slugs from EVERY pool (build, triage, surface, apply), so a stuck item is invisible to the loop forever: nothing re-surfaces it, nothing drains it. It only re-enters the flow if a human happens to know it is stuck and runs `requeue` by hand. The reason + agent questions rot on a ref nobody reads. (The `LockEntry.questions` field was added in anticipation of exactly this fix — "a future advance-surface rung can render into a `work/questions/` sidecar" — but that rung was never built.)

2. **A healthy REFUSAL is indistinguishable from a real failure.** Several bounce reasons are the agent doing the RIGHT thing: "the task premise is stale / already-done", "the observation I was told to edit was discharged" (a real convention collision surfaced, not guessed), "empty diff — nothing to do". On the same run, 3 of 9 red legs were these healthy refusals; they exit 1 and red the CI matrix identically to a genuinely-broken gate. An adopter reads the run as a wall of failures when most of it is the loop working as designed. (See `work/notes/observations/agent-stopped-healthy-refusal-reds-the-ci-matrix-like-a-real-gate-failure-2026-07-12.md`, whose A/B/C options THIS spec supersedes.)

The underlying design smell: there are TWO mechanisms for "an item is parked" — the `work/questions/` sidecar (for items that need human ANSWERS) and the `stuck` lock (for items a leg BOUNCED). The first is human-visible, `main`-durable, and drained by the existing apply rung. The second is hidden, ref-only, and drained by nothing. They should be ONE mechanism.

## Solution

Collapse "a bounced/stuck item" into the EXISTING surface→apply question loop, and RETIRE the `stuck` lock state entirely. The lock stays as the in-flight coordination/CAS primitive; it stops being a place items rot.

Concretely, three moves:

- **A bounce SURFACES a question sidecar on `main`, atomically, and RELEASES the lock.** Instead of `markStuckItemLock` (amend lock → `stuck`), a bounce performs ONE crash-safe transition that: (a) writes/updates the item's `work/questions/<type>-<slug>.md` sidecar with the bounce reason + any agent-surfaced questions, (b) sets `needsAnswers:true` on the item body on `main`, and (c) RELEASES the lock (deletes the ref). The item now RESTS as a plain `needsAnswers:true` pool item — human-visible, `main`-durable, and naturally excluded from the build/slice pool (a `needsAnswers:true` item is `eligible:false` by construction).

- **The apply rung drains it — MOSTLY via existing outcomes, with ONE gap.** The apply rung already consumes a `needsAnswers:true` item with an answered sidecar and dispatches a disposition from `{task | spec | adr | delete | resolve | ask}` (`decision-engine.ts`). Verified mapping of the three answers a bounce needs:
  - **continue (requeue-keep)** = the EXISTING `resolve` outcome (`applyAnsweredQuestions` clears `needsAnswers` + deletes the sidecar; the `work/<slug>` branch is left UNTOUCHED so the next claim continues from its tip). No new logic. ✅
  - **cancel/give-up** = the `dispose` outcome (the renamed `delete`, resolved decision #5), which is REGIME-POLYMORPHIC: for a TASK it is a `git mv → tasks/cancelled/` (retained, `reason:` in body); for an OBSERVATION it is `git rm` (notes leave by deletion); for a SPEC, `git mv → specs/dropped/`. A task can thus never be hard-deleted, only disposed to its terminal.
  - **reset (discard-WIP-and-rebuild-clean)** = the existing `resolve` outcome carrying an optional `resolveReset: true` flag, which dispatches the `requeue --reset` branch-delete before clearing `needsAnswers` (resolved decision #6). One new optional verdict channel, not a new outcome; naturally scoped to a task with a pre-existing `work/<slug>` branch and safely ignored otherwise.
  This is the four-case generalization the retired brief captured: `needs-attention`(bounce)→requeue/cancel/reset, `merge-questions`→land, `triage`→promote/drop, `surface`→edit-body all share ONE shape (surface a decision → human answers → apply dispatches the action).

- **RETIRE `state: stuck`.** `LockState` collapses from `'active' | 'stuck'` to just the active hold. "Resting, needs a human" is expressed on `main` (`needsAnswers:true` + sidecar), NOT on a lock. The lock is held ONLY during live claim/build/advance work (real CAS mutual-exclusion) and is always released at the end of a leg — success (durable `main` move) OR bounce (surface + `needsAnswers`). No lock ever outlives its leg except a genuine crash-orphan (which recovery clears by treating `main` as authoritative), so the whole "stuck lock rots forever / must be hand-requeued" class disappears.

### Why the lock CAN'T be removed entirely (the boundary, decided with the maintainer)

The `stuck` STATE goes; the lock PRIMITIVE stays. `needsAnswers:true` on `main` replaces the RESTING-exclusion job of the stuck lock (a parked item is naturally out of the eligible pool), but it does NOT replace the IN-FLIGHT mutual-exclusion job: setting `needsAnswers` is a CAS write to the SHARED `main` ref, which is the retrying/serialised path the per-item lock exists to AVOID (`ledger-status-per-item-lock-refs` P-opt-1: a per-item ref push is self-arbitrating, no retry loop, no false contention). So a live claim/build/advance still holds an `active` per-item lock. The net change is only that a leg NEVER leaves a `stuck` lock behind — it always ends by releasing, having first surfaced the item on `main` if it bounced.

### The empty-diff / "nothing to do" case (a refinement over the retired brief)

A bounce reason of "empty diff / produced no change" is a NON-DETERMINISTIC LLM judgement, not ground truth, so a blind requeue would INFINITE-LOOP (the next leg re-runs, re-judges "nothing to do", re-bounces). This case must ALSO surface a sidecar, but with a DISPOSE-defaulted question — *"`<slug>`: the agent produced no change (`<reason>`). Cancel this item? [default: yes]"* with `needsAnswers:true`. "Cancel" here is the `dispose` outcome (#5), which for a task moves it to `tasks/cancelled/` (retained), NOT a hard delete. This (a) breaks the requeue loop, (b) preserves the context (why the agent saw nothing to do), (c) gives the human a one-glance confirm/override, and (d) unifies "nothing to do" into the same sidecar mechanism instead of a bespoke dead-end. The default answer is DISPOSE (cancel-to-terminal), not requeue.

### The one subtlety to get right (atomicity)

"write sidecar + set `needsAnswers:true` on `main` + release the lock" MUST be ONE crash-safe transition, or the orphaned-sidecar race reopens (sidecar on `main` but lock still held; or lock released but `needsAnswers` never landed). Reuse the EXISTING `complete` ordering primitive (hold → land durable `main` move → release; `main` record authoritative over a stale lock, `complete-lock-then-durable-main-move-crash-safe`). A crash mid-transition must leave a state that recovery resolves deterministically from `main` (either fully-surfaced-and-released, or not-surfaced-and-lock-cleared-so-the-item-is-re-eligible), never a half-written sidecar with a dangling `needsAnswers`.

## User Stories

1. As a human, I want a bounced/needs-attention item to appear as a `work/questions/` sidecar on `main` with the bounce reason, so I can SEE what the loop parked and why, without inspecting hidden lock refs.
2. As a human, I want to answer that sidecar (requeue / reset-and-retry / drop / hold) and have the loop APPLY my answer on its own time, so a parked item is drained by the same human-is-the-clock mechanism as every other question.
3. As the runner, I want a bounce to RELEASE the lock (not leave it `stuck`), so no item ever rots behind a held lock that nothing re-surfaces.
4. As the runner, I want "surface the sidecar + set `needsAnswers` on `main` + release the lock" to be ONE crash-safe transition, so a crash never leaves an orphaned sidecar or a dangling `needsAnswers`.
5. As a maintainer, I want the `stuck` lock state RETIRED (`LockState` = active-hold only), so there is exactly ONE parked-item mechanism (`needsAnswers` + sidecar on `main`), not two.
6. As the runner, I want a live claim/build/advance to still hold an `active` per-item lock (real CAS mutual-exclusion), so retiring `stuck` does NOT weaken in-flight concurrency safety or push status back onto a retrying `main`-CAS.
7. As a human, I want an "empty diff / nothing to do" bounce to surface a DISPOSE-defaulted (cancel-to-terminal) question (not a blind requeue), so a non-deterministic "nothing to do" verdict can never infinite-loop and I keep the context.
8. As an adopter reading a CI lifecycle run, I want a healthy refusal (stale premise / empty diff / surfaced collision) to be VISIBLY DISTINCT from a real gate failure, so the run is legible instead of a wall of red — because a refusal is now a surfaced question (a known, drained state), not a raw exit-1.
9. As the runner, I want the apply rung to dispatch the EXISTING `requeue`/`drop` verbs from the answered sidecar, so no new apply/disposition machinery is invented.
10. As a maintainer, I want recovery to treat `main` as authoritative for a crash-orphaned `active` lock (the only lock that can now outlive a leg), so crash-safety is simpler than the old stuck-vs-active recovery fork.

> Tasked 2026-07-13. The implementation/testing detail and the six resolved decisions moved into the tasks under `work/tasks/` (all `spec: surface-stuck-as-questions-and-retire-stuck-lock-state`): `apply-disposition-delete-to-dispose-regime-polymorphic`, `bounce-surfaces-stuck-sidecar-and-releases-lock` (keystone — folds in the exit-code decision), `empty-diff-bounce-surfaces-dispose-defaulted-question`, `apply-resolve-reset-flag-discards-work-branch`, `retire-stuck-lock-state` (the contract step), `migrate-existing-stuck-locks-one-shot`, and `reconcile-ledger-lock-spec-adr-stuck-retirement`. Durable rationale lands as ADRs during build (the lock state-machine change + the `delete`→`dispose` decision meet the ADR gate). This spec keeps only its durable framing.

## Out of Scope

- **The merge-questions surface** (unmerged branches → apply LANDS). It shares the shape but is GATED on an apply-primitive extension (`sidecar-apply` currently REQUIRES an on-`main` body path; an unmerged branch may have none). Sequence it AFTER this. Named here only as the fourth case of the generalization.
- **The `triage` and `surface` rungs themselves** (already exist). This spec adds the `needs-attention`(bounce) case to the same family; it does not rebuild the others.
- **Removing the lock primitive entirely.** Explicitly NOT done — `active` stays as the in-flight CAS. Only the `stuck` STATE is retired.
- **Changing what the `requeue`/`drop` CLI verbs DO.** Their standalone behaviour is unchanged. This spec WIRES the apply rung to reach continue (via `resolve`), reset (via `resolve` + `resolveReset`, decision #6), and cancel (via a `tasks/cancelled/` `git mv`, decision #5), but does not alter the human-invoked verbs themselves.
- **The CI leg exit-code policy in isolation.** Subsumed: a bounced leg is now a surfaced-question outcome; any exit-code refinement rides that, not a standalone A/B/C decision on the raw `agent-stopped`.

## Further Notes

- **Provenance / prior art:** the retired brief `advance-surfaces-and-self-clears-stuck-locks-via-questions` (content preserved in `work/tasks/done/extend-surface-state-as-questions-brief-and-fix-dangling-idea-path.md`) is the origin design; the `cutover-needs-attention-becomes-lock-stuck-recovery-surface` task did the folder→lock cutover this builds ON; `LockEntry.questions` (`item-lock.ts`) was added FOR this. Observations: `agent-stopped-healthy-refusal-reds-the-ci-matrix-...-2026-07-12` (superseded A/B/C), and the discharged `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21`.
- **Prior-art files to read at slicing time** (`packages/dorfl/src/`): `item-lock.ts` (the `LockState`/`LockEntry` state machine to amend), `ledger-write.ts` (`bounceToStuckLock`/`applyNeedsAttentionTransition` — the bounce seam to re-point), `needs-attention.ts` (the bounce prose/commit), `surface-persist.ts` (`persistSurfacedQuestions` — the atomic sidecar primitive to reuse), `sidecar.ts` (`sidecarPathFor` keying), `advance.ts` (surface/apply rungs), `start.ts` (`--resume`/`resolved` recovery reading `stuck`), `format.ts` (status render of `stuck`). Reconcile the SPEC/ADR `ledger-status-per-item-lock-refs` (defines `active|stuck`).
- **Why this composes cleanly (corrected after a code review):** the stuck-clear apply is a tree-less TRANSITION on state the loop already understands (`needsAnswers` + answered sidecar), not a fresh `acquire`; the surface-on-bounce reuses the surface rung's exact atomic commit; CONTINUE reuses the existing `resolve` outcome. The genuinely new logic is (a) re-pointing the bounce seam, (b) the empty-diff dispose-default classification, (c) the RESET flag on `resolve` (resolved #6), and (d) the `delete`→`dispose` rename making disposal regime-polymorphic so a task goes to `tasks/cancelled/` (resolved #5). An earlier draft claimed "no new apply logic / reuses requeue+drop"; a review against `apply-decide.ts`/`decision-engine.ts` (outcomes `{task|spec|adr|delete|resolve|ask}`) showed CONTINUE is covered by `resolve`, RESET needs the flag, and `delete` needed to become the polymorphic `dispose` — hence the correction, now resolved in #5/#6.

## Resolved decisions (answered with the maintainer 2026-07-13)

Six forks, all answered before tasking. Terse record below; the FULL reasoning + build detail live in the owning tasks (and land as ADRs during build). Do not relitigate.

1. **A cleanly-surfaced bounce is GREEN (`exitCode: 0`)** — like `already-triaged`/`vanished`; the sidecar on `main` is the "a human owes an answer" signal, red is for a bad tree. Green IFF the surface transition succeeded (a failed surface stays non-zero). Owned by `bounce-surfaces-stuck-sidecar-and-releases-lock`.
2. **Engine owns the envelope + safe default; the LLM owns the prose.** needs-attention surfaces the agent's questions as-is; empty-diff adds an engine-guaranteed dispose-defaulted (cancel-to-terminal) disposition question. Owned by `empty-diff-bounce-surfaces-dispose-defaulted-question`.
3. **Migrate existing stuck locks one-shot** (`stuck → surface-on-main + release`), not forward-only. Owned by `migrate-existing-stuck-locks-one-shot`.
4. **Crash-recovery = ordered transition + `main`-authoritative** (surface-to-`main` FIRST, release SECOND; recovery reads `main`; reverse order forbidden; retry is for contention, ordering for crashes; reuse `complete`'s rule). Owned by `bounce-surfaces-stuck-sidecar-and-releases-lock`.
5. **Apply disposition `delete`→`dispose`, regime-polymorphic** (observation→`git rm`; task→`git mv tasks/cancelled/` retained; spec→`git mv specs/dropped/`), so a task can never be hard-deleted, only disposed to its terminal. Folder words unchanged; only the token + channel renamed. Owned by `apply-disposition-delete-to-dispose-regime-polymorphic`. (Standalone `drop` verb is separate: `work/notes/observations/drop-and-delete-git-rm-tasks-instead-of-moving-to-cancelled-terminal-2026-07-13.md`.)
6. **RESET rides an optional `resolveReset` flag on the existing `resolve` verdict** (no new outcome), scoped to a task with a pre-existing `work/<slug>` branch and safely ignored otherwise. Owned by `apply-resolve-reset-flag-discards-work-branch`.
