---
title: review-gate non-blocking nits for 'install-ci-close-job-workflow' (Gate 2 approve)
date: 2026-06-15
status: open
reviewOf: install-ci-close-job-workflow
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-close-job-workflow' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the new top-level CLI verb `agent-runner close-merged-issues` (with `--cwd`/`--gh-bin`/`--json`, always exit-0, documented as locally runnable). The slice specified a JOB that 'invokes the existing close machinery' but did not name or mandate a new command surface; the engine had no close verb before. Is a new public top-level verb the intended shape, versus an `install-ci`-internal/hidden entry, and is the name `close-merged-issues` the one you want long-term?
  (src/cli.ts adds `program.command('close-merged-issues')` and src/index.ts exports `performCloseMergedIssues`/`runCloseJob`. The emitted workflow's run step is `agent-runner close-merged-issues`, so the name is now load-bearing for the generated artifact, future docs, and the wizard. Renaming later is a breaking change to any committed generated workflow.)
- The slice explicitly required recording the trigger choice + rationale in a `## Decisions` block in the PR description; the commit body has none. The chosen trigger (push:[main]) is the slice's own preferred option and is documented in the template comments + snapshot-asserted, so no rationale is actually lost. Ratify the trigger choice and note the missing Decisions-block as a process gap rather than a substantive one?
  (Slice line 17 + the prompt both say 'pick ONE, record it in a `## Decisions` block, and snapshot-assert it.' The snapshot-assert and rationale-in-comments were done; only the Decisions-block convention was skipped. Decision itself is pre-ratified by the slice (push:[main] was the recommended option).)
- Ratify the always-exit-0 posture of `close-merged-issues`: even when a closure condition holds but the provider close degrades (decision `close-failed`), the command logs the failure to stderr and exits 0. Is a silently-non-fatal exit the intended CI behaviour, or should a close-failed candidate surface a non-zero exit / needs-attention signal so a missing/unauthenticated token in CI is noticed rather than passing green?
  (src/cli.ts close-merged-issues action ends with `process.exit(0)` unconditionally; the doc-comment justifies it as 'a terminal CI tick: a degraded close is reported, not a crash, exactly like intake's bounce close.' close-job.test.ts asserts the close-failed decision is reported (not thrown), but nothing escalates it. In CI this means a real auth misconfiguration that prevents closing issues would not fail the workflow run.)
