---
title: review-gate non-blocking nits for 'gate-nit-triage-text-skill-agnostic' (Gate 2 approve)
date: 2026-06-09
status: open
slug: gate-nit-triage-text-skill-agnostic
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'gate-nit-triage-text-skill-agnostic' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The new emitted line uses an em-dash ("durable home for triage — promote-to-slice / keep / delete.") and the test asserts that exact Unicode string. Is an em-dash desirable in machine-generated markdown that may be grepped/edited by tooling, vs. a plain ASCII hyphen/colon? It is consistent with the doc-comment style and the test pins it exactly, so there is no correctness risk — just confirm the em-dash is intended for generated files. (src/integration-core.ts renderReviewNitsObservation emitted body line; test/review-nits-observation.test.ts toContain assertion uses the identical em-dash string, so output and test agree.)
