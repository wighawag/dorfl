---
title: review-gate non-blocking nits for 'install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick' (Gate 2 approve)
date: 2026-06-16
status: open
slug: install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice's acceptance criteria require recording the drop-the-emitter-vs-fold-into-one choice as a `## Decisions` note in the done record or PR. The done file `work/done/install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick.md` has no `## Decisions` section and the commit body is just the slice title — ratify or ask for the note to be added retroactively.
  (`grep -A20 '^## Decisions' work/done/install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick.md` returns nothing; `git log -1 --format=%B HEAD` is a single-line subject. The decision itself (delete rather than fold, because advance-lifecycle already is the complete superset emitter) is sound and is explicitly argued in the slice body.)
- Ratify the test's workaround of re-constructing the shipped emitters directly from the template-module exports instead of calling `loadCapabilityRegistry()`.
  (The new describe in `test/install-ci.test.ts` notes that the registry-seam describe immediately above it clears the registry in `afterEach`, but capability modules self-register at import-time (cached per worker), so a later `loadCapabilityRegistry()` would observe an empty registry. The new tests sidestep this by hand-wiring the three shipped capability shims from `advance-lifecycle-template` / `intake-trigger-template` / `close-job-template`. It validates the right invariant (the emitter pipeline + the shipped capability id set) but is a slightly indirect seam — a human may prefer a fixture that resets module state instead.)
