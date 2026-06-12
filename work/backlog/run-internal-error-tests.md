---
title: run-internal-error-tests — harden two thin-coverage `run` paths with focused regression tests: (1) the claim-CAS retry's idempotent branch-reset, (2) PIN `run`'s CURRENT internal-error classification (config-error / claim-error)
slug: run-internal-error-tests
covers: []
---

> Self-contained test-hardening slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signals: `work/observations/review-nits-run-daemon-reframe-2026-06-07.md` (both nits: the camouflaged settled-slot fallback + the missing claim-retry unit test) and `work/observations/run-thrown-core-error-labeled-agent-failed.md` (the thrown-core-error label).
>
> RE-SCOPED 2026-06-12 (drift correction). The ORIGINAL slice asserted the thrown-core-error → `status: 'agent-failed'` and carried an Open question about whether it SHOULD get a distinct status. Both have since been ANSWERED IN CODE: the failure-cause-classification work (commit `3e7df84`, 2026-06-09 — AFTER this slice was authored in `b95e732`, 2026-06-08) routed `run`'s `saveAgentFailure` through `classifyFailureCause`, so a thrown wiring/config error is now `status: 'config-error'` (NOT `agent-failed`), and the `do`-vs-`run` cross-path divergence the observation flagged is CLOSED (both classify identically). The build agent correctly STOPPED rather than silently "fixing" the stale assertion (which would have re-decided a user-visible status). This re-scope PINS TODAY's behaviour and drops the resolved Open question. (See `## Needs attention` history at the foot — kept for provenance.)

## What to build

Add focused regression tests for two `run`/claim paths whose coverage today is emergent (only exercised indirectly via higher-level concurrency tests), so a future refactor cannot silently break them. **Tests only — NO production behaviour change.**

**(1) The claim-CAS retry's idempotent branch-reset** (NOT drifted — buildable exactly as originally written). `claim-cas.ts` `attempt()` detaches HEAD onto `<arbiter>/main` BEFORE `git branch -D <claimBranch>` + `checkout -b <claimBranch>`, so the throwaway claim branch can always be deleted+recreated on a RETRY (the prior attempt left HEAD on `claimBranch`; deleting the current branch otherwise refuses → a stale branch → the re-`checkout -b` fails "already exists"). Today this is only covered indirectly via the merge-mode same-repo concurrency tests. Add a UNIT test that drives `performClaim`'s retry branch in isolation (force a CAS rejection on the first attempt — e.g. advance `<arbiter>/main` between fetch and push, or stub the push to reject once) and asserts the second attempt SUCCEEDS (no "branch already exists" / "cannot delete current branch" failure), pinning the idempotent reset across attempts. **It must FAIL if the `git checkout --detach <arbiter>/main` preamble is removed.**

**(2) PIN `run`'s internal-error classification AS IT IS TODAY** (re-baselined from the original — the labels were corrected by `3e7df84`). `run.ts` surfaces two internal conditions:

- `runOneItem`'s `catch` around `performIntegration` routes a THROWN core error through `saveAgentFailure`, which CLASSIFIES the detail via `classifyFailureCause`. A `review`-on-with-NO-`reviewGate`-wired misconfig throws a message containing "wiring bug" (`src/integration-core.ts`), which matches `CONFIG_ERROR_SIGNATURES` (`/wiring bug/i`, `src/failure-cause.ts`) → **`status: 'config-error'`** (NOT `agent-failed`). The twin `do` path already pins exactly this (`test/do.test.ts:561` asserts `config-error` and `.not.toBe('agent-failed')`) — this slice adds the matching `run`-side pin.
- `runOnce`'s settled-slot fallback (~line 327) maps any uncaught worker throw (which `runOneItem` is documented never to produce) to **`status: 'claim-error'`** with the captured message in `detail`.

Add tests that PIN BOTH (a thrown wiring/config core error → `config-error`, work preserved, tick CONTINUES; a forced settled-slot throw → `claim-error` with the captured message in `detail`), so the behaviour is documented and a regression is caught.

## Scope

- IN: a unit test on `performClaim`'s retry path (idempotent claim-branch reset); a test pinning `runOneItem`'s thrown-wiring-error → `config-error` (work saved, tick continues); a test pinning `runOnce`'s settled-slot fallback → `claim-error` with the captured `detail`. House test harness (throwaway repos + local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir`).
- OUT: changing ANY production behaviour (this slice adds tests only); there is NO status rename to do (it already happened in `3e7df84`); no Open question remains.

## Acceptance criteria

- [ ] A unit test drives `performClaim`'s RETRY branch in isolation (first attempt's CAS rejected; second attempt off the advanced main) and asserts the second attempt SUCCEEDS — pinning the detach-before-delete idempotent reset (it FAILS if the detach is removed).
- [ ] A test pins `runOneItem`'s thrown-wiring-error path: a thrown `performIntegration` error (the no-`reviewGate`-wired misconfig, message containing "wiring bug") yields **`status: 'config-error'`** with the work preserved/surfaced and the tick CONTINUING (no crash). (Mirrors `test/do.test.ts:561` on the `run` side.)
- [ ] A test pins `runOnce`'s settled-slot fallback: a forced uncaught worker throw yields `status: 'claim-error'` carrying the captured error message in `detail`.
- [ ] No production code changes (tests-only diff outside any minimal test-seam hook genuinely required to force the throws — if a seam hook is needed, keep it test-only and document it).
- [ ] Test isolation: temp `workspacesDir` + `isolatePiAgentDir`; the real `~/.agent-runner/` + `~/.pi/agent/sessions/` are untouched.
- [ ] `pnpm format:check && pnpm build && pnpm test` green (this repo's gate).
- [ ] On landing: mark `work/observations/run-thrown-core-error-labeled-agent-failed.md` RESOLVED (its divergence is closed by `3e7df84`; this slice pins it) — do NOT delete it on a stale basis; and discharge `work/observations/review-nits-run-daemon-reframe-2026-06-07.md`'s two nits (now covered by these tests).

## Prompt

> Add focused REGRESSION TESTS (no production behaviour change) for two thin-coverage `run`/claim paths so a future refactor cannot silently break them. RE-SCOPED 2026-06-12: the original slice's path-(2) labels DRIFTED (the thrown-wiring-error became `config-error`, not `agent-failed`, in commit `3e7df84`); this slice PINS TODAY's behaviour. Source: `work/observations/review-nits-run-daemon-reframe-2026-06-07.md` (both nits) + `work/observations/run-thrown-core-error-labeled-agent-failed.md` (READ BOTH FIRST; on landing mark the latter RESOLVED, do NOT delete it).
>
> (1) Unit-test `performClaim`'s RETRY branch in isolation: force the first attempt's CAS push to be rejected (advance `<arbiter>/main` between fetch and push, or stub the push to reject once), and assert the SECOND attempt succeeds — pinning the `git checkout --detach <arbiter>/main`-before-`branch -D`+`checkout -b` idempotent claim-branch reset (the test must FAIL if the detach is removed).
>
> (2) PIN `run`'s internal-error classification AS IT IS TODAY: a thrown `performIntegration` error (`review` on with NO `reviewGate` wired — message contains "wiring bug") → `runOneItem` catch → `saveAgentFailure` → `classifyFailureCause` → **`status: 'config-error'`**, work preserved, tick CONTINUES; and `runOnce`'s settled-slot fallback (a forced uncaught worker throw) → **`status: 'claim-error'`** with the captured message in `detail`.
>
> DO NOT change behaviour — this slice PINS current behaviour. There is NO status rename to do (it already happened in `3e7df84`) and NO Open question to surface. If you find a NEW discrepancy between the slice and the code, STOP and surface it rather than deciding it.
>
> READ FIRST: `src/claim-cas.ts` `attempt()` (the detach-before-delete preamble + the `while(true)` retry loop); `src/run.ts` `runOneItem` (the `catch` around `performIntegration` → `saveAgentFailure` → `classifyFailureCause`) + `runOnce` (the settled-slot `.map` fallback ~line 327 → `claim-error`); `src/failure-cause.ts` (`CONFIG_ERROR_SIGNATURES`, `/wiring bug/i`); `src/integration-core.ts` (the `review on, no reviewGate` throw message); `test/do.test.ts:561` (the twin `do`-side pin: `config-error`, `.not.toBe('agent-failed')` — mirror it on the `run` side); the existing `test/run.test.ts` / `test/run-loop.test.ts` concurrency tests (for the house harness pattern to reuse).
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter; temp `workspacesDir`; `isolatePiAgentDir`; assert the real shared dirs are untouched). "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim run-internal-error-tests --arbiter origin
git fetch origin && git switch -c work/run-internal-error-tests origin/main
git mv work/in-progress/run-internal-error-tests.md work/done/run-internal-error-tests.md
```

---

### Drift history (provenance — kept, not active)

The original slice's criterion #2 + Open question asserted `status: 'agent-failed'` for the thrown core error and asked whether it should get a distinct status. The build agent (2026-06-11) STOPPED, correctly: commit `3e7df84` (2026-06-09, after this slice was authored) already routed `run`'s `saveAgentFailure` through `classifyFailureCause`, making the status `config-error` and closing the `do`-vs-`run` divergence the source observation flagged. Re-scoping (above) PINS the current `config-error`/`claim-error` labels and drops the resolved Open question; the source observation is to be marked RESOLVED on landing, not deleted on the stale basis.
