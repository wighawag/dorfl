---
title: ADR — Land = rebase + re-verify + advance, one primitive with two frontends
slug: adr-land-primitive-rebase-reverify-advance
brief: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [1, 2, 3, 10]
---

## What to build

A single ADR in `docs/adr/` that captures the durable WHY of the land-time
re-verify invariant — naming the primitive the engine already implements and
framing merge/propose as two FRONTENDS to the same primitive. Working title:
`land-is-rebase-reverify-advance-one-primitive-two-frontends`.

The ADR must record:

- The principle: a clean `git` merge AND a human-approved diff both validate
  a change in the context it was AUTHORED, never the context it will LIVE.
  The only proof a change is correct in the tree it lands in is re-running
  acceptance ON THE POST-REBASE TREE.
- The primitive: `land = fetch current main → rebase → re-run verify (and
  review) on the rebased tree → advance`. A lost CAS / moved-`main`
  INVALIDATES any prior green and re-arms the gate.
- Two frontends to one primitive: merge mode = runner-inline at the
  serialised land; propose mode = human-checkpoint via surface→answer→apply.
  Human review is ADDITIVE (intent / design / security), NEVER a substitute
  for the re-verify.
- The floor/ceiling gradient: git-alone is the correctness floor (must be
  safe with nothing but `git push` + ref CAS against a bare `--bare` arbiter
  and `NoneProvider`); a capable host raises the ceiling but is never
  required for safety. GitHub is the benchmark.
- The invariants that DO NOT change: never `--force` to main, never
  auto-resolve a conflict (ADR §10).
- Deliberately-deferred forward seams: the `merge_queue` ruleset slot
  (Tier 2) is deferred to a follow-on brief, recorded here so it is not
  mistaken for an oversight.

This ADR is the durable home of the rationale the protocol-doc invariant
line POINTS to.

## Acceptance criteria

- [ ] New file `docs/adr/land-primitive-rebase-reverify-advance.md` exists
      and follows `docs/adr/ADR-FORMAT.md`.
- [ ] States the authored-context-vs-lived-context principle in its own
      words; states the primitive; states the two frontends; states the
      floor/ceiling gradient; states what remains an invariant.
- [ ] Cross-links the protocol invariant line that will live in
      `WORK-CONTRACT.md` / `CLAIM-PROTOCOL.md`, the brief, and (by name) the
      existing engine surfaces (`integration-core.ts`'s
      `performIntegration` + `freshWorktreeGate` + `mergeRetries`,
      `integrator.ts`, `run.ts`'s `createKeyedLock()`).
- [ ] Records the Tier-2 `merge_queue` deferral as a forward seam.

## Blocked by

- None — pure documentation; the engine and the brief already supply the
  content.

## Prompt

> You are writing the durable rationale ADR for the land-time re-verify
> doctrine. The engine that implements it ALREADY EXISTS — do not change
> code in this task. Read `work/briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md`
> (or `briefs/ready/` if not yet moved) end-to-end first, then
> `integration-core.ts`, `integrator.ts`, and `run.ts` enough to name the
> surfaces correctly. Follow `docs/adr/ADR-FORMAT.md`. Keep it durable:
> name the principle, the primitive, the two frontends, the floor/ceiling
> gradient, the unchanged invariants. Per repo convention, record any
> non-obvious in-scope decision you make while writing (e.g. ADR slug,
> what is in vs out of scope) so it is reviewable.
