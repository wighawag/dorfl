---
title: review-gate non-blocking nits for 'finish-already-committed-branch' (Gate 2 approve)
date: 2026-06-14
status: open
slug: finish-already-committed-branch
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'finish-already-committed-branch' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice's acceptance criteria require a '## Decisions' block recording: integration-core surface choice (a committedRecovery mode threaded through IntegrationCoreInput, NOT a thin separate entry), compose-not-merge with stale-lease Part B, the local-worktree-vs-surfaced-state decision, the non-split of the operator surface into a sibling slice, and the resolved complete --isolated fork. No authored '## Decisions' block exists in work/in-progress/finish-already-committed-branch.md, and the work is still uncommitted (the runner owns git transitions, so the build agent correctly did not edit the slice file or open the PR). All these decisions ARE thoroughly documented in code JSDoc (integration-core.ts committedRecovery doc, recover-isolated.ts module doc) and the answered-fork commit e143173. Ask the human/runner to ensure the PR description carries a '## Decisions' block lifting these from the code so the ratification trail is on the PR, not only in source comments.
  (Acceptance criterion at work/in-progress/finish-already-committed-branch.md line 64; decisions are present in integration-core.ts:169-191 and recover-isolated.ts:1-33 JSDoc but not in an authored Decisions block.)
- In-scope unspecified decision to RATIFY: the recovery path's propose-mode integrate omits title and body (recoverAlreadyCommitted does not pass title/body to applyCompleteTransition, unlike the build path which passes prTitle + composeProposeBody). A propose-mode recovery PR therefore falls back to gh --fill, deriving its title from the kept commit subject ('feat(<slug>): ...; done'). This is a reasonable, honest fallback (the recovery path has no slice frontmatter in hand to author a title), but it is a user-visible behaviour difference from a normal propose integrate that the slice did not specify. Ratify that gh --fill from the kept commit subject is the intended propose-mode PR title for recoveries, or decide the recovery should read the done/ slice's title: to author one.
  (integration-core.ts recoverAlreadyCommitted (~line 1118) passes only {arbiter, branch, mode, provider, noPR, deleteMergedHead, cwd, env} to applyCompleteTransition, vs the build path (~line 923) which also passes title: prTitle and body: composeProposeBody(...). All propose tests assert via merge/path landing, not PR title text, so this is unexercised by tests.)
