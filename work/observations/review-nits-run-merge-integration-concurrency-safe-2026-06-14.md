---
title: review-gate non-blocking nits for 'run-merge-integration-concurrency-safe' (Gate 2 approve)
date: 2026-06-14
status: open
slug: run-merge-integration-concurrency-safe
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'run-merge-integration-concurrency-safe' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Step 6 (posting the Gate-2 review comment to the PR) is now INSIDE the locked rebase-to-integrate tail, whereas the slice scoped the lock to 'step 4 fetch+rebase through step 5 integrate'. Ratify including step 6 in the serialised region?
  (Step 6 references `integration` (the integrate result) so it has to live after step 5; including it in the closure is the natural structure. It is advisory only (it mutates no `main` state and `postPRComment*` never throws), so serialising it adds at most a brief per-repo tail extension and cannot cause a correctness regression. This is an in-scope placement decision the agent made on its own (the slice said 4-5); it looks correct, so it is a ratification, not a block.)
- The three required decisions (per-repo-lock vs bounded-rebase-retry; genuine-conflict-routes-one-to-needs-attention; lock wraps only the tail) are recorded thoroughly in code comments and in the slice's own Decisions section, but the work is uncommitted and there is no committed `## Decisions` PR-description block yet. Confirm the runner-owned commit/PR body carries that Decisions block at land time.
  (The substance is fully captured (run.ts comment block, IntegrationCoreInput doc comment, the tail comment, and the slice file). The work/ item is still in work/in-progress/ with the change unstaged because the runner/human owns the commit + done-move; this is a reminder that the formal Decisions block must appear in the PR body, not a defect in the diff.)
