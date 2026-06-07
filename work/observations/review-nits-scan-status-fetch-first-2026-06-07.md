---
title: review-gate non-blocking nits for 'scan-status-fetch-first' (Gate 2 approve)
date: 2026-06-07
status: open
slug: scan-status-fetch-first
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'scan-status-fetch-first' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- The `scan` failure-path test asserts `warnings` has length exactly 1 with a single mirror, which is correct, but neither test exercises the multi-mirror case where some mirrors fetch and others fail. Consider (future, not blocking) a case asserting that one broken mirror does not suppress a sibling mirror's fresh read.
  (scan.ts iterates `for (const mirror of mirrors)` calling `fetchMirrorMainOrWarn` per mirror; the per-mirror try/catch means one failure cannot abort the loop, so behaviour is correct — this is purely a coverage nicety, not a defect.)
