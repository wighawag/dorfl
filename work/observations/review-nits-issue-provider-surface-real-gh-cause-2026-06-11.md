---
title: review-gate non-blocking nits for 'issue-provider-surface-real-gh-cause' (Gate 2 approve)
date: 2026-06-11
status: open
slug: issue-provider-surface-real-gh-cause
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'issue-provider-surface-real-gh-cause' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope decision: on a MISSING `gh` during the create-retry (createLabel returns `{ok:false}` with no reason), `mutateLabel` falls through and surfaces the ORIGINAL `'<label>' not found` add stderr rather than a 'gh is not available (binary missing)' message. Intended (and documented in the code comment as 'degrades to the original result like the rest of the seam'), but it means the one residual path where the reported cause is the fresh-repo SYMPTOM rather than the true 'gh missing' cause. Acceptable? It only occurs when the binary vanishes between the add and the create within a single call — vanishingly rare — but worth a human nod since the slice's stated aim was to eliminate symptom-misattribution.
  (src/issue-provider.ts mutateLabel: the `created.ok === false && created.reason === undefined` case is not handled in the retry block; control reaches `if (result.status !== 0)` which reports `ghFailureReason(result)` = the original `'<label>' not found` add stderr.)
- Ratify the user-visible message-wording change to the comment-poster degrade instruction. It went from "`gh` is unavailable or unauthenticated, so the comment was not posted on issue #N. The comment:\n..." to "could not post the comment on issue #N: <reason>. The comment:\n...". Any operator tooling or test that matched the OLD phrasing elsewhere would need updating; the in-tree tests were updated, but confirm nothing outside this package keys off the old string.
  (src/issue-provider.ts postIssueComment degrade branch; the new shape mirrors closeIssue/getLabels phrasing for consistency.)
- Coverage note (not a block): there is no dedicated test asserting the `createLabel` `already exists` branch returns `{ok:true}` after the return-type change. The behaviour is preserved (the regex is untouched) and exercised indirectly by the fresh-repo create-success test, but a targeted concurrent-create (`already exists`) regression test would lock the slice's 'already exists → success unchanged' criterion against future refactors of the three-way return.
  (test/intake.test.ts has writeGhFreshRepoLabelStub (create-success) and writeGhCreateForbiddenStub (create-fail) but no stub returning `already exists` on create.)
