---
title: review-gate non-blocking nits for 'install-ci-prefer-project-local-dorfl' (Gate 2 approve)
date: 2026-06-27
status: open
reviewOf: install-ci-prefer-project-local-dorfl
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-prefer-project-local-dorfl' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the mechanism choice: a bash shim placed in $RUNNER_TEMP/dorfl-resolver and prepended to $GITHUB_PATH (vs. a DORFL= prefix). The task asked for a '## Decisions' block recording the choice and rationale; no such block was added to the task file or commit/PR description. Choice is sound and well-commented in code, but recordkeeping was skipped.
  (Task line 42 explicitly required a '## Decisions' block; install-ci-core.ts lines ~783-832 implement the shim-on-GITHUB_PATH variant.)
- Should the uniformity test also cover verify-workflow-template (emits 'dorfl verify') and advance-ci-template (emits 'dorfl scan --json', 'dorfl advance ...')? It currently pins only advance-lifecycle, intake, and close-job, leaving two capability templates unguarded against a future absolute/local-only path slipping in.
  (test/install-ci.test.ts: capabilities array imports only advance-lifecycle, intake, close-job; grep shows verify-workflow-template.ts and advance-ci-template.ts also emit dorfl invocations and use the shared dorfl-setup action.)
- Ratify: the resolver step is appended uniformly in BOTH registry and workspace install modes. Task said to leave the workspace install path intact — it does (shim runs after pnpm link --global) — but the workspace mode does pick up the new shim step. Intended?
  (install-ci-core.ts: 'installSteps = installSteps + resolverStep' is unconditional; covered by the workspace-mode ordering test.)
