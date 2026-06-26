---
title: review-gate non-blocking nits for 'sidecar-kind-field' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: sidecar-kind-field
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'sidecar-kind-field' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- In-scope decisions were not recorded in a '## Decisions' block on the PR description — please ratify: (a) token spelling 'kind=<value>' in the per-entry HTML comment (suggested by the task prompt); (b) field ORDER within the comment — 'kind=' is appended AFTER any 'answered=' token; (c) unknown 'kind=' is silently DROPPED on re-serialise (not echoed back), matching silent-on-malformed but meaning a round-trip is not byte-preserving for unknown tokens (tested at sidecar.test.ts).
  (git log -1 --format=%B shows only the conventional-commit title; no Decisions block. Implementation: packages/dorfl/src/sidecar.ts parse/serialise + test.)
