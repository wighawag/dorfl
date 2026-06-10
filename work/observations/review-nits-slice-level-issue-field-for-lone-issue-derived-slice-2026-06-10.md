---
title: review-gate non-blocking nits for 'slice-level-issue-field-for-lone-issue-derived-slice' (Gate 2 approve)
date: 2026-06-10
status: open
slug: slice-level-issue-field-for-lone-issue-derived-slice
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slice-level-issue-field-for-lone-issue-derived-slice' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The agent took the OPTIONAL branch and added the pure `resolveClosingIssue(frontmatter)` helper (with a 4-case precedence test) rather than deferring it to `runner-in-ci`. Ratify keeping it now?
  (The slice explicitly sanctioned this as an either/or option ('a tiny pure resolveClosingIssue(frontmatter) helper … add it with a unit test, OR defer it') and pinned the exact precedence it must encode (`prd:` wins over a lone `issue:` when both present). The landed helper matches that precedence precisely, is genuinely pure, and is NOT wired into intake or any reader — so it respects the scope fence (no closure reader, no CI close-job). This is in-scope and correct; recording it only so the human can ratify shipping the helper now vs. deferring it, since it adds a small piece of public API (`resolveClosingIssue` exported from `frontmatter.ts`) ahead of its consumer.)
