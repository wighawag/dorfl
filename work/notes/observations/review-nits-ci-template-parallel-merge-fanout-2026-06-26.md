---
title: review-gate non-blocking nits for 'ci-template-parallel-merge-fanout' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: ci-template-parallel-merge-fanout
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'ci-template-parallel-merge-fanout' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the in-scope decisions the agent made — they should have landed as a '## Decisions' block in the task/PR but did not. From the requeue list: (a) merge legs pass --watch; (b) a single 'enumerate' job is shared by propose+merge; (c) both propose and merge jobs AND-guard on needs.enumerate.outputs.any; (d) the old '-n' driver job removed entirely (merge is now per-item); (e) fail-fast: false on the merge matrix so one losing item does not cancel siblings; (f) no GitHub Actions concurrency: block by default (floor stays host-agnostic, safety carried by the engine's mergeRetries CAS-retry loop). None look wrong, but they were not recorded for future archaeology.
  (work/tasks/done/ci-template-parallel-merge-fanout.md has no '## Decisions' section; HEAD commit body is empty; requeue note explicitly asked for this block.)
- One stale '-n' reference survived the cleanup: packages/dorfl/src/advance-lifecycle-template.ts L409 comment still reads 'The merge job re-scans the pool inside `advance -n`' — but the merge job now runs `dorfl advance "<item>" --merge`, not `advance -n`. Worth a one-line rephrase next time this file is touched (same flavour of nit the requeue flagged at L550 / seed L274, which were both fixed).
  (grep -n 'advance -n' packages/dorfl/src/advance-lifecycle-template.ts:409)
