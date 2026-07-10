---
title: do prd:<slug> must NOT re-gate an EXPLICITLY-named PRD on the autoSlice policy — match the build path (the policy gates the AUTO-PICK pool only, not an explicit named target)
slug: explicit-do-prd-not-gated-by-autoslice
blockedBy: []
covers: []
---

## What to build

Fix the build/slice **gate asymmetry**: `do prd:<slug>` currently refuses an EXPLICITLY-named PRD when the repo's `autoSlice` policy is off, but `do <slice>` (build) does NOT refuse an explicitly-named slice on `allowAgents`. The contract is that `autoSlice`/`allowAgents` are the **auto-pick / pool-eligibility** policy ("may an agent slice/claim _UNDECLARED_ items here?") — they gate the `run` / `do` auto-pick / CI pool, NOT a target the operator explicitly typed. The slice path drifted by re-applying the policy on the explicit form; this slice removes that re-gate so the two paths are symmetric.

End-to-end behaviour after this slice:

- `do prd:<slug>` (an EXPLICITLY-named PRD) **slices regardless of the `autoSlice` policy** — naming the PRD IS the authorization, exactly as `do <slice>` builds a named slice regardless of `allowAgents`. (No more `DORFL_AUTO_SLICE=true` workaround for an explicit slice-now.)
- The **item-readiness axes still bind** on the explicit path: a `humanOnly: true` PRD (a human must drive the slicing) and a `needsAnswers: true` PRD (open questions) are STILL refused for the agent `doer`, and `sliceAfter` ordering is STILL enforced. Only the repo's `autoSlice` POLICY is dropped from the explicit path. (These are the PRD's own readiness, not the repo's auto-pick policy.)
- The **auto-pick pool is UNCHANGED**: `do` (no arg) / `do -n <x>` still build the sliceable-PRD pool through `autoslice-gate`'s predicate (which includes `autoSlice`) in `do-autopick.ts`, so an unselected/ineligible PRD is still never auto-picked. The policy keeps doing its real job (pool eligibility) — it just stops double-gating the explicit named dispatch.
- The HUMAN `doer` path is unchanged (already unbound by the gate).

This mirrors the build path EXACTLY: `allowAgents` is consumed only in the scan/selection/eligibility path (`eligibility.ts` / `scan.ts` / `categorise.ts` — the pool), never in `performDo`'s explicit claim path. `autoSlice` should be consumed the same way — in `do-autopick.ts`'s pool selection, not in `performSlice`'s per-invocation gate.

## Acceptance criteria

- [ ] `do prd:<slug>` on an explicitly-named PRD slices with `autoSlice` OFF (no config, no env) — asserted via a test that drives the explicit path with the policy unset and confirms it proceeds to the lock/agent (not `gate-refused`).
- [ ] A `humanOnly: true` PRD is STILL refused on the explicit agent path; a `needsAnswers: true` PRD is STILL refused; an unsatisfied `sliceAfter` is STILL refused — only the `autoSlice` policy axis is removed from the explicit gate.
- [ ] The auto-pick PRD pool (`do` / `do -n`) STILL filters by `autoSlice` (a PRD ineligible by the policy is never auto-picked) — assert the pool path is unchanged (the `do-autopick`/`selectPrioritised` PRD-pool test still gates on `autoSlice`).
- [ ] The build path is unaffected (regression guard): `do <slice>` behaviour vs `allowAgents` is unchanged.
- [ ] Tests mirror the repo's existing style (the `slicing.ts` gate tests + the `do-autopick` pool tests; throwaway-git / stubbed-harness as those suites do).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Independent of advance-loop (it un-breaks the explicit slice-now ergonomic the conductor/human relies on TODAY). advance-loop's `advance-drivers-and-gates` slice will later state the same rule ONCE for build/slice/triage uniformly; this slice fixes the slice-path instance now.

## Prompt

> Fix a build/slice GATE ASYMMETRY: `do prd:<slug>` refuses an EXPLICITLY-named PRD when the repo's `autoSlice` policy is off, but `do <slice>` (build) does NOT refuse an explicitly-named slice on `allowAgents`. The contract (`docs/adr/methodology-and-skills.md` §4; `work/spec-sliced/auto-slice.md` §57) is that `autoSlice`/`allowAgents` gate "may an agent slice/claim _UNDECLARED_ items here?" — i.e. the AUTO-PICK / pool / CI path, NOT a target the operator explicitly typed. The slice path drifted by re-applying the policy on the explicit form. Make the two paths symmetric: an explicitly-named `do prd:<slug>` slices regardless of `autoSlice` (naming it IS the authorization), exactly as `do <slice>` builds regardless of `allowAgents`.
>
> WHAT STILL BINDS on the explicit path (do NOT remove these): the PRD's own readiness axes — `humanOnly: true` (a human must drive the slicing) and `needsAnswers: true` (open questions) STILL refuse the agent `doer`, and `sliceAfter` ordering STILL enforced. ONLY the repo's `autoSlice` POLICY is dropped from the explicit path. The HUMAN `doer` path is already unbound — leave it.
>
> WHERE TO LOOK (by concept; verify — paths may have drifted):
>
> - `src/slicing.ts` `performSlice` step 1 ("RESOLVE THE GATE", `doer === 'agent'`): it calls `resolveAgentGate(cwd, slug, prdFm, options.autoSlice)` → `resolveSlicingEligibility({humanOnly, needsAnswers, sliceAfter, slicedSlugs, autoSlice})`, predicate `needsAnswers !== true && humanOnly !== true && autoSlice`. This is the over-gate. Drop the `autoSlice` policy term from the EXPLICIT-named path while keeping `humanOnly`/`needsAnswers`/`sliceAfter`. Decide the cleanest seam: e.g. the explicit `performSlice` call passes "policy already satisfied / explicit" so the gate evaluates only the item-readiness axes + `sliceAfter`, OR split `resolveSlicingEligibility` so the policy term is applied by the POOL caller, not the per-invocation gate. Keep `gateRefusalReason` honest for the axes that DO still refuse.
> - `src/do.ts` (`resolved.namespace === 'prd'` → `performSlice`, do.ts ~457): the explicit dispatch. This is the call site that must NOT carry the policy gate.
> - `src/do-autopick.ts` (`performDoAuto`): the AUTO-PICK pool — it builds the sliceable-PRD pool via `autoslice-gate`'s predicate (incl. `autoSlice`). This must stay (the pool is where the policy legitimately lives). A PRD selected FROM the pool then dispatches into the same `performSlice`; ensure removing the per-invocation gate does NOT let a pool-ineligible PRD through (it can't be auto-picked in the first place, but confirm the pool filter is the single enforcement point).
> - PRECEDENT (mirror it): `allowAgents` is consumed ONLY in `eligibility.ts` / `scan.ts` / `categorise.ts` (the scan/selection/pool), NEVER in `performDo`'s explicit claim path. `autoSlice` should match — pool-only.
>
> SEAM TO TEST AT: the `slicing.ts` gate unit tests (assert the explicit agent path slices with `autoSlice` off, but still refuses `humanOnly`/`needsAnswers`/unsatisfied `sliceAfter`) + the `do-autopick` PRD-pool tests (assert the pool STILL filters on `autoSlice`). Throwaway-git / stubbed-harness per the house style.
>
> SCOPE FENCE: do NOT touch the auto-pick pool's `autoSlice` filtering (it stays). Do NOT touch the build path / `allowAgents`. Do NOT rename `allowAgents`→`autoBuild` (that is advance-loop's `rename-allowagents-to-autobuild`, sequenced last). Do NOT change the slicing LOCK or the human path. This is the slice-path instance of the rule; the uniform statement across build/slice/triage is advance-loop's `advance-drivers-and-gates`.
>
> FIRST run the drift check (launch snapshot): confirm `performSlice` step 1 still gates the explicit path on `options.autoSlice` via `resolveAgentGate`, and that `do-autopick.ts` still filters the PRD pool on the same predicate. If the gate already moved to pool-only (someone fixed it), or the seam landed differently, route this slice to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal") rather than building on a stale premise.
>
> "Done" = `do prd:<slug>` explicit slices with `autoSlice` off while still honoring `humanOnly`/`needsAnswers`/`sliceAfter`, the auto-pick pool still gates on `autoSlice`, the build path is unchanged, tests cover all of it, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Source

Spotted during the `do spec:advance-loop` orchestrate sitting (2026-06-09); captured in `work/observations/explicit-do-prd-still-gated-by-autoslice-vs-autopick-eligibility.md` (see its "Update 2026-06-09" — reading A confirmed, the build/slice asymmetry is the bug). Contract basis: `docs/adr/methodology-and-skills.md` §4, `work/spec-sliced/auto-slice.md` §57.
