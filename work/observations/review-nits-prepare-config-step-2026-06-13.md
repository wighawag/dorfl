---
title: review-gate non-blocking nits for 'prepare-config-step' (Gate 2 approve)
date: 2026-06-13
status: open
slug: prepare-config-step
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prepare-config-step' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice asked the agent to record the optional within-one-worktree marker choice (the non-committed prepared-ness sentinel in the git control area, useMarker default-on) in a `## Decisions` block in the PR description, but there is no such block - the work is uncommitted and the rationale lives only in prepare.ts/integration-core.ts doc comments. Ratify the in-code record as sufficient, or ask for a Decisions block in the PR body?
  (Slice section 2 (and the Prompt) explicitly said: 'keep it OPTIONAL and document the choice in a `## Decisions` block.' The choice itself is correct and thoroughly documented in code (PREPARE_MARKER_BASENAME, preparedMarkerPath using git rev-parse --absolute-git-dir, ensurePrepared useMarker semantics). The only gap is the location of the human-facing record.)
- This diff introduces a genuinely new terminal/failure-cause name, `prepare-failed`, and a new protocol concept, `prepare (env-prep)`. CONTEXT.md's 'failure cause' section is the project's canonical enumeration of these outcome names (it lists gate-failed/rebase-conflict/review-blocked/... and tags new ones `(NEW)`, asserting 'there is NO parallel naming scheme'), and its glossary defines 'verify (the gate)'. Neither was updated. Should CONTEXT.md (failure-cause list + a prepare glossary entry) be brought in sync so the living glossary does not lag the code?
  (The slice (a protocol-primitive deriving from no PRD) did not require a CONTEXT.md or ADR edit, so this is not an acceptance-criteria miss. But coherence-wise, `prepare-failed` is exactly the kind of new outcome name that CONTEXT.md's failure-cause section exists to track, and the ci-config-policy-and-gate-family ADR is the natural home for the prepare/verify split. Flagging for the maintainer to decide whether to fold the glossary update in now or in a follow-up.)
