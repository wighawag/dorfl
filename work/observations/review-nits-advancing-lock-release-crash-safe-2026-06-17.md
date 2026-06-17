---
title: review-gate non-blocking nits for 'advancing-lock-release-crash-safe' (Gate 2 approve)
date: 2026-06-17
status: open
reviewOf: advancing-lock-release-crash-safe
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advancing-lock-release-crash-safe' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the crash-safety pre-step ALWAYS runs `git checkout HEAD -- .` + `git clean -fdq` in the release path (no-op when clean), not just when a failure was detected. On the happy path this is functionally a no-op for tracked files but `git clean -fdq` WILL delete any non-gitignored untracked files left in `cwd` by a successful build. Acceptable for the in-place advance `cwd`, but it's a user-visible default change vs the prior dirty-guard-throw behaviour. Intended?
  (`runRelease` now calls `makeCheckoutAble` unconditionally before `originalRef`. Previously a successful, clean run did neither; previously a dirty run threw. The slice asked for the happy path to be 'unchanged' — observably it still releases, but the worktree side-effects on the happy path differ slightly (untracked files in `cwd` are removed by `git clean -fdq`). `.gitignore` IS respected (no `-x`), so dependency caches etc. survive.)
- Ratify (and record): the slice explicitly required a `## Decisions` entry capturing (a) the REPRODUCED root cause of why the release did not land in the live incident, and (b) the chosen clean-ref-state mechanism (rebase-abort + `checkout HEAD -- .` + `clean -fdq` vs a dedicated clean worktree/ref). Neither the work/done/ slice file nor the commit message records this. The folder-taxonomy follow-up slice will rely on these decisions being discoverable.
  (Acceptance criterion #1: 'the build IDENTIFIES why the release did not land — recorded in `## Decisions`.' The done-folder file is unchanged from the original spec; there is no PR `## Decisions` block. The chosen mechanism IS documented in a code comment on `makeCheckoutAble`, which mitigates the audit gap but does not satisfy the requested decision-record location.)
- Ratify: the recover-path repro test simulates `recoverAlreadyCommitted` with a hand-written `RungExecutor.buildSlice` rather than wiring the real `performComplete` recover path. The behavioural contract pinned (`fetch` → `checkout work branch` → `rebase <arbiter>/main` → on conflict `rebase --abort` and return non-zero) matches the documented real behaviour, but a future drift in `recoverAlreadyCommitted`'s post-failure tree shape would not be caught here. Adequate for this slice's seam?
  (Tests in `advance-release-crash-safe.test.ts` use `recoverConflictExecutor(branch)` and `RungExecutor` stubs throughout, not the real integration-core entrypoints. The slice's SEAM TO TEST AT directed real `advance` + real `releaseAdvancingLock`, which is satisfied; the upstream dispatch is fair-game to simulate, but the chosen simulation could mask future upstream drift.)
