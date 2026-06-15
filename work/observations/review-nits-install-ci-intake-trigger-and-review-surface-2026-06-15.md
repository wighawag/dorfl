---
title: review-gate non-blocking nits for 'install-ci-intake-trigger-and-review-surface' (Gate 2 approve)
date: 2026-06-15
status: open
slug: install-ci-intake-trigger-and-review-surface
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-intake-trigger-and-review-surface' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The intake workflow triggers on `issues: [labeled]` (any label) and the job `if:` condition does not filter to the documented `agent-runner:intake` label. Should it gate on the specific brand label, or is re-running intake on any label change intended? As built, the `INTAKE_TRIGGER_LABEL` constant is documented but never used in the actual trigger/if filter (it only appears inside an explanatory comment), so the emitted YAML's label behaviour diverges from the documented "the agent-runner:intake label" intent.
  (src/intake-trigger-template.ts: `on.issues.types: [opened, labeled]` and `if: ${{ github.event.issue.number && !github.event.issue.pull_request }}` carry no `github.event.label.name == '<brand>:intake'` check. INTAKE_TRIGGER_LABEL is exported and referenced only at line 208 inside a comment. Non-blocking because intake is gate-free and redundant ticks are serialized by the per-issue concurrency group + the processing lock; the acceptance criterion ("triggered by ... label") is technically met. Flagged for human ratification of the in-scope build decision.)
- Ratify two further self-made build decisions not dictated by the slice: (a) the PR-comment skip guard `!github.event.issue.pull_request` (so the workflow ignores comments on PRs, which also fire issue_comment), and (b) hardcoding `--arbiter origin` in the invocation. Both look correct and (b) matches the sibling capability templates, but they are agent choices the human should confirm.
  (src/intake-trigger-template.ts: the job `if:` excludes PR comments, and the final step runs `agent-runner intake "<N>" <prd_flag> <slice_flag> --arbiter origin`. Consistent with build-slice-tick/advance/close-job templates which also use `--arbiter origin`. No Decisions block was recorded in the PR/commit body, so these surfaced only by reading the diff.)
