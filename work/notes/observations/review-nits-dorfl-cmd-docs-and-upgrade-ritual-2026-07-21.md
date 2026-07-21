---
title: review-gate non-blocking nits for 'dorfl-cmd-docs-and-upgrade-ritual' (Gate 2 approve)
date: 2026-07-21
status: open
reviewOf: dorfl-cmd-docs-and-upgrade-ritual
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'dorfl-cmd-docs-and-upgrade-ritual' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- In-scope structural decision to RATIFY: the agent authored a brand-new reference page docs/dorfl-cmd/README.md (139 lines) rather than folding dorflCmd into an existing page. The task left the home open (e.g. website/docs and/or README). The choice is coherent — it mirrors the existing docs/<topic>/README.md convention (docs/ci/README.md) and the README/website/CI/CONTEXT entries all cross-link it — so it is a ratification finding, not a defect.
  (docs/dorfl-cmd/README.md is new; docs/ci/README.md is the sibling precedent.)
- Scoped-out decision to RATIFY: the agent noticed a stale placeholder dorflBin in another task's unreleased changeset (.changeset/setup-nudges-dorfl-version-pin.md) and left it unedited, recording it as an observation note rather than fixing it. Correct scope call (editing another task's changeset is out of scope) and correct bucket (spotted/unverified drift = observation), but a human may want to reconcile that changeset before release so the published changelog does not name a field that never shipped.
  (work/notes/observations/setup-nudge-changeset-mentions-dorflBin-2026-07-21.md)
