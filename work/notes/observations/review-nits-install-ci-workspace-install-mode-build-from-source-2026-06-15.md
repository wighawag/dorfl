---
title: review-gate non-blocking nits for 'install-ci-workspace-install-mode-build-from-source' (Gate 2 approve)
date: 2026-06-15
status: open
reviewOf: install-ci-workspace-install-mode-build-from-source
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-workspace-install-mode-build-from-source' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the link-incantation choice: the slice/acceptance/prompt all specify `pnpm --filter agent-runner link --global`, but the landed code emits (and the test pins) `cd packages/agent-runner && pnpm link --global`. These are functionally equivalent and the slice explicitly licensed verifying/adjusting the incantation, but the divergence from the verbatim acceptance string was not recorded in a PR Decisions block. Confirm the `cd && link` form is the intended one to bake into the generated workflow.
  (install-ci-core.ts workspace branch: `cd packages/agent-runner && pnpm link --global`. Acceptance criterion + prompt SEAM-TO-TEST both name `pnpm --filter agent-runner link --global`. Test 'workspace mode builds the CLI from source + links it' pins `cd packages/agent-runner && pnpm link --global`.)
- No '## Decisions' block accompanied this PR (only the commit message was available). Going forward, in-scope deviations like the link-incantation change above should be recorded there so the ratification step starts from the agent's own list rather than reconstruction.
  (Reviewed against the commit message and the diff; `git notes` empty and no PR-description artifact present in the worktree.)
