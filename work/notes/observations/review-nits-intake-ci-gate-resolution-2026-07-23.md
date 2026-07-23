---
title: review-gate non-blocking nits for 'intake-ci-gate-resolution' (Gate 2 approve)
date: 2026-07-23
status: open
reviewOf: intake-ci-gate-resolution
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-ci-gate-resolution' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The workflow reads .autoBuild/.autoTask via jq but does not guard against dorfl config --json failing or jq returning null; a malformed/absent config would set auto_build/auto_task to the string null and silently fall to the merge branch. Worth a follow-up only if config resolution can realistically fail in CI.
  (steps.policy bash: config_json=$(dorfl config --json); auto_build=$(echo ... | jq -r .autoBuild). advance uses the same pattern, so this is consistent, not a regression.)
