---
title: review-gate non-blocking nits for 'isolated-config-read-main-only-fetch-and-reap-on-failure' (Gate 2 approve)
date: 2026-06-14
status: open
slug: isolated-config-read-main-only-fetch-and-reap-on-failure
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'isolated-config-read-main-only-fetch-and-reap-on-failure' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope decision to apply the loosened (reachableOnly) reap predicate to EVERY non-completed outcome, not only the post-needs-attention-push return. Is this acceptable, or should it be narrowed to the outcomes where work is provably pushed?
  (do.ts ~L1614: `const reachableOnly = result !== undefined && result.outcome !== 'completed'`. The slice scoped the loosening to 'the post-surface failure return where we KNOW the work was just pushed'. The landed code applies it to ALL non-completed outcomes that reach the teardown with a materialised tree (needs-attention, agent-failed, config-error, refused, agent-stopped, etc.). This is SAFE because the reachability half is never dropped: an outcome whose branch is NOT on the arbiter (e.g. refused/agent-stopped before any push) retains the worktree anyway. The early lost/contended/usage-error claim-failure returns happen before `tree` is assigned, so they never reach this. Net effect is broader-but-still-never-loses-work, which arguably better serves the slice's goal (no churn-dirty-but-safe worktree ever lingers). Flagging for the human to ratify the broadening vs. the slice's narrower wording.)
- The agent did not record a ## Decisions block (introducing the `ensureMirrorMain` wrapper rather than the slice's two suggested options; the reachableOnly opt-in flag design; the broadened failure-path scope). Confirm these are ratified when the PR description is authored.
  (The slice offered two options for fix #1 (reuse `resolveRepoConfigFromMirror`, or `fetchMirrorMain` before `readRepoConfigFromMirrorMain`). The agent introduced a third: a new `ensureMirrorMain` ensure-wrapper. This is justified - `resolveRepoConfigFromMirror` takes an already-existing mirrorPath and does NOT ensure/clone, so it could not be a drop-in for the build path which must create-if-absent + refresh; `ensureMirrorMain` returns the `EnsureMirrorResult` shape `resolveRemoteRepoConfig` consumes and reuses `fetchMirrorMain`. Sound choice, but unrecorded. The work is currently uncommitted (only the claim commit exists), so there is no PR body yet; this is a reminder to capture the decisions there, not a defect.)
