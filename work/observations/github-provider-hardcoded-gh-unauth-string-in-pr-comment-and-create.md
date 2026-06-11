---
title: the hard-coded "`gh` is unavailable or unauthenticated" misattribution ALSO survives in GitHubProvider (github.ts) — postPRComment + openRequest's unavailable branch — the PR/review surface counterpart to the issue-provider fix
date: 2026-06-11
slug: github-provider-hardcoded-gh-unauth-string-in-pr-comment-and-create
---

## What was spotted

During the Gate-3 review of PR #66 (`issue-provider-surface-real-gh-cause`, which removed the hard-coded "`gh` is unavailable or unauthenticated" misattribution from `issue-provider.ts`'s `createLabel`/`postIssueComment`), a grep confirmed the SAME hard-coded string still survives in the SIBLING provider `src/github.ts` (the `GitHubProvider` — the PR/review surface, NOT the issue surface that PR #66 fixed):

- **`github.ts` `postPRComment` degrade branch** (~line 283): on `result === undefined || result.status !== 0` it returns `instruction: "\`gh\` is unavailable or unauthenticated, so the review was not posted as a comment on <url>. …"` — for ANY failure cause (rate-limit, permissions, transient 5xx), the exact misattribution `issue-provider.ts` just removed.
- **`github.ts` `openRequest`** (~line 343): the `unavailable` (non-`outage`) degrade branch hard-codes `"\`gh\` is unavailable or unauthenticated, so no PR was opened — open one manually…"`. (The sibling `outage` branch already says something honest; only the `unavailable` branch hard-guesses.)

## Why it matters

- **Same class, same fix:** identical diagnosability defect as the `mutateLabel`/`postIssueComment`/`createLabel` bugs (`intake-lock-failure-semantics-and-real-cause` + `issue-provider-surface-real-gh-cause`). A human chasing a phantom auth problem on a PR-comment / PR-create failure whose real cause was a rate-limit or a permissions error.
- **Scope boundary (why PR #66 correctly did NOT touch it):** the `issue-provider-surface-real-gh-cause` slice was scoped to `issue-provider.ts` (the issue/label seam). `github.ts` is a DIFFERENT provider (`GitHubProvider`, the review/PR seam, used by `do`/`run`/`complete`'s propose path). So this is a legitimately-separate off-path finding, not a gap in PR #66.

## Scope / candidate fix

Apply the SAME `ghFailureReason(result)` treatment to `github.ts`'s `postPRComment` degrade branch and `openRequest`'s `unavailable` branch — surface the real `gh` stderr (with the missing-binary special case, mirroring the issue-provider fix) instead of the hard-coded "unavailable or unauthenticated" string. Check whether `ghFailureReason` is shared/importable or needs a sibling helper in `github.ts`. Keep the `outage`-vs-`unavailable` split and the never-hard-fail degrade posture unchanged. Small, mechanical, same family — a natural follow-up slice (or fold into a nearby `github.ts` change).

## References

- `src/github.ts` `postPRComment()` (~L283) + `openRequest()` `unavailable` branch (~L343) — the surviving hard-coded strings.
- `src/issue-provider.ts` `ghFailureReason()` — the helper to reuse/mirror.
- `work/done/intake-lock-failure-semantics-and-real-cause.md` (introduced `ghFailureReason`) + the `issue-provider-surface-real-gh-cause` slice (the issue-side counterpart of this exact fix).
- Surfaced by: Gate-3 review of PR #66, grepping the branch for the stale string after the issue-provider fix landed.
