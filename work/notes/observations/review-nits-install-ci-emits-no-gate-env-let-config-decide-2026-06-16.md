---
title: review-gate non-blocking nits for 'install-ci-emits-no-gate-env-let-config-decide' (Gate 2 approve)
date: 2026-06-16
status: open
reviewOf: install-ci-emits-no-gate-env-let-config-decide
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-emits-no-gate-env-let-config-decide' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the validator's no-gate-env checks run against `operative` (comment lines stripped) so the rewritten header comment can still NAME the four AGENT_RUNNER_* keys for documentation/enable-path purposes. Is comment-level mention of the keys the intended posture, or should the validator also forbid the names in comments?
  (packages/agent-runner/src/advance-lifecycle-template.ts ~L446-474 (the four `no-gate-env-*` rules test `operative`, defined as the workflow text with `^\s*#` lines removed). The slice said 'keep/trim the explanatory header COMMENT so it now says the gate family is resolved from config', and the header comment now reads '...add the AGENT_RUNNER_* env var to this `env:` block yourself...' — i.e. it documents the override path by naming the prefix. Consistent with 'bare omission' (no `key: value` example is present, commented or otherwise), but worth an explicit ratification that documentation-by-name in the comment is fine.)
