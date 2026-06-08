---
title: run-internal-error-tests — harden two thin-coverage `run` paths with focused regression tests: (1) the claim-CAS retry's idempotent branch-reset, (2) the internal-error classification a thrown core error / dead settled-slot fallback yields
slug: run-internal-error-tests
covers: []
---

> Self-contained test-hardening slice — derives from NO PRD (`covers: []`), so per
> WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signals:
> `work/observations/review-nits-run-daemon-reframe-2026-06-07.md` (both nits: the
> camouflaged settled-slot fallback + the missing claim-retry unit test) and
> `work/observations/run-thrown-core-error-labeled-agent-failed.md` (the thrown-core-
> error label). Delete BOTH observations once this lands — UNLESS Q1 below is
> answered "rename the status" and split out (see Open question).
>
> SCOPE NOTE (human directive): this slice is scoped to **adding the tests** that
> pin already-shipped behaviour, NOT to renaming the status. Whether a thrown
> core/wiring error and the dead settled-slot fallback should carry a DISTINCT
> `internal-error` status (instead of `agent-failed`/`claim-error`) is a real design
> question recorded below as an OPEN QUESTION — do NOT decide it in code here; pin
> the CURRENT behaviour and surface the question.

## What to build

Add focused regression tests for two `run`/claim paths whose coverage today is
emergent (only exercised indirectly via higher-level concurrency tests), so a future
refactor cannot silently break them:

**(1) The claim-CAS retry's idempotent branch-reset.** `claim-cas.ts` `attempt()`
detaches HEAD onto `<arbiter>/main` BEFORE `git branch -D <claimBranch>` + `checkout
-b <claimBranch>`, so the throwaway claim branch can always be deleted+recreated on a
RETRY (the prior attempt left HEAD on `claimBranch`; deleting the current branch
otherwise refuses → a stale branch → the re-`checkout -b` fails "already exists").
Today this is only covered indirectly via the merge-mode same-repo concurrency tests
(which advance main under a claim). Add a UNIT test that drives `performClaim`'s
retry branch in isolation (force a CAS rejection on the first attempt — e.g. advance
`<arbiter>/main` between fetch and push, or stub the push to reject once) and asserts
the second attempt SUCCEEDS (no "branch already exists" / "cannot delete current
branch" failure), pinning the idempotent reset across attempts.

**(2) The internal-error classification.** `run.ts` has two paths that surface a
genuine INTERNAL bug as a routine-looking outcome:
- `runOneItem`'s `catch` around `performIntegration` routes a THROWN core error
  (e.g. `review` on with no `reviewGate` wired — a wiring/config misconfig, NOT an
  agent fault) through `saveAgentFailure` → `status: 'agent-failed'`.
- `runOnce`'s settled-slot fallback (~line 327) maps any uncaught worker throw
  (which `runOneItem` is documented never to produce) to `status: 'claim-error'` —
  so a real escaped exception reads as a benign lost/contended claim.

Add tests that PIN the current classification of both (a thrown core error →
`agent-failed` + work preserved + tick continues; a forced settled-slot throw →
`claim-error` with the captured error message in `detail`), so the behaviour is
documented and a regression is caught. (These pin TODAY's labels; see the Open
question for whether the labels should change — that is a separate, gated follow-up.)

## Scope

- IN: a unit test on `performClaim`'s retry path (idempotent claim-branch reset); a
  test pinning `runOneItem`'s thrown-core-error → `agent-failed` (work saved, tick
  continues); a test pinning `runOnce`'s settled-slot fallback → `claim-error` with
  the captured `detail`. House test harness (throwaway repos + local `--bare`
  arbiter; temp `workspacesDir`; `isolatePiAgentDir`).
- OUT: changing any production behaviour (this slice adds tests only); the
  `internal-error` status rename (the Open question — a separate slice if approved);
  the `run`-vs-`do` cross-path classification divergence (also deferred to that
  question).

## Acceptance criteria

- [ ] A unit test drives `performClaim`'s RETRY branch in isolation (first attempt's
      CAS rejected; second attempt off the advanced main) and asserts the second
      attempt SUCCEEDS — pinning the detach-before-delete idempotent reset (it FAILS
      if the detach is removed).
- [ ] A test pins `runOneItem`'s thrown-core-error path: a thrown `performIntegration`
      error (e.g. the no-`reviewGate`-wired misconfig) yields `status: 'agent-failed'`
      with the work preserved/surfaced and the tick CONTINUING (no crash).
- [ ] A test pins `runOnce`'s settled-slot fallback: a forced uncaught worker throw
      yields `status: 'claim-error'` carrying the captured error message in `detail`.
- [ ] No production code changes (tests-only diff outside any minimal test-seam hook
      genuinely required to force the throws — if a seam hook is needed, keep it
      test-only and document it).
- [ ] Test isolation: temp `workspacesDir` + `isolatePiAgentDir`; the real
      `~/.agent-runner/` + `~/.pi/agent/sessions/` are untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Open question (DO NOT decide in code — surface it)

Should a thrown core/WIRING error and the dead settled-slot fallback carry a DISTINCT
status (e.g. `internal-error` / `config-error`) instead of `agent-failed` /
`claim-error`, so an operator triaging a stuck fleet item is not misled into blaming
the agent (or dismissing a real bug as a routine claim)? Note `complete.ts` maps the
SAME thrown error to `outcome: 'usage-error'`, so `run` and `do` currently classify
the identical error differently — a small cross-path drift the convergence was meant
to reduce. Counter: a distinct status adds surface for a path that "can't happen" in
production; a clearer REASON string on the existing status may be enough. If the
answer is "rename", that is a SEPARATE follow-up slice (a production change with its
own tests); this slice only pins the current behaviour. Raise this via the
`## Decisions`/STOP channel if building reveals the rename is load-bearing.

## Prompt

> Add focused REGRESSION TESTS (no production behaviour change) for two thin-coverage
> `run`/claim paths so a future refactor cannot silently break them. Source:
> `work/observations/review-nits-run-daemon-reframe-2026-06-07.md` (both nits) +
> `work/observations/run-thrown-core-error-labeled-agent-failed.md` (READ BOTH FIRST;
> delete both once this lands).
>
> (1) Unit-test `performClaim`'s RETRY branch in isolation: force the first attempt's
> CAS push to be rejected (advance `<arbiter>/main` between fetch and push, or stub
> the push to reject once), and assert the SECOND attempt succeeds — pinning the
> `git checkout --detach <arbiter>/main`-before-`branch -D`+`checkout -b` idempotent
> claim-branch reset (the test must FAIL if the detach is removed).
>
> (2) Pin `run`'s internal-error classification AS IT IS TODAY: a thrown
> `performIntegration` error (e.g. `review` on with NO `reviewGate` wired) →
> `runOneItem` catch → `status: 'agent-failed'`, work preserved, tick CONTINUES; and
> `runOnce`'s settled-slot fallback (a forced uncaught worker throw) → `status:
> 'claim-error'` with the captured message in `detail`.
>
> DO NOT rename the status or change behaviour — this slice PINS current behaviour.
> Whether these should be a distinct `internal-error`/`config-error` status is an
> OPEN QUESTION (see the slice body); if building shows the rename is load-bearing,
> raise it via the `## Decisions` block / STOP channel rather than deciding it here.
>
> READ FIRST: `src/claim-cas.ts` `attempt()` (the detach-before-delete preamble + the
> `while(true)` retry loop); `src/run.ts` `runOneItem` (the `catch` around
> `performIntegration` → `saveAgentFailure` → `agent-failed`) + `runOnce` (the
> settled-slot `.map` fallback ~line 327 → `claim-error`); `src/complete.ts`
> `performComplete` catch-all (maps the SAME error to `usage-error` — the cross-path
> divergence noted in the open question); the existing `test/run.test.ts` /
> `test/run-loop.test.ts` concurrency tests (for the house harness pattern to reuse).
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter; temp
> `workspacesDir`; `isolatePiAgentDir`; assert the real shared dirs are untouched).
> "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim run-internal-error-tests --arbiter origin
git fetch origin && git switch -c work/run-internal-error-tests origin/main
git mv work/in-progress/run-internal-error-tests.md work/done/run-internal-error-tests.md
```
