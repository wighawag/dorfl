---
title: review-gate non-blocking nits for 'gate-on-rebased-tip-fresh-worktree' (Gate 2 approve)
date: 2026-06-14
status: open
slug: gate-on-rebased-tip-fresh-worktree
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'gate-on-rebased-tip-fresh-worktree' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the throwaway gate worktree is created under the OS temp dir (mkdtempSync in os.tmpdir(), prefix 'agent-runner-fresh-gate-'), NOT under a repo-local workspaces dir. Is the OS temp area the intended home for the transient gate sandbox?
  (integration-core.ts runFreshWorktreeGate: `const gateDir = mkdtempSync(join(tmpdir(), 'agent-runner-fresh-gate-'))`. The slice required only that it be reaped and never leak (both tested) and cross-referenced gc.ts hygiene; it did not specify the location. Putting it OUTSIDE any tracked tree is a sound hygiene choice (it can never be swept into a commit), but it means the gate sandbox does not live alongside other agent-runner workspaces and is not visible to a `workspacesDir`-scoped cleanup - it relies solely on the inline finally-reap (plus `git worktree prune`). A reasonable default worth a maintainer nod.)
- Ratify: the committed-recovery path (`complete --isolated` / finish-already-committed-branch, committedRecovery=true) returns via recoverAlreadyCommitted BEFORE any fresh-gate logic, so it rebases and integrates the stranded commit WITHOUT a rebased-tip re-gate even when freshWorktreeGate is ON. Is skipping the fresh gate on the committed-recovery path the intended behaviour?
  (performIntegration short-circuits to recoverAlreadyCommitted at the top when committedRecovery is set, and that helper has no fresh-gate step. This is internally consistent with that path's contract (the work was already gated, committed, and done-moved before stranding; no rebuild, no re-gate), and the slice's enumerated single-job paths were do/--isolated/--remote/complete in their NORMAL build sense. But it is a quiet carve-out: a branch that integrates via the recovery path is gated on its pre-stranding tree, not the rebased tip it actually lands on. Likely fine (recovery is rare and the original gate was sound), but it is an unstated interaction worth ratifying.)
- Ratify: with the fresh gate ON and review ON, the per-run review-nits observation is folded into the existing done-commit via `git commit --amend --no-edit` (rather than riding an upcoming commit as on the OFF path). Is amending the already-created done-commit on the ON path the intended way to keep the nits in the same done-commit?
  (On the ON path the done-move + atomic commit happen at steps 2-3, BEFORE the rebased-tip review at step 4c, so there is no later commit for the nits write to ride; the code writes the observation into cwd and, only when it produced a NEW staged capture-note (nitsAfter.length > nitsBefore.length), runs `commit --amend --no-edit`. This preserves the no-separate-commit/no-extra-surface model and is guarded to avoid an empty amend, but rewriting the committed tip just before integrate is a non-obvious mechanism the slice did not spell out. It is correct and bounded; flagging for a maintainer nod.)
- Doc completeness (not a defect): the ADR section 8 note describes the fresh-gate-ON band order but does not restate that a rebase CONFLICT short-circuits before the gate (no gate on an un-integratable tree), which the slice's item 1 asked to be documented in a Decisions block. Worth a one-line addition to the ADR/band-doc?
  (The rebase-conflict-still-routes-to-rebase-conflict behaviour IS implemented (rebaseConflictRoute fires before step 4c) and tested (a rebase conflict routes to rebase-conflict and creates no gate sandbox). The code comments at step 4c state it. The ADR note added by this slice covers the ON-path order and the verify-then-review relocation but omits the explicit 'the gate does not run on an un-integratable tree' sentence the slice's item 1 requested. Pure doc polish; the behaviour is correct and covered.)
