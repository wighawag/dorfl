---
title: review-gate non-blocking nits for 'cas-create-nonce-authoritative-same-identity' (Gate 2 approve)
date: 2026-06-13
status: open
slug: cas-create-nonce-authoritative-same-identity
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'cas-create-nonce-authoritative-same-identity' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the new `publishedHead` field on `ApplyTransitionResult` and the change to claim's onboarding sha. Because the seam now pushes a nonce'd commit rather than the caller's input `head`, claim must (and does) branch/track/report off `result.publishedHead` (threaded out as `claimCommit`). Confirm this contract change is intended.
  (src/ledger-write.ts adds `publishedHead?` to ApplyTransitionResult; claim-cas.ts:387 `const landed = result.publishedHead ?? head;` then returns `claimCommit: landed`. This is load-bearing: claimCommit flows to isolation.ts where `assertClaimCommitReachable(claimCommit, '<arbiter>/main')` (isolation.ts:321,372-383) and `git switch -C <branch> <claimCommit>` (isolation.ts:328) would FAIL LOUDLY or build on a detached pre-nonce sibling if the un-pushed input `head` were returned instead. The agent caught this correctly; flagging for human ratification of the result-type contract growth.)
- The slice required the nonce mechanism + injection strategy to be stated in a `## Decisions` block. It is documented inline (stampNonce docstring) but not yet in a PR description. When authoring the PR, lift the decisions into the description: trailer = `CAS-Nonce: <uuid>`; strategy = option (c) the seam amends the tip via `git commit-tree`; identity pinned from the original commit; `GIT_COMMITTER_DATE` deliberately left current; fresh nonce per attempt.
  (Work is uncommitted (runner owns the commit/PR), so no PR description exists yet to inspect. The decisions themselves are present and sound in src/ledger-write.ts stampNonce docstring (~L344-390).)
- Consider aligning the triage-persist identical-identity test's construction with the advance-triage one for clarity. It uses `raceClone(seeded, 'a'/'b')` (distinct local config) then overrides with identical `env: gitEnv()`. This is correct (env vars win over local config, so both commits carry identical identity) but reads against the freshly-reframed `raceClone` docstring ("models distinct principals").
  (test/triage-persist.test.ts new test uses raceClone + env: gitEnv(); test/advance-triage.test.ts uses plain seeded.clone + explicit identical `git config user.name/email`. gitEnv() sets GIT_AUTHOR/COMMITTER_NAME/EMAIL to 'Test Runner'/'test@example.com' (gitRepo.ts:19-22), which override raceClone's distinct local config — so the identical-identity premise genuinely holds. Pure readability nit; the test is faithful as written.)
