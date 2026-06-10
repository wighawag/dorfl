---
title: the hard-coded "`gh` is unavailable or unauthenticated" misattribution (fixed in mutateLabel) STILL survives in postIssueComment's degrade path
date: 2026-06-10
slug: issue-provider-hardcoded-gh-unauth-string-survives-in-comment-and-comment-paths
---

## What was spotted

The first task this session FIXED a real bug in `src/issue-provider.ts` `mutateLabel` (commit 2026-06-10): it collapsed EVERY non-zero `gh` exit into a single hard-coded message _"`gh` is unavailable or unauthenticated"_, which misattributes the cause (e.g. it was really "`'agent-runner:processing'` not found"). The fix introduced `ghFailureReason(result)` to surface the REAL `gh` stderr, and made the label ops report a three-way outcome.

While reviewing the `intake-closes-issue-on-bounce` slice (which proposed `closeIssue` "mirror `postIssueComment`'s degrade"), it became clear the SAME hard-coded misattribution **still survives** in `postIssueComment`:

```ts
// issue-provider.ts postIssueComment(), degrade branch:
instruction:
  `\`gh\` is unavailable or unauthenticated, so the comment was not ` +
  `posted on issue #${input.issueNumber}. The comment:\n${input.body}`,
```

So a `postIssueComment` failure for ANY reason (rate limit, permissions, a transient 5xx, a deleted issue) is reported as an auth problem \u2014 the exact misattribution `mutateLabel` was fixed for. "Mirror `postIssueComment`" would have PROPAGATED the bug into the new `closeIssue` (the slice was corrected to use `ghFailureReason` instead).

## Why it matters

- **Diagnosability:** same as the original lock bug \u2014 a human chasing an auth problem that does not exist.
- **Coherence / contagion:** `postIssueComment` is the sibling other comment-ish seam methods are told to "mirror", so the stale string is a contagion source for future code (it nearly infected `closeIssue`).

## Scope / candidate fix

Apply the SAME treatment the lock fix applied: in `postIssueComment`'s degrade branch, surface the real cause via `ghFailureReason(result)` rather than the hard-coded "unavailable or unauthenticated" string. (Check whether any other `issue-provider.ts` path still carries a hard-coded guess; `getLabels`/`mutateLabel` were already corrected.) Small, mechanical, and removes the contagion source.

NOT folded into `intake-closes-issue-on-bounce` (that slice only ensures the NEW `closeIssue` uses `ghFailureReason`; it does not touch `postIssueComment` so it stays scoped). A tiny standalone fix slice or a fold-in to a nearby issue-provider change is the natural home.

## References

- The original fix: `work/done/intake-lock-failure-semantics-and-real-cause.md`
  - `ghFailureReason` in `src/issue-provider.ts`.
- `src/issue-provider.ts` `postIssueComment()` degrade branch (the surviving hard-coded string).
- Surfaced by: the review of `work/backlog/intake-closes-issue-on-bounce.md`.
