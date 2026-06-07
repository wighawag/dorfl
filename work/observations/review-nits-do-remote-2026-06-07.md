---
title: review-gate non-blocking nits for 'do-remote' (Gate 2 approve)
date: 2026-06-07
status: open
slug: do-remote
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'do-remote' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- Step-1 `ensureMirror` overlaps `createJob`'s internal `ensureMirror` (step 4) — is the double-mirror-resolve intentional?
  (performDoRemote calls ensureMirror to surface the auto-register note and satisfy the test's existsSync(hub) check, then clones the arbiter URL directly for the claim, then createJob re-ensureMirrors (fetching the claim move). The first call is effectively for messaging + the test assertion. Harmless and arguably the right home for the auto-register note; recorded only so a future reader doesn't mistake it for an accidental duplicate. No change needed.)
