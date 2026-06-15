---
title: the ONBOARD continue-rebase (rebaseContinuedBranchOntoMain) must drop the kept branch's own stale bookkeeping move-only commits — the same drop-mechanism the integration rebase ALREADY uses — so a single agent never self-conflicts and surfaces to a human
slug: continue-rebase-auto-resolves-protocol-bookkeeping-conflicts
blockedBy: []
covers: []
---

## What to build

### The principle (the human's framing — this is the acceptance bar)

**A single agent working SEQUENTIALLY on its own slice must NEVER hit a rebase/conflict that requires a human to resolve, when the only thing diverging is agent-runner's OWN bookkeeping of that same slug.** A self-conflict (the agent's own earlier move-only commit colliding with the runner's own later tree-less move of the same `.md`) is a DESIGN DEFECT, not a legitimate human-surface. Genuine CODE conflicts (two real lines of development) still surface — those are real. The whole job of this slice is to close every self-conflict path so the ONLY rebase conflicts that ever reach a human are genuine content conflicts.

### VERIFIED against the code — the EXACT gap (do not re-derive; confirm against `src/`)

The codebase ALREADY reconciles self-conflicts at the INTEGRATION rebase (the after-build done-move rebase in `integration-core.ts`), via THREE mechanisms:

1. **`rebaseDroppingNeedsAttentionSurface`** (`integration-core.ts` ~L1822) — on the `recovering` path it rebases `-i --onto <arbiter>/main` with a `GIT_SEQUENCE_EDITOR` that DROPS the kept branch's `chore(<slug>): route to needs-attention` move-only commit, so it cannot conflict with the surfaced main. Docstring: "the human never sees a conflict."
2. **`reconcileSiblingLedgerConflict`** — when the conflict is ONLY other slugs' ledger files, abort + redo our work cleanly on top (take the arbiter's sibling ledger).
3. **`reconcileDivergentDoneMove`** (PR #86) — when the arbiter holds the slug's source in a different folder than our done-move removed, redo the done-move arbiter-resolved.

So the integration rebase is ROBUST against self-conflict. **The gap is that the ONBOARD continue-rebase is NOT.** `rebaseContinuedBranchOntoMain` (`continue-branch.ts` ~L99) is a BARE rebase:

```
const rebase = gitSoft(['rebase', mainRef], cwd, env);
if (rebase.status === 0) return {kind: 'clean'};
gitSoft(['rebase', '--abort'], cwd, env);   // any conflict → abort
return {kind: 'conflict'};                   // → routes to needs-attention (human)
```

It has ZERO reconciliation. It is called at ONBOARD time (re-`do` of a kept branch) from `isolation.ts` (~L297, the `--isolated` path), `start.ts` (~L623), and `workspace.ts` (~L285).

THE LIVE FAILURE traced exactly here: the requeued kept branch carried `chore(<slug>): route to needs-attention; acceptance gate failed …` (commit `61ea593`) and `chore(<slug>): route to needs-attention; continuing the kept … rebase … conflicted …` (`9e9847c`). On re-`do`, `rebaseContinuedBranchOntoMain` did a bare rebase of those move-only commits onto a main that `requeue` had tree-lessly moved to `backlog/` → rename conflict → abort → needs-attention → recurred every retry. The agent CONFLICTED WITH ITS OWN SEQUENTIAL WORK. **Both conflicting commits carry the SAME `chore(<slug>): route to needs-attention` subject the integration rebase's drop-mechanism already matches** — so the existing fix would have cleanly handled it IF it ran at this site. It doesn't.

### The fix

Make `rebaseContinuedBranchOntoMain` drop the kept branch's stale bookkeeping move-only commits before/while rebasing onto main, REUSING the existing drop-mechanism (`rebaseDroppingNeedsAttentionSurface` / its `GIT_SEQUENCE_EDITOR` `sed` builder), anchored to the slug. The continued branch is being CONTINUED precisely because the runner surfaced/requeued it; its `chore(<slug>): route to needs-attention; …` commits are STALE bookkeeping (main's tree-less moves are the truth for placement) and must be dropped on replay, leaving only the agent's real code (wip + any `→done`). After the drop the rebase replays cleanly onto main.

Concretely:

- Factor the existing slug-anchored `route-to-needs-attention` drop (the `GIT_SEQUENCE_EDITOR` sed builder + the `rebase -i --onto <arbiter>/main <base>` form) into a shared helper, and call it from `rebaseContinuedBranchOntoMain` (it currently lives only in the integration path). The continue-rebase needs the slug, which its callers have.
- Drop ONLY the runner-authored `chore(<slug>): route to needs-attention` move-only commits (anchored to THIS slug by subject, exactly as the existing matcher does). NEVER drop a commit that touches a code/content file — the matcher is subject-anchored and the move-only commits touch only `work/<slug>.md`, so this stays safe.
- After dropping, replay onto `<arbiter>/main`. A CLEAN replay → `{kind:'clean'}`. A conflict that REMAINS after the drop (i.e. a genuine CODE conflict, or this slug's own real content) → `--abort` + `{kind:'conflict'}` → needs-attention, EXACTLY as today (ADR §10 preserved for genuine conflicts).

### THE ATOMICITY INVARIANT (constrains the fix; must not be violated)

**`arbiter/main` must NEVER show a COMPLETED-state lifecycle file without the artifacts it asserts, atomically:**

- `work/done/<slug>.md` never on `main` without the slug's CODE (slice done-move).
- `work/prd-sliced/<slug>.md` never on `main` without its emitted `work/backlog/*.md` slices (PRD slicing move).

These completed-state moves stay on the work branch and land atomically via the merge/integrate — they are NOT bookkeeping and are NEVER dropped. The drop-mechanism this slice generalises targets ONLY the `route to needs-attention` BOOKKEEPING move-only commits, never the done-move / slicing move. (The integration rebase already respects this: `recovering && !lifecycle` gates the drop; the continue-rebase fix must likewise drop only bookkeeping move-only commits, never a completed-state move.)

### Why this is the RIGHT shape (not reinventing)

The integration rebase already encodes the correct philosophy: a stale bookkeeping move-only commit is DROPPED on replay, not "auto-resolved by picking a folder." This slice simply applies that SAME, already-proven mechanism at the second rebase site (onboard continue) that was left as a bare rebase. It is a small, surgical convergence — one drop-helper, two call sites — not a new conflict-resolution engine.

## Acceptance criteria

- [ ] **The live self-conflict no longer surfaces:** a kept branch carrying `chore(<slug>): route to needs-attention; …` move-only commit(s), re-`do`'d after the runner tree-lessly moved the same `.md` on main (surface/requeue), rebases CLEAN at onboard (the stale move-only commits are dropped) and the agent continues — it does NOT route to needs-attention. A regression test reproduces the exact live trace (`feat+done-move` → `done→needs-attention` on the branch; main `surface→backlog→claim`) and asserts clean continue + the code diff preserved.
- [ ] The drop is SLUG-ANCHORED to the runner's `chore(<slug>): route to needs-attention` move-only commits ONLY (reusing the existing subject matcher); a commit touching ANY code/content file is NEVER dropped. A test asserts an unrelated/code commit is preserved.
- [ ] **A GENUINE code conflict still surfaces:** if, AFTER dropping the bookkeeping move-only commits, the replay still conflicts (real source/content), `rebaseContinuedBranchOntoMain` aborts and returns `{kind:'conflict'}` → needs-attention, EXACTLY as today. A test pins this (ADR §10 preserved for real conflicts).
- [ ] **Atomicity invariant preserved:** the drop NEVER removes a completed-state move (`→done` / `slicing→prd-sliced`); `done/`/`prd-sliced/` only ever reach main via the branch's atomic integration. A test asserts a kept branch with a `→done` move still lands `done/` WITH its code (the done-move is not dropped).
- [ ] The drop-mechanism is FACTORED so the integration rebase (`rebaseDroppingNeedsAttentionSurface`) and the onboard continue-rebase share ONE implementation (no second, divergent copy of the sed/`GIT_SEQUENCE_EDITOR` logic). (Review lens 4: one concept, one home.)
- [ ] All three onboard call sites (`isolation.ts`, `start.ts`, `workspace.ts`) get the reconciling behaviour (they all call `rebaseContinuedBranchOntoMain`), so `--isolated do`, `start`, and the workspace path are all self-conflict-free.
- [ ] **The second gap is closed too (the `recovering=false` interaction):** at INTEGRATION time, `complete.ts` sets `recovering = (localSource === 'needs-attention')`, but a CONTINUED slice is claimed into `in-progress/` (so `recovering=false`) — meaning the integration drop-mechanism (`rebaseDroppingNeedsAttentionSurface`, gated `recovering && !lifecycle`) does NOT fire for a continued slice either. Because this slice drops the stale bookkeeping commits at the ONBOARD rebase (before the agent runs), the kept branch reaching integration NO LONGER carries them, so the plain integration rebase is clean. A test asserts a continued slice reaches integration with NO stale `route to needs-attention` commit on its branch (the onboard drop already removed it), so the `recovering=false` plain rebase does not conflict.
- [ ] **Post-drop force-push is safe:** dropping commits rewrites the continued branch, which is then re-pushed with `--force-with-lease` on the WORK branch ONLY (an unshared, requeued branch — never `main`, never bare `--force`, §11). A test confirms the rewritten branch publishes via the existing stale-lease-retry push without surfacing.
- [ ] **VERIFIED-BY-REPRODUCTION baseline (the implementer must keep this green):** the live conflict was empirically reproduced in a throwaway repo — rebasing the kept tip onto the contemporary main fails as a CONTENT conflict in the BODY of `work/needs-attention/<slug>.md` (the branch's reason text vs main's reason text diverge), NOT merely a rename conflict; and dropping the two `chore(<slug>): route to needs-attention` commits via the existing `GIT_SEQUENCE_EDITOR` sed makes the rebase succeed CLEAN, lands the slug in `work/done/`, and preserves the code edit. The regression test MUST encode this exact shape (content-conflict-in-reason-body → drop → clean → done/ + code), not a synthetic rename-only case.
- [ ] **Post-drop SOURCE-FOLDER resolution at integration (the un-traced interaction — must be handled, not assumed):** after the onboard drop+rebase, the continued branch already has the slug in `work/done/` (the kept `→done` move survived the drop). The agent then re-runs with continue-context, and `performComplete`/`integration-core` resolve the done-move SOURCE from the local folder (`complete.ts` ~L454: `in-progress` else `needs-attention`) — neither of which matches a branch already in `done/`. The implementer MUST trace and TEST this end-to-end: a dropped-then-rebuilt continued slice must integrate correctly (the `resolveSlice` stranded-`done` gate + the divergent-done-move reconciler `reconcileDivergentDoneMove` are the relevant existing seams). A test drives drop → agent re-run (stub) → complete and asserts the slug lands `done/` with BOTH the prior and the new code, and NO second/duplicate done-move commit and NO conflict. If this interaction proves to need its own change, that is IN SCOPE for this slice (the fix is not done until a continued slice integrates cleanly after the drop).
- [ ] **Interleaved-commit branches (not just the simple live shape):** the drop must be correct when the kept branch interleaves real work with bookkeeping (e.g. `wip → route-NA → wip → route-NA → done-move`), not only the simple `feat+done → route-NA → route-NA` live case. A test builds an interleaved branch and asserts ONLY the `route to needs-attention` move-only commits are dropped, every wip/feat/done commit replays in order, and the result is clean with all code preserved.
- [ ] **All FOUR call sites covered (incl. the internal one):** besides `isolation.ts`/`start.ts`/`workspace.ts`, `rebaseContinuedBranchOntoMain` is ALSO called inside `pushContinuedBranchWithStaleLeaseRetry`'s stale-lease retry loop (`continue-branch.ts`), so fixing the function itself covers the stale-lease re-rebase path for free. A test confirms a stale-lease retry that re-rebases also drops stale bookkeeping commits (does not surface).
- [ ] ADR §10 / `WORK-CONTRACT.md` (+ the `continue-branch.ts` docblock) updated: the continue-rebase drops stale runner-authored bookkeeping move-only commits (a self-conflict is not a human-decision conflict); genuine content conflicts still abort. Edit the SOURCE (`skills/setup/protocol/`) and mirror into `work/protocol/`.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None.

## Prompt

> FIRST, drift-check against current `src/` (this slice rests on a precise code claim that may have changed): confirm (a) `integration-core.ts` STILL has `rebaseDroppingNeedsAttentionSurface` (~L1822) dropping the `chore(<slug>): route to needs-attention` move-only commit on the `recovering` path, and (b) `continue-branch.ts`'s `rebaseContinuedBranchOntoMain` (~L99) is STILL a BARE `git rebase` → abort-on-conflict with NO drop, called from `isolation.ts`/`start.ts`/`workspace.ts`. If the onboard continue-rebase ALREADY drops stale bookkeeping commits, this slice is moot — route to needs-attention noting that. See `work/observations/rebase-conflict-on-continue-needs-nondestructive-recovery-not-reset.md` + `…requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md` for the live trace.
>
> GOAL: close the self-conflict gap. A single agent re-`do`'ing its OWN kept branch must never hit a human-surfacing rebase conflict caused purely by the runner's own stale bookkeeping move-only commits. Generalise the EXISTING, proven drop-mechanism (the `GIT_SEQUENCE_EDITOR` sed that strips `chore(<slug>): route to needs-attention` commits) from the integration rebase to the onboard continue-rebase — do NOT invent a new conflict-resolution engine; factor the one that exists and call it at both sites.
>
> HARD INVARIANT (do not violate): the drop targets ONLY runner-authored `route to needs-attention` BOOKKEEPING move-only commits, anchored to the slug. NEVER drop a completed-state move (`→done` / `slicing→prd-sliced`) — those stay on the branch and land atomically with their artifacts (code / emitted backlog slices). `arbiter/main` must never show `done/`/`prd-sliced/` without the artifacts they assert. A genuine code conflict (still present after the drop) still aborts → needs-attention.
>
> SEAMS TO TEST AT: `rebaseContinuedBranchOntoMain` (the onboard site) — feed it a kept branch with stale `route to needs-attention` move-only commits + a main moved tree-lessly, assert CLEAN continue + code preserved; feed it a real code conflict (after drop) and assert it still aborts → `conflict`; feed it a `→done` move and assert the done-move is NOT dropped. No network; throwaway git repos as the existing continue-branch / integration-core tests do.
>
> DONE: the live self-conflict regression-tests green, genuine conflicts still surface, the done-move/slicing move is never dropped, the drop-helper is shared (one home), all three call sites reconcile, ADR/contract updated at SOURCE + mirrored, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

## Needs attention

agent failed: 401 Unauthorized

## Needs attention

acceptance gate failed (exit 1) on the rebased tip
