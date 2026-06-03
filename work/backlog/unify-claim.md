---
title: unify-claim — retire the claim.sh wrapper; use the in-process claim everywhere
slug: unify-claim
prd: agent-runner
afk: false
blocked_by: [run-once, claim-command]
covers: [5]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

Consolidate on a SINGLE claim implementation. Today there are two, used by
different paths (an accident of build order):

- `src/claim-cas.ts` (`performClaim`) — the in-process TS claim (from
  `claim-command`); used by the human surface (`cli.ts` claim, `start.ts`).
- `src/claim.ts` (`claimItem`/`claimItemAsync`) — a wrapper that shells out to the
  portable `claim.sh`; still used by `src/run.ts` (the autonomous `run-once`),
  because run-once was built before the in-process version existed.

This slice makes `run-once` (and anything else) use the in-process
`performClaim`, then removes the `claim.sh` wrapper. After this, agent-runner
never executes `claim.sh` — `claim.sh` remains ONLY as the `to-slices` skill's
portable, zero-dependency reference/bootstrap (it is no longer an agent-runner
runtime dependency).

End-to-end:

- **Switch `run.ts`** from `claimItem` (wrapper) to `performClaim` (in-process),
  preserving run-once's behaviour — especially the genuinely-concurrent two-runner
  race (exactly one winner) that `run.test.ts` verifies. Mind any behavioural
  differences between the wrapper and `performClaim` (e.g. async racing, exit-code
  mapping, dirty-tree refusal) and reconcile them.
- **Remove** `src/claim.ts` and its `index.ts` re-exports; delete or fold
  `test/claim.test.ts` (its race coverage already exists in `claim-cas.test.ts`).
- **Update `run.test.ts`** to drive the in-process claim (drop the `CLAIM_SCRIPT`
  override path for run-once; keep using a local `--bare` arbiter).
- **Drop the `claim.sh` resolver** (`defaultClaimScript`) once nothing uses it.
- Leave `skills/to-slices/scripts/claim.sh` in place (the portable reference).

## Acceptance criteria

- [ ] `run-once` claims via the in-process `performClaim`; no code path shells out
      to `claim.sh`.
- [ ] `src/claim.ts` (the wrapper) and its exports are removed; the build is clean.
- [ ] run-once behaviour is preserved: green→done, red→stays, caps respected, and
      a simultaneous two-runner race yields exactly one winner (tests still green).
- [ ] No remaining reference in `src/` executes `claim.sh`; `claim.sh` survives
      only as the `to-slices` skill's portable reference.
- [ ] Full gate green (`pnpm -r build && pnpm -r test && pnpm -r format:check`).

## Blocked by

- `run-once` — this changes how run-once claims.
- `claim-command` — provides the in-process `performClaim` that becomes the single
  implementation.

## Prompt

> Unify `agent-runner`'s claiming on the in-process implementation and retire the
> `claim.sh` wrapper, in `packages/agent-runner/`. READ FIRST: `src/claim-cas.ts`
> (`performClaim`, the in-process claim to standardise on), `src/claim.ts` (the
> wrapper to remove), `src/run.ts` + `test/run.test.ts` (the consumer to switch),
> and `docs/adr/execution-substrate-decisions.md` §9 (agent-runner is the primary
> claim impl; `claim.sh` stays as the portable reference). Follow `AGENTS.md`.
>
> Switch `run.ts` to `performClaim`, preserving run-once behaviour (green→done,
> red→stays in-progress, concurrency caps, and the genuinely-simultaneous
> two-runner race = exactly one winner). Reconcile any wrapper-vs-performClaim
> differences (async racing, exit-code mapping, dirty-tree refusal). Remove
> `src/claim.ts` + its `index.ts` re-exports + the `claim.sh` resolver; delete or
> fold `test/claim.test.ts` (race coverage already in `claim-cas.test.ts`); update
> `run.test.ts` to drive the in-process claim against a local `--bare` arbiter.
> Leave `skills/to-slices/scripts/claim.sh` untouched (portable reference only).
>
> TDD/regression with vitest: run-once’s existing scenarios stay green, especially
> the two-runner race. "Done" = acceptance criteria met and `pnpm -r build &&
> pnpm -r test && pnpm -r format:check` green.
