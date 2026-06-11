---
title: review-gate non-blocking nits for 'review-comment-fallback-on-unparsed-pr-url' (Gate 2 approve)
date: 2026-06-11
status: open
slug: review-comment-fallback-on-unparsed-pr-url
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'review-comment-fallback-on-unparsed-pr-url' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the fallback RESOLVES the PR url first (`gh pr view <branch> --json url --jq .url`) and then reuses the URL-keyed `postPRComment`, rather than commenting on the branch directly (`gh pr comment <branch>`). The slice explicitly permitted either. Is resolve-first the intended shape?
  (Resolve-first is the stronger choice: it makes the no-PR case a deterministic no-op and reuses the exact same comment mechanics/assertions as the URL path (one code path to trust). The cost is two `gh` calls instead of one. The agent justified it in the `postPRCommentOnBranch` docstring. Recorded here only because there was no `## Decisions` block in the PR/commit to ratify it against.)
- Ratify: on a resolvable PR the comment targets the RESOLVED url, but on the no-op path the surfaced `instruction` interpolates the branch name and the full review body (`No open PR could be resolved for <branch>… The review:\n<body>`). Is leaking the full review prose into the run-output instruction (rather than a short pointer) the desired degrade behaviour?
  (This matches the established pattern of every other degrade path in this file (NoneProvider, missing-gh) which all surface the full review text so it is 'never lost' per ADR §6 — so it is consistent, not novel. Flagging only so the human confirms the verbose-instruction convention is intended to extend to the branch-fallback no-op too.)
- Confirm the runner will perform the `git mv work/in-progress/ → work/done/` for this slice on integration — the diff correctly does NOT move it (agent never does git), and the single commit is a bare 'save aborted work (wip)' checkpoint with no authored PR description.
  (Per the work contract the runner/human owns the done-move and the agent owns no git transitions, so the slice remaining in `work/in-progress/` is correct, not a defect. Surfaced only because the WIP commit message ('save aborted work') could read as 'incomplete' at a glance, whereas the gate is green and all acceptance criteria are met — the wording is a runner checkpoint artifact, not a signal of unfinished work.)
