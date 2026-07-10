---
title: advance — the TWO drivers (one-shot sequential + loop) over the tick, `-n` ALWAYS sequential, the FLAT per-action gate family (build/slice/triage), isolation+chaining fall out of the seam
slug: advance-drivers-and-gates
spec: advance-loop
blockedBy: [advance-rung-triage, mirror-side-eligible-pool-scan]
covers: [2, 7, 22, 23, 25, 26, 31]
---

## What to build

The two DRIVERS that wrap the tick, plus `-n` (always sequential), the FLAT per-action gate family, and the bare/eligible-set selection (consuming the mirror-side pool scan). This is the slice that makes `advance` a complete, demoable verb: `ls work/questions/` becomes the live dashboard, the eligible pool drains autonomously, and the loop provably idles at rest.

It is sequenced AFTER the rungs (it drives them) and after the pool scan (it selects over it). It wires the gate composition for all rungs.

### Precise scope

- **One substrate-agnostic TICK, two drivers (US #7).** The tick is the classify→lock→execute contract (already built across the classifier + rungs). Add:
  - a **one-shot driver** (human `do`-style + a CI invocation) that runs the tick over named item(s) SEQUENTIALLY;
  - a **loop driver** (the `run` daemon) that loops the tick over the eligible set (consuming `mirror-side-eligible-pool-scan`) with genuine parallelism, each item lock-guarded by the `advancing` borrow.
  - `run` ≡ CI, differing only in substrate; the tick is the shared contract — NO new execution model.
- **`-n x` is ALWAYS SEQUENTIAL (US #25)** for BOTH `do -n` and `advance -n` — a dumb "run the tick N times" loop. Parallelism is NEVER a property of `-n` (it comes only from `run` or the CI matrix). Remove the inline `-n`×`--remote` refusal placeholder now that the mirror-side scan exists (the thin `do --remote -n` caller also falls out here or as a sibling — see Decisions).
- **`advance` bare-form** (eligible set) selects over the pool scan and runs the tick per item (sequential one-shot, or parallel under `run`).
- **The FLAT per-action gate family (US #23):** each rung RESPECTS its gate — build obeys `allowAgents`, slice obeys `autoSlice`, auto-triage obeys `autoTriage`; SURFACE + APPLY are ALWAYS allowed. A repo with every flag off still gets the QUESTION LOOP (surface + apply) but no autonomous build/slice/triage ("question loop with zero autonomy"). Wire the gate checks at the driver/tick dispatch (each rung's gate resolved through the standard chain).
- **Isolation + chaining FALL OUT of what exists (US #26):** isolation = the `isolation-strategy-seam` (worktree locally / fresh CI checkout); chaining = the existing rebase-before-integrate (ADR §10). A chain conflict routes to needs-attention as today. Build NO new isolation/chaining machinery — just consume the seam.
- **Lock discipline (US #22):** the `advancing` lock is MANDATORY for the autonomous (loop/CI) driver, a no-op formality for a solo human; the per-repo "agents may advance here" policy signals a contender may be active.
- **Convergence (US #31):** the loop provably DRAINS — every tick advances toward a terminal, surfaces+idles, or no-ops on pending; the candidate pool shrinks monotonically as answers arrive and is STABLE when there are none.

## Acceptance criteria

- [ ] One substrate-agnostic tick, two drivers: a one-shot (named items, SEQUENTIAL) and a loop (`run`, eligible set via the mirror-side pool scan, parallel, each item `advancing`-lock-guarded). `run` ≡ CI (same tick).
- [ ] `-n x` is ALWAYS SEQUENTIAL for both `do -n` and `advance -n`; parallelism is never a property of `-n`. The inline `-n`×`--remote` refusal placeholder is removed (the mirror-side scan now backs it).
- [ ] `advance` bare-form selects over the pool scan and runs the tick per eligible item.
- [ ] Each rung RESPECTS its gate (build→`allowAgents`, slice→`autoSlice`, auto-triage→`autoTriage`); SURFACE + APPLY are ALWAYS allowed even with all flags off (the question-loop-with-zero-autonomy case proven).
- [ ] Isolation = the isolation-strategy seam; chaining = rebase-before-integrate; a chain conflict → needs-attention. NO new isolation/chaining machinery.
- [ ] The `advancing` lock is MANDATORY for the autonomous driver, a no-op for a solo human.
- [ ] Convergence: a pending-sidecar pool is STABLE (idles, no thrash); the pool shrinks monotonically as answers arrive (a drain test over a fixture pool).
- [ ] Tests: one-shot sequential `-n`; loop over the pool; gate composition (each rung obeys its gate; surface/apply always allowed with flags off); the drain/idle convergence; the lock mandatory-for-driver / no-op-for-human. House CAS-seam + throwaway-repo + stubbed-harness style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-rung-triage` — the LAST rung; the drivers drive all rungs and wire the gate family (including `autoTriage` introduced there). (Transitively after the surface/apply rungs, the verb, the tick, the lock, the sidecar.)
- `mirror-side-eligible-pool-scan` — the loop + bare-form select over it.

## Prompt

> Build the two DRIVERS over the advance tick (one-shot sequential + loop), `-n` ALWAYS sequential, the FLAT per-action gate family, and the bare/eligible-set selection. Read the PRD `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("One substrate-agnostic TICK, two drivers", "Two drivers + -n + CI", "Repo-config: a FLAT per-action gate family", US #2/7/22/23/25/26/31). The tick (classifier + rungs) is already built; this slice WRAPS it. `run` ≡ CI (same tick, different substrate; no new execution model). `-n` is ALWAYS sequential for both `do` and `advance` — parallelism is only `run` or the CI matrix; remove the inline `-n`×`--remote` refusal (the mirror-side scan now backs it). Each rung RESPECTS its gate (build→`allowAgents`, slice→`autoSlice`, auto-triage→`autoTriage`); surface + apply ALWAYS allowed (the zero-autonomy question loop). Isolation = the isolation-strategy seam; chaining = rebase-before-integrate (ADR §10); chain conflict → needs-attention; build NO new isolation/chaining machinery. The `advancing` lock is MANDATORY for the autonomous driver, a no-op for a solo human. The loop provably DRAINS (monotonic pool shrink; stable/idle at rest).
>
> READ FIRST: `packages/dorfl/src/run.ts` (the existing concurrent loop driver
>
> - the do/run convergence — the loop wraps the tick), `packages/dorfl/src/do.ts`
> - `do-autopick.ts` (the one-shot + `-n` + autopick path), `integration-core.ts` (`performIntegration` — the shared gate→integrate back-half), `isolation.ts` (the isolation-strategy seam), `repo-config.ts` (the gate resolution chain), the mirror-side pool scan from `mirror-side-eligible-pool-scan`, the verb + rungs from the advance slices, and the inline `-n`×`--remote` refusal in `cli.ts` to remove.
>
> FIRST, check this slice against current reality (drift). The do/run convergence, the isolation seam, and `do prd:`-through-integration are LANDED substrate (PRD 2026-06-09 UPDATE). If they landed differently, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim advance-drivers-and-gates --arbiter origin
git fetch origin && git switch -c work/advance-drivers-and-gates origin/main
git mv work/in-progress/advance-drivers-and-gates.md work/done/advance-drivers-and-gates.md
```

## Needs attention

acceptance gate failed (exit 1)

## Requeue 2026-06-11

False gate red: 1564/1565 passed; the ONE failure is the KNOWN flake 'a same-slug new-item race ⇒ exactly one promote creates' (test/advance-triage.test.ts CAS-race timing under full parallel suite — see work/observations/advance-triage-same-slug-race-flaky-under-full-suite.md; passes deterministically in isolation; pre-existing from the triage slice, NOT this slice's work). Re-run.

## Needs attention

acceptance gate failed (exit 1)

## Needs attention

PR/code review (Gate 2) blocked this work:
- The loop driver (advanceOnce in advance-loop-driver.ts) is built and unit-tested but wired into NOTHING — `grep advanceOnce` finds no consumer outside its own module/test, run.ts is untouched, and the `run` command still drives only the build tick (runOnce/runLoop). The slice is titled 'the TWO drivers (one-shot + loop)' and AC #1 explicitly requires 'a loop (`run`, ... parallel ...). `run` ≡ CI (same tick).' Should this be blocked until advanceOnce is actually wired into `run`/CI with an integration test, or should the slice be reshaped to put the loop driver out of scope? (advance-loop-driver.ts:108 (advanceOnce); run.ts untouched on this branch (git diff --stat shows no run.ts); advanceOnce's signature (AdvanceOnceOptions→AdvanceBatchResult) does not match the existing RunTick swap seam (RunOnceOptions→RunOnceResult). The slice's 'demoable verb' / 'eligible pool drains autonomously' claim is unreachable for the loop path; only `advance -n` (one-shot sequential) drains.)
- The sole commit is 'chore(advance-drivers-and-gates): save aborted work (wip)' with no PR description and no `## Decisions` block — the agent's own signal that the work is incomplete. Is this branch actually finished, or was it landed for review prematurely? (git log main..HEAD shows exactly one commit, message 'save aborted work (wip)'. Gate-1 (build/test/format) passing on a WIP-titled commit is precisely the situation where a green gate masks an unfinished deliverable.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).

## Requeue 2026-06-12

Gate-2 found a REAL gap (not the flake — gate-1 now passes 1598/1598). The one-shot driver (performAdvanceAuto/performAdvanceArgs in advance-drivers.ts, advance -n sequential) is wired into cli.ts and DONE. But the LOOP driver — advanceOnce in advance-loop-driver.ts — is built + unit-tested yet wired into NOTHING (zero consumers; run.ts is untouched on the branch). AC #1 explicitly requires 'a loop (run, eligible set via the mirror-side pool scan, parallel, each item advancing-lock-guarded). run ≡ CI (same tick).' FIX: wire the loop driver into run via the EXISTING swap seam — run.ts already defines 'export type RunTick = (RunOnceOptions) => Promise<RunOnceResult>' and runLoop() is deliberately written against RunTick (see run.ts:920-928,947 'so the advance-loop PRD can later swap the tick') with 'tick' injectable in RunLoopOptions. Reconcile advanceOnce's AdvanceOnceOptions->AdvanceBatchResult signature to that seam (adapt at the seam or align the types) so 'run' can drive the advance tick over the mirror-side eligible pool, each item advancing-lock-guarded. Add an INTEGRATION test proving the loop drains the eligible pool (monotonic shrink) and idles/stable at rest with no pending. Keep '-n ALWAYS sequential' for both do and advance; parallelism comes only from run/CI. Do NOT restart — CONTINUE from this branch's good one-shot work and ADD the loop wiring + its convergence test. Finish with a real commit message + a ## Decisions block (the prior commit was 'save aborted work (wip)').
