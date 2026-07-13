---
title: Surface every "needs a human" bounce as a question sidecar on main, and retire the `stuck` lock state
slug: surface-stuck-as-questions-and-retire-stuck-lock-state
humanOnly: true
needsAnswers: true
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

- **The EXISTING apply rung drains it.** No new apply logic. The apply rung already consumes a `needsAnswers:true` item with an answered sidecar and dispatches a disposition. A bounced item's sidecar question is of the shape *"`<slug>` is stuck: `<reason>`. requeue? reset-and-retry? drop? hold?"*, and the human's answer dispatches the EXISTING `requeue` verb (default = continue-from-wip; `--reset` = discard wip + rebuild clean) or `drop`. This is the four-case generalization the retired brief captured: `needs-attention`(bounce)→requeue, `merge-questions`→land, `triage`→promote/drop, `surface`→edit-body all share ONE shape (surface a decision → human answers → apply dispatches the action).

- **RETIRE `state: stuck`.** `LockState` collapses from `'active' | 'stuck'` to just the active hold. "Resting, needs a human" is expressed on `main` (`needsAnswers:true` + sidecar), NOT on a lock. The lock is held ONLY during live claim/build/advance work (real CAS mutual-exclusion) and is always released at the end of a leg — success (durable `main` move) OR bounce (surface + `needsAnswers`). No lock ever outlives its leg except a genuine crash-orphan (which recovery clears by treating `main` as authoritative), so the whole "stuck lock rots forever / must be hand-requeued" class disappears.

### Why the lock CAN'T be removed entirely (the boundary, decided with the maintainer)

The `stuck` STATE goes; the lock PRIMITIVE stays. `needsAnswers:true` on `main` replaces the RESTING-exclusion job of the stuck lock (a parked item is naturally out of the eligible pool), but it does NOT replace the IN-FLIGHT mutual-exclusion job: setting `needsAnswers` is a CAS write to the SHARED `main` ref, which is the retrying/serialised path the per-item lock exists to AVOID (`ledger-status-per-item-lock-refs` P-opt-1: a per-item ref push is self-arbitrating, no retry loop, no false contention). So a live claim/build/advance still holds an `active` per-item lock. The net change is only that a leg NEVER leaves a `stuck` lock behind — it always ends by releasing, having first surfaced the item on `main` if it bounced.

### The empty-diff / "nothing to do" case (a refinement over the retired brief)

A bounce reason of "empty diff / produced no change" is a NON-DETERMINISTIC LLM judgement, not ground truth, so a blind requeue would INFINITE-LOOP (the next leg re-runs, re-judges "nothing to do", re-bounces). This case must ALSO surface a sidecar, but with a DELETE-defaulted question — *"`<slug>`: the agent produced no change (`<reason>`). Delete this item? [default: yes]"* with `needsAnswers:true`. This (a) breaks the requeue loop, (b) preserves the context (why the agent saw nothing to do), (c) gives the human a one-glance confirm/override, and (d) unifies "nothing to do" into the same sidecar mechanism instead of a bespoke dead-end. The default answer is DELETE, not requeue.

### The one subtlety to get right (atomicity)

"write sidecar + set `needsAnswers:true` on `main` + release the lock" MUST be ONE crash-safe transition, or the orphaned-sidecar race reopens (sidecar on `main` but lock still held; or lock released but `needsAnswers` never landed). Reuse the EXISTING `complete` ordering primitive (hold → land durable `main` move → release; `main` record authoritative over a stale lock, `complete-lock-then-durable-main-move-crash-safe`). A crash mid-transition must leave a state that recovery resolves deterministically from `main` (either fully-surfaced-and-released, or not-surfaced-and-lock-cleared-so-the-item-is-re-eligible), never a half-written sidecar with a dangling `needsAnswers`.

## User Stories

1. As a human, I want a bounced/needs-attention item to appear as a `work/questions/` sidecar on `main` with the bounce reason, so I can SEE what the loop parked and why, without inspecting hidden lock refs.
2. As a human, I want to answer that sidecar (requeue / reset-and-retry / drop / hold) and have the loop APPLY my answer on its own time, so a parked item is drained by the same human-is-the-clock mechanism as every other question.
3. As the runner, I want a bounce to RELEASE the lock (not leave it `stuck`), so no item ever rots behind a held lock that nothing re-surfaces.
4. As the runner, I want "surface the sidecar + set `needsAnswers` on `main` + release the lock" to be ONE crash-safe transition, so a crash never leaves an orphaned sidecar or a dangling `needsAnswers`.
5. As a maintainer, I want the `stuck` lock state RETIRED (`LockState` = active-hold only), so there is exactly ONE parked-item mechanism (`needsAnswers` + sidecar on `main`), not two.
6. As the runner, I want a live claim/build/advance to still hold an `active` per-item lock (real CAS mutual-exclusion), so retiring `stuck` does NOT weaken in-flight concurrency safety or push status back onto a retrying `main`-CAS.
7. As a human, I want an "empty diff / nothing to do" bounce to surface a DELETE-defaulted question (not a blind requeue), so a non-deterministic "nothing to do" verdict can never infinite-loop and I keep the context.
8. As an adopter reading a CI lifecycle run, I want a healthy refusal (stale premise / empty diff / surfaced collision) to be VISIBLY DISTINCT from a real gate failure, so the run is legible instead of a wall of red — because a refusal is now a surfaced question (a known, drained state), not a raw exit-1.
9. As the runner, I want the apply rung to dispatch the EXISTING `requeue`/`drop` verbs from the answered sidecar, so no new apply/disposition machinery is invented.
10. As a maintainer, I want recovery to treat `main` as authoritative for a crash-orphaned `active` lock (the only lock that can now outlive a leg), so crash-safety is simpler than the old stuck-vs-active recovery fork.

## Implementation Decisions

(Made with the maintainer. Do not relitigate.)

- **Keep `active`, drop `stuck` (the load-bearing boundary).** The lock is the in-flight CAS primitive and stays; the `stuck` durable resting state is retired and replaced by `needsAnswers:true` + sidecar on `main`. Confirmed with the maintainer.
- **Reuse the existing primitives, don't invent.** Sidecar write = the surface rung's atomic `persistSurfacedQuestions` (append-or-create sidecar + set `needsAnswers` in one commit, keyed on `<type>-<slug>` identity via `sidecarPathFor`, NOT folder path). Apply = the existing apply rung + `requeue`/`drop` verbs. Crash-safe ordering = `complete`'s hold→land→release primitive.
- **A bounce becomes a SURFACE outcome.** The paths that today call `markStuckItemLock`/`bounceToStuckLock` (agent-stopped, gate-failed on rebased tip, rebase-conflict, tasking-lock failures) instead route through the surface-and-release transition. The bounce REASON is recorded verbatim as the sidecar question's context, exactly as it is on the lock today.
- **Empty-diff → delete-defaulted question.** Distinguished from a requeue-defaulted bounce; the disposition default is `drop`, not `requeue`.
- **`agent-stopped` stops being a raw exit-1 dead-end.** Once it surfaces a sidecar, its CI-legibility problem (the superseded observation's A/B/C) dissolves: it is a surfaced question, a known state, not an ambiguous red. Whether the leg's PROCESS exit code changes is a downstream detail for `to-task` (a surfaced-question leg is arguably a benign `exitCode: 0` like `already-triaged`/`vanished`, since the item is now cleanly parked on `main`).
- **Not a protocol-doc change by itself.** This is engine behaviour (`item-lock.ts`, `ledger-write.ts`, `needs-attention.ts`, `advance.ts`, `start.ts`, `format.ts`, `sidecar.ts`) + possibly the CI workflow's leg-outcome reporting. It does touch the ledger/lock SPEC family, so it must reconcile with `ledger-status-per-item-lock-refs` (which DEFINES the two-axis `active|stuck` lock) — that spec's `state` axis is amended here, so this spec supersedes its `stuck` half and the ADR must be updated.

## Testing Decisions

- **The bounce→surface transition is the seam:** inject a canned bounce (reason + questions) and assert it writes the sidecar + sets `needsAnswers:true` + releases the lock, in one commit, keyed correctly. Assert NO `stuck` lock remains.
- **Atomicity/crash-safety is a test:** simulate a crash between the sidecar write and the lock release (and vice versa) and assert recovery resolves deterministically from `main` — never a dangling `needsAnswers` with no sidecar, never a held lock with a surfaced item.
- **Empty-diff path:** assert an empty-diff bounce surfaces a DELETE-defaulted question (disposition default `drop`), and that a requeue of it does NOT infinite-loop (a second no-change leg re-surfaces the same delete question rather than re-queuing blindly).
- **Apply drains it:** an answered "requeue" sidecar dispatches the existing `requeue` verb (continue-from-wip; `--reset` discards); an answered "drop" dispatches `drop`. No new disposition tokens.
- **`stuck` retirement is a behavioural test:** the `LockState` union no longer admits `stuck`; the recovery verbs (`start --resume`, `requeue`, `gc --ledger`) operate on `active`-hold + `main`-`needsAnswers` only; `dorfl status`/`scan` render a parked item from its `main` `needsAnswers` state, not a stuck lock.
- Reuse the existing lock/sidecar test styles (`item-lock.test.ts`, `sidecar.test.ts`, `advance-triage.test.ts`, the `gitRepo` fixtures with the new `rmrf` teardown).

## Out of Scope

- **The merge-questions surface** (unmerged branches → apply LANDS). It shares the shape but is GATED on an apply-primitive extension (`sidecar-apply` currently REQUIRES an on-`main` body path; an unmerged branch may have none). Sequence it AFTER this. Named here only as the fourth case of the generalization.
- **The `triage` and `surface` rungs themselves** (already exist). This spec adds the `needs-attention`(bounce) case to the same family; it does not rebuild the others.
- **Removing the lock primitive entirely.** Explicitly NOT done — `active` stays as the in-flight CAS. Only the `stuck` STATE is retired.
- **Changing what `requeue`/`drop` DO.** This spec DISPATCHES them from an answered sidecar; their behaviour is unchanged.
- **The CI leg exit-code policy in isolation.** Subsumed: a bounced leg is now a surfaced-question outcome; any exit-code refinement rides that, not a standalone A/B/C decision on the raw `agent-stopped`.

## Further Notes

- **Provenance / prior art:** the retired brief `advance-surfaces-and-self-clears-stuck-locks-via-questions` (content preserved in `work/tasks/done/extend-surface-state-as-questions-brief-and-fix-dangling-idea-path.md`) is the origin design; the `cutover-needs-attention-becomes-lock-stuck-recovery-surface` task did the folder→lock cutover this builds ON; `LockEntry.questions` (`item-lock.ts`) was added FOR this. Observations: `agent-stopped-healthy-refusal-reds-the-ci-matrix-...-2026-07-12` (superseded A/B/C), and the discharged `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21`.
- **Prior-art files to read at slicing time** (`packages/dorfl/src/`): `item-lock.ts` (the `LockState`/`LockEntry` state machine to amend), `ledger-write.ts` (`bounceToStuckLock`/`applyNeedsAttentionTransition` — the bounce seam to re-point), `needs-attention.ts` (the bounce prose/commit), `surface-persist.ts` (`persistSurfacedQuestions` — the atomic sidecar primitive to reuse), `sidecar.ts` (`sidecarPathFor` keying), `advance.ts` (surface/apply rungs), `start.ts` (`--resume`/`resolved` recovery reading `stuck`), `format.ts` (status render of `stuck`). Reconcile the SPEC/ADR `ledger-status-per-item-lock-refs` (defines `active|stuck`).
- **Why this composes cleanly:** the stuck-clear apply is a tree-less TRANSITION on state the loop already understands (`needsAnswers` + answered sidecar), not a fresh `acquire`; the surface-on-bounce reuses the surface rung's exact atomic commit; the disposition reuses `requeue`/`drop`. The only genuinely new logic is (a) re-pointing the bounce seam and (b) the empty-diff delete-default classification.

## Open questions (why `needsAnswers: true`)

These are genuine forks that would cut the wrong slices if guessed:

1. **Does a bounced leg's PROCESS exit code change?** Once the item is cleanly surfaced on `main`, is the leg a benign `exitCode: 0` (like `already-triaged`/`vanished`, "parked cleanly, matrix tolerates it") or does it stay non-zero so the run still flags "a human owes an answer"? (This is the superseded A/B/C, re-asked in the new frame.)
2. **Sidecar question shape + disposition vocabulary.** Confirm the exact question wording and the answer→verb mapping (requeue / reset / drop / hold), and whether "hold" is a distinct disposition or just "leave `needsAnswers:true`".
3. **Migration of EXISTING stuck locks.** On rollout, are there live `stuck` locks to convert (a one-shot `stuck → surface-on-main + release` migration), or is retirement forward-only (new bounces surface; old stuck locks handled by a documented `requeue`)?
4. **Recovery semantics for a crash-orphaned `active` lock after this change.** Confirm the deterministic `main`-authoritative resolution (re-eligible vs re-surface) for every crash point in the new one-transition bounce.
