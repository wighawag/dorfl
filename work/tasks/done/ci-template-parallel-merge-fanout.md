---
title: CI template — parallel merge fan-out (parallel build/gate/review, serialised land)
slug: ci-template-parallel-merge-fanout
spec: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [4, 6]
---

## What to build

Update the validated CI template so merge mode CAN fan out — parallel
build / gate / review across items, with the LAND step serialised by
whichever mechanism the floor provides (the scaled CAS-retry loop, see
`merge-retries-gate-precedence`; optionally the cross-job ref-lock if it
ships). Correct the "parallel merge thrashes the CAS" claim in
`docs/ci/README.md` to reflect `integrateLock` + `mergeRetries`.

This is a doc + emitter + test change as one vertical task:

- `docs/ci/README.md`: rewrite the single-sequential-merge mandate to the
  new shape. Explain that across runners the CAS loop IS the queue; within
  a runner the in-memory `integrateLock` is the optimisation. State that
  the cross-job serialiser is the (resolved) `mergeRetries` cap (the
  floor), and (where present) the optional ref-lock accelerator.
- `src/advance-ci-template.ts`: change the emitted workflow shape to fan
  out per item with a serialised land tail. Do NOT introduce GitHub
  Actions `concurrency:` as a required serialiser — it may be added as
  optional host sugar but the doc/emitter must work without it.
- `test/advance-ci-template.test.ts`: update / extend so the new shape is
  asserted and the old single-sequential assumption is removed.

Out of scope here: Tier-2 GitHub Merge Queue / `merge_group` trigger
(deferred per Applied Answer q3); the cross-job ref-lock itself (separate
task).

## Acceptance criteria

- [ ] `docs/ci/README.md` no longer claims parallel merge thrashes the
      CAS; it states the engine's actual safety story (`integrateLock` +
      `mergeRetries`) and the parallel-build / serialised-land shape.
- [ ] `src/advance-ci-template.ts` emits the new shape; the template
      stays correct on a bare arbiter (no host-specific feature is load-
      bearing for safety).
- [ ] `test/advance-ci-template.test.ts` asserts the new shape (fan-out +
      serialised-land tail) and is GREEN.
- [ ] Acceptance gate `pnpm -r build && pnpm -r test && pnpm format:check`
      is green.

## Blocked by

- None — the engine already provides the safety; this is the doc/emitter
  catching up.

## Prompt

> Read Stories 4 and 6 of the spec, and Applied Answer q1 (the cross-job
> serialiser decision: scaled CAS-retry as the floor, optional ref-lock as
> the accelerator, GitHub `concurrency:` only as optional sugar). Read
> `docs/ci/README.md`, `src/advance-ci-template.ts`, and
> `test/advance-ci-template.test.ts` together — they are the single
> validated unit. Update them as one task. Keep the floor framing
> intact: no host-specific feature is load-bearing for safety. Verify
> with the AGENTS.md acceptance gate. Record any in-scope decision you
> make (e.g. an explicit "no `concurrency:` block by default" choice) per
> task-template convention.

## Requeue 2026-06-26

CONTINUE from the kept branch (do NOT restart — the 358-line implementation is correct and complete except for the block below). Gate-2 block (valid): the workflow_dispatch integrationMode `description:` string still advertises the OLD shape 'merge => a single sequential advance -n --merge (rebase-chains to main)', contradicting the fan-out this task ships. FIX: update that description in BOTH copies — packages/dorfl/src/advance-lifecycle-template.ts (~L163) AND docs/ci/advance-loop.yml.template (~L92) — to the new shape (matrix per item; land tail serialised by the engine's mergeRetries CAS-retry loop). ALSO (non-blocking but do it): rephrase the stale propose-leg inline comments that still say 'the -n merge job cannot use it' / reference the removed '-n' job (advance-lifecycle-template.ts ~L550 'single sequential advance -n job' and the seed template ~L274). AND add the '## Decisions' block the prompt asked for, ratifying: (a) merge legs now pass --watch, (b) enumerate shared by propose+merge, (c) both jobs AND-guard on enumerate.any, (d) the -n driver removed entirely, (e) fail-fast:false on the merge matrix, (f) no concurrency: block by default. Then re-run the acceptance gate + Gate 2.
