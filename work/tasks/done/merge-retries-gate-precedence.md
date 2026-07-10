---
title: `mergeRetries` resolves through the gate-family precedence chain (flag > env > per-repo > global > default)
slug: merge-retries-gate-precedence
spec: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [5]
---

## What to build

Make `mergeRetries` configurable through the SAME precedence chain as the
other gates (flag > env > per-repo > global > default), keeping its modest
default. This is the git-alone FLOOR for the cross-job merge serialiser
(Applied Answer q1 part (a)): the CAS loop already IS the cross-job queue;
scaling its cap lets wide-matrix CI raise the bound on spurious
needs-attention bounces without changing the safety property (a lost CAS
still costs only a re-rebase + re-gate retry, never a `--force`, never a
both-land-broken).

The work is wiring + tests:

- Add `mergeRetries` to whatever in-repo config-resolution helper the
  other gates use; honour the documented precedence order.
- Thread the resolved value into `integration-core.ts` where
  `DEFAULT_MERGE_RETRIES` is currently consulted. Do not change the
  default.
- Add tests that assert the precedence at each rung (flag overrides env
  overrides per-repo overrides global overrides default) — mirror the
  existing gate-precedence tests' style.

External behaviour to assert: with a raised cap, more contenders converge
before any bounce to needs-attention; with the default cap, behaviour is
unchanged.

## Acceptance criteria

- [ ] `mergeRetries` is settable via flag, env, per-repo config, and
      global config, with the documented precedence; the default is
      preserved.
- [ ] `integration-core.ts` uses the resolved value (no more bare
      `DEFAULT_MERGE_RETRIES` consumption in the merge loop).
- [ ] Tests cover every precedence rung and assert the external
      behaviour (cap controls when a contender is bounced to needs-
      attention, not whether `verify` ran on the rebased tip).
- [ ] Acceptance gate green.

## Blocked by

- None — the precedence chain already exists for sibling gates; this
  extends it.

## Prompt

> Read Story 5 + Applied Answer q1 of the prd. Locate the existing
> gate-precedence helper (search for sibling gates such as
> `observationTriage` resolution) and follow its shape exactly — do not
> invent a parallel chain. Thread the resolved value into the merge loop
> in `integration-core.ts`. Tests must mirror existing precedence tests
> in style and assert external behaviour, not the helper's internals.
> Verify with the AGENTS.md acceptance gate. Record any decision about
> WHERE the value is resolved (e.g. resolved once at run start vs each
> retry) — that is exactly the "non-obvious in-scope decision" the task
> prompt instruction calls out.
