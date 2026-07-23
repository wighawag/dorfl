---
title: review-gate non-blocking nits for 'specs-land-in-proposed-rename' (Gate 2 approve)
date: 2026-07-23
status: open
reviewOf: specs-land-in-proposed-rename
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'specs-land-in-proposed-rename' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- In-scope-boundary decision to ratify: the agent left docs/adr/tasks-land-in-runner-deterministic-precedence.md still spelling pre-proposed (plus sibling stale tokens prdsLandIn / pre-backlog / todo) and captured it as an observation instead of editing it. Ratify this scope call (src+tests only), or schedule the broader ADR vocabulary refresh?
  (work/notes/observations/adr-tasks-land-in-precedence-has-stale-value-spellings-2026-07-23.md; docs/adr line 50 still reads pre-proposed / ready. Task acceptance is grep-clean in SRC OR TESTS only, which is satisfied; the ADR is out of the task fence.)
- The PR/commit body has no explicit Decisions block; the one in-scope judgement (leave the stale-ADR out of scope) lives only in the captured observation. Consider surfacing such decisions in the PR body next time so the human ratifies from one place.
  (git log -1 9b8d690f is a single-line message; the scope decision is recoverable only via the observation note.)
