---
title: wire in-place `do` onto the IsolatedTree seam — the one remaining seam consumer (run + do --remote already adopted it); the convergence the advance tick wraps
slug: do-run-share-isolation-seam
spec: command-surface-phase-2
covers: []
---

> **RE-SCOPED 2026-06-07** (human re-scope from needs-attention). The original slice assumed a large three-way convergence (route `run` + `do --remote` + in-place `do` onto the seam, "fold in `do-remote`'s Option-A glue", "give the seam its first two consumers"). The build agent ran the slice's own drift-check and correctly STOPPED: **two of those three are already done.** `run.ts` already routes through `jobWorktreeStrategy(...).prepare()` → the `IsolatedTree` handle → `tree.teardown()` (landed in `run-daemon-reframe` + the integration-core convergence; `run` does NOT call `createJob`), and `performDoRemote` already uses the same handle (landed in `do-remote` — there is no Option-A glue left to fold in). The seam ALREADY has two production consumers. See `work/observations/do-run-share-isolation-seam-premise-drifted.md` (on the preserved `work/do-run-share-isolation-seam` branch) for the full report.
>
> The genuine remaining gap is NARROW and is what this re-scoped slice builds: **the ONE consumer still off the seam is in-place `do` (`performDo`), which composes `performStart`/`performComplete` against a literal `cwd`.** `selectIsolationStrategy`
>
> - `inPlaceStrategy` exist but have ZERO production consumers (only `isolation.test.ts`
> - re-exports in `index.ts`). Wire in-place `do` onto the seam so all THREE forms (run, do --remote, in-place do) finally share the one handle-driven shape.

## What to build

Route **in-place `do` (`performDo`) through the isolation seam** — give `selectIsolationStrategy`/`inPlaceStrategy` their first production consumer — so the in-place worker onboards via the SAME `IsolatedTree` handle the other two forms use, instead of its bespoke literal-`cwd` composition. Behaviour-preserving: no user-visible change to in-place `do`.

### The narrow change

Today `performDo` (`src/do.ts`) does, against a literal `cwd`: dirty-tree refusal → divergence guard → `performStart` (claim + onboard) → agent → `performComplete`. `inPlaceStrategy.prepare()` already does the **onboarding** half of `performStart` (fetch + continue-detection + fresh-main `work/<slug>` switch, incl. the §14 continue/rebase path) but **deliberately does NOT claim** (its doc: "assumes the slug is already CLAIMED … does not itself claim"). So this is a composition change, not a new mechanism — and `do-remote` already proved the exact pattern.

- **Adopt the `do-remote` claim↔prepare composition** (the precedent to mirror, NOT reinvent): CLAIM first, then `strategy.prepare()` onboards the (now-claimed) branch. Concretely for in-place: select `inPlaceStrategy` via `selectIsolationStrategy({checkout: cwd, arbiter})`, claim (only if needed), then `strategy.prepare({slug})` to put the checkout on `work/<slug>` off fresh main, and run the agent + `performComplete` against `tree.dir` (== the checkout). The handle's NO-OP `teardown` replaces the (already no-op) in-place teardown.
- **Keep the two in-place GUARDS that the seam does NOT own** — they are in-place-`do` policy, not isolation, and MUST remain (do not push them into the strategy): the **dirty-tree refusal** and the **pre-flight diverged-`main` guard** (with `--ignore-diverged-main`). They run BEFORE prepare, exactly as today.
- **Preserve in-place `do`'s claim semantics.** `performStart` today claims + onboards as one step; `inPlaceStrategy.prepare()` onboards WITHOUT claiming. So the claim must move to an explicit step before `prepare` (mirroring `do-remote`'s claim-first), and the lost/contended/refused/needs-attention outcomes `performStart` surfaced must be preserved verbatim (same exit codes 2/3, same in-progress-without-resume refusal, same §10 continue-rebase-conflict → needs-attention). Reuse `performClaim` + the continue-detection the strategy already does; do NOT weaken or duplicate the claim CAS.

### The design tension to resolve EXPLICITLY (do not leave it dangling — it is why the original stalled)

In-place `do` currently leans on `performStart` for BOTH claim AND onboarding; `inPlaceStrategy.prepare()` gives onboarding only. Resolve it the way `do-remote` did: **claim explicitly (via `performClaim`), then let the strategy onboard.** Decide and document which piece owns what:

- claim + the two in-place guards (dirty, divergence) → the `do` driver (before prepare);
- fetch + continue-detection + fresh-main branch switch → `inPlaceStrategy.prepare()` (it already does this — confirm it MATCHES what `performStart` did for the in-place case, including the §14 continue + rebase-conflict-flag path, so behaviour is identical);
- agent run + gate + done-move + rebase + integrate → unchanged (`performComplete` against `tree.dir`).

If `inPlaceStrategy.prepare()`'s onboarding turns out to NOT be byte-equivalent to `performStart`'s in-place onboarding (e.g. a refusal/outcome `performStart` surfaced that the strategy doesn't), that gap is the real work — close it in the strategy (so the seam is honestly equivalent) rather than papering over it in the driver, and add a test pinning the equivalence. If it IS equivalent, the driver change is small.

### Scope fence

- IN: route in-place `do` (`performDo`) onto `selectIsolationStrategy`/`inPlaceStrategy` with the claim-first composition; keep the dirty + divergence guards in the driver; preserve every in-place `do` outcome (lost/contended/refused/needs-attention/ continue-rebase-conflict) byte-for-byte.
- OUT: `run` and `do --remote` (ALREADY on the seam — do NOT touch their working, tested paths); changing `inPlaceStrategy`/`jobWorktreeStrategy`'s behaviour beyond closing a proven onboarding-equivalence gap; any user-visible change.

> **FORWARD-POINTER (advance-loop) — this is the load-bearing convergence the advance tick wraps.** With in-place `do` on the seam, ALL THREE forms (run, do --remote, in-place do) share the one `IsolatedTree`-handle post-claim shape — so a reviewer can point at "this handle-driven pipeline IS the tick both drivers wrap", and the `advance-loop` PRD (`work/prd/advance-loop.md`, `sliceAfter: [auto-slice]`) slices WITHOUT amending the PRD. Shape the in-place adoption so the shared post-claim pipeline reads the handle uniformly (the future `advance` tick invokes it); do not add an in-place-only special case back in.

## Acceptance criteria

- [ ] In-place `do` (`performDo`) onboards via `selectIsolationStrategy({checkout})` → `inPlaceStrategy` → the `IsolatedTree` handle; it no longer composes `performStart`'s onboarding against a literal `cwd`. `selectIsolationStrategy`/ `inPlaceStrategy` now have a real production consumer (not just tests).
- [ ] The claim moves to an explicit pre-`prepare` step (the `do-remote` claim-first pattern); the claim CAS is reused, not weakened or duplicated.
- [ ] The dirty-tree refusal AND the pre-flight diverged-`main` guard (`--ignore-diverged-main`) remain in the `do` driver, BEFORE prepare — unchanged.
- [ ] Every in-place `do` outcome is preserved byte-for-byte: completed; lost (exit 2); contended (exit 3); refused (in-progress without `--resume`, dirty, diverged, done/absent); the §10 continue-rebase-conflict → needs-attention; the success integrate (propose/merge) — all identical to today.
- [ ] `run` and `do --remote` are UNTOUCHED (their existing tests pass unchanged); no duplicate isolation logic is introduced.
- [ ] If `inPlaceStrategy.prepare()`'s onboarding was not already equivalent to `performStart`'s in-place onboarding, the gap is closed IN THE STRATEGY and a test pins the equivalence.
- [ ] **Test isolation:** in-place/do tests keep temp `workspacesDir` + `isolatePiAgentDir`; the real `~/.dorfl/` + `~/.pi/agent/sessions/` are untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Prompt

> Route **in-place `do` (`performDo`)** through the isolation seam (`src/isolation.ts`): give `selectIsolationStrategy`/`inPlaceStrategy` their FIRST production consumer, so in-place `do` onboards via the `IsolatedTree` handle like the other two forms — instead of composing `performStart`/`performComplete` on a literal `cwd`. Behaviour-preserving: no user-visible change to in-place `do`.
>
> CRITICAL DRIFT CONTEXT (the original slice was stale; this is the re-scoped gap): `run` and `do --remote` are ALREADY on the seam (`run.ts` and `performDoRemote` both use `jobWorktreeStrategy(...).prepare()` + `tree.teardown()`; `run` does NOT call `createJob`; there is NO `do-remote` Option-A glue left). Do NOT touch them. The ONLY consumer off the seam is in-place `do`. Confirm this yourself first (grep `createJob` in run.ts → none; grep `selectIsolationStrategy`/`inPlaceStrategy` consumers → only tests + index.ts re-exports). Read `work/observations/do-run-share-isolation-seam-premise-drifted.md` (on the preserved branch) for the prior agent's report.
>
> THE COMPOSITION (mirror `do-remote`, do not reinvent): `inPlaceStrategy.prepare()` already does the ONBOARDING half of `performStart` (fetch + continue-detection + fresh-main `work/<slug>` switch, incl. the §14 continue/rebase path) but deliberately does NOT claim. So: keep the dirty-tree + diverged-main guards in the `do` driver (BEFORE prepare); CLAIM explicitly via `performClaim` (only if needed); then `selectIsolationStrategy({checkout: cwd, arbiter}).prepare({slug})`; then run the agent + `performComplete` against `tree.dir`. Preserve EVERY existing in-place `do` outcome byte-for-byte (completed / lost=2 / contended=3 / refused / §10 continue-rebase-conflict→needs-attention / propose+merge integrate). If `inPlaceStrategy.prepare()`'s onboarding is not already equivalent to `performStart`'s in-place onboarding, CLOSE THE GAP IN THE STRATEGY (+ a pinning test), not in the driver.
>
> READ FIRST: `src/isolation.ts` (`inPlaceStrategy`, `selectIsolationStrategy`, `IsolatedTree` — the prepare/teardown the in-place driver will call); `src/do.ts` (`performDo` — the literal-`cwd` composition to replace; AND `performDoRemote` + its claim-first/`prepare`/`performStart(resume)` precedent to mirror); `src/start.ts` (`performStart` — the claim + in-place onboarding whose pieces you are splitting: claim → driver, onboarding → strategy); `src/claim-cas.ts` (`performClaim`); `src/complete.ts` (`performComplete`, unchanged, runs against `tree.dir`).
>
> IF the slice is wrong again, STOP and report (route to needs-attention) — do not churn `run`/`do --remote`.
>
> TDD with vitest, house style (throwaway repos + local `--bare` arbiter, stubbed harness, temp `workspacesDir`, `isolatePiAgentDir`): in-place `do` runs end-to-end through the seam; the dirty + divergence guards still refuse; lost/contended/refused/ continue-rebase-conflict outcomes are identical; `run` + `do --remote` tests pass unchanged; real shared dirs untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

This item is in `work/needs-attention/` with its work branch preserved on the arbiter. Recover via the human face: `dorfl requeue do-run-share-isolation-seam` (the re-scoped body above will be re-claimed). The original premise-drift report stays on the preserved `work/do-run-share-isolation-seam` branch.

```sh
dorfl requeue do-run-share-isolation-seam --arbiter origin   # → backlog, branch kept
# then build it (continues from the kept branch, with this re-scoped body):
dorfl do slice:do-run-share-isolation-seam --harness pi --review --propose
```

## Needs attention

PR/code review (Gate 2) blocked the first attempt — correctly. The build agent ran the slice's own drift-check and STOPPED with a precise report (the convergence the slice asked for was already done; the real gap is narrow). Re-scoped above to that real gap on 2026-06-07. NOTE: the first attempt reached needs-attention via Gate-2 rather than a first-class STOP signal — that runner gap is captured separately in `work/observations/agent-stop-on-drift-not-honored-by-runner.md` and sliced as `work/backlog/agent-stop-signal.md`.
