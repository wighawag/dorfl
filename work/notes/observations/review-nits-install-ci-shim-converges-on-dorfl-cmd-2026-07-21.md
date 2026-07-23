---
title: 'review-gate non-blocking nits for ''install-ci-shim-converges-on-dorfl-cmd'' (Gate 2 approve)'
date: 2026-07-21
status: open
reviewOf: install-ci-shim-converges-on-dorfl-cmd
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-shim-converges-on-dorfl-cmd' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the recorded build-time decision: the CI resolver shim was REMOVED ENTIRELY (option A) rather than kept as a no-dorflCmd JS fallback (option B). Spec §6/story 4 explicitly permitted either; the agent chose removal citing one-code-path + a double-resolution hazard (a repo declaring both a devDep and dorflCmd would exec the local bin which then forwards again). Recorded in the Decisions note, inline comment, changeset, and README. Reversible. Human to ratify or reverse.
  (work/notes/observations/install-ci-shim-removed-not-kept-as-fallback.md; spec dorfl-self-version-pinning-and-bootstrap-forward.md §6/story 4 ('removed entirely (or a thin fallback)'))
- The Decisions/README lean on the claim that setup NUDGES a JS repo to declare dorflCmd: 'node_modules/.bin/dorfl' so a devDep-only repo does not silently float after the shim removal. That nudge is another task's concern, not verified as landed here. Confirm the setup nudge exists so a legacy devDep-only-pinned JS repo is not left un-pinned in CI.
  (docs/dorfl-cmd/README.md relationship-to-CI-shim section; decision note 'setup now nudges it')
