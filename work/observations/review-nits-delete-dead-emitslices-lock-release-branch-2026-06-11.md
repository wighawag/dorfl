---
title: review-gate non-blocking nits for 'delete-dead-emitslices-lock-release-branch' (Gate 2 approve)
date: 2026-06-11
status: open
slug: delete-dead-emitslices-lock-release-branch
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'delete-dead-emitslices-lock-release-branch' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The test header comment at packages/agent-runner/test/slicing-integration.test.ts:19 still says "instead of committing straight to main via the lock's emitSlices" — but after this slice the lock has no emitSlices at all. It reads as a historical contrast (what the keystone moved away from), so it's accurate-as-history, but a future reader grepping emitSlices will land on a reference to a now-deleted mechanism. Worth a one-line tweak (e.g. "via the lock's former emitSlices") to avoid the exact "reads as supported" residue this slice exists to kill?
  (The slice's own thesis is that latent references to a deleted mechanism are a trap. This is the same class of residue, just in a comment rather than live code — hence flagged, but non-blocking because it is purely descriptive prose with no behavioural effect, and Gate 1 is green.)
