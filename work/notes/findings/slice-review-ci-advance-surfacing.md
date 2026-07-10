---
title: Review verdict — the two CI-advance-surfacing slices (B foundation, A propose-matrix)
type: finding
status: incubating
source: review skill applied 2026-06-16 against work/backlog/{advance-in-place-publishes-treeless-results,ci-propose-matrix-enumerates-lifecycle-items}.md, the SPEC work/spec-sliced/ci-advance-surfaces-questions-not-only-builds.md, and packages/dorfl/src (advance.ts, advance-drivers.ts, advance-isolated.ts, advance-loop-driver.ts, advance-treeless-publish.ts, lifecycle-gather.ts, lifecycle-pools.ts, scan.ts, format.ts)
---

Adversarial review of the two slices, per the `review` lenses. Verdict per slice
below; the load-bearing findings are A2 + A3 (slice A) and B1 (slice B).

## Slice B — `advance-in-place-publishes-treeless-results`

VERDICT: **approve with one required edit** (B1 is a real gap; B2/B3 are nits).

Claim-vs-reality is SOUND: `AdvanceResult.rung` exists (advance.ts:293), the
in-place drivers genuinely lack the push (`grep` = 0 hits), `pushTreelessResult` +
`TREELESS_RUNGS` exist and are called by exactly the `--isolated` + loop drivers.
The premise holds; no drift.

- **B1 (blocking) — the `apply`-is-sometimes-a-promote case is unaddressed.** The
  `apply` rung is in `TREELESS_RUNGS`, BUT when an observation's answer is a
  `promote-slice`/`promote-adr`, the apply rung does NOT commit tree-less — it runs
  `promoteObservation`, which is its OWN CAS straight to the arbiter (advance.ts
  ~655; the isolated driver's own header, lines 55-57, calls this out: "observation
  →promote new-item creation … they target the arbiter" SEPARATELY from the
  tree-less commit). The existing drivers STILL call `pushTreelessResult` for every
  `apply` (they gate purely on `TREELESS_RUNGS.has(rung)`), and it is SAFE there
  only because an ff-push of a HEAD with nothing new is a clean no-op. Slice B must
  (a) mirror that exact gating (push on `TREELESS_RUNGS` regardless of the
  promote-vs-resolve distinction — do NOT add a cleverer guard) and (b) add an
  acceptance criterion + test for the promote-apply case asserting the in-place
  push is a harmless no-op and does NOT double-publish / clobber the promote CAS.
  As written, the slice's acceptance never mentions promote, so a builder could
  "helpfully" special-case it and diverge from the proven drivers. Pin it.

- **B2 (non-blocking) — arbiter is on `AdvanceContext`, confirm it threads.** The
  push needs the arbiter; `runSelectedInSequence` strips multi-only fields via
  `sharedAdvanceContext` but KEEPS `arbiter` (it is a plain `AdvanceContext`
  field). The slice is correct, but its prompt should name `AdvanceContext.arbiter`
  as the source so the builder does not thread a new param.

- **B3 (non-blocking) — name the exact hook site.** Two in-place entry points need
  the push: the per-item loop in `runSelectedInSequence` (covers `-n`/auto-pick AND
  multi-arg) and the single-named-item `performAdvance` path in the CLI. Hooking
  ONLY `runSelectedInSequence` would miss a single `advance slice:foo` (one named
  item does not go through the sequence runner). The slice says "performAdvanceAuto
  AND performAdvance" — correct — but should call out that the single-item CLI path
  (`args.length === 1` → bare `performAdvance`) is the easy-to-miss one.

## Slice A — `ci-propose-matrix-enumerates-lifecycle-items`

VERDICT: **block** (A2 + A3 are spec defects that would mislead a builder).

- **A1 (non-blocking) — reuse the EXISTING gather seam, don't re-derive.** The slice
  says "compute via `buildLifecyclePools`" but omits the real seam: `lifecycle-gather.ts`
  already has `gatherLifecycleInPlace` (sync, working tree) AND `gatherLifecycleMirror`
  (async, bare mirror) that resolve observations + `needsAnswers` items + each
  sidecar and hand them to `buildLifecyclePools` — for BOTH the in-place and
  mirror sides scan needs. A builder following the slice as written may re-derive
  sidecar resolution (a lens-4c duplicate-concept defect). Pin `gatherLifecycle*`
  as the reuse target in the slice prompt + an acceptance criterion ("no forked
  sidecar resolution; reuse gatherLifecycle{InPlace,Mirror}").

- **A2 (blocking) — the `apply` pool in propose mode is UNDER-SPECIFIED, and the
  story-4 on-answer loop may not actually close in propose mode.** The slice title +
  body waffle: "surface / triage / apply" and "(and apply)". But an `apply` item has
  an ALL-ANSWERED sidecar, so it is neither `eligible` (build pool) nor a surface
  candidate — and it is unclear whether an `apply` item should become a propose
  matrix leg at all. Story 4 (SPEC) wants the on-answer-committed `push:
  work/questions/**` trigger to re-run the loop and APPLY the answer. In PROPOSE
  mode that push fires `enumerate` → the matrix; if the matrix does NOT enumerate
  apply items, the answer is never applied on the propose path (only the merge `-n`
  job applies it). So either (i) slice A MUST emit `slice:`/`prd:` legs for
  all-answered (apply) items too, or (ii) the SPEC must concede that apply-in-propose
  is out of scope and story 4 is merge-only. This is a genuine design fork the slice
  silently straddles. RESOLVE it: decide whether the propose matrix enumerates apply
  items, state it, and adjust the title (currently claims apply) + acceptance.
  Recommendation: emit apply legs too (one leg `advance <id> --propose` applies the
  answer and tree-less-pushes via slice B) so the on-answer loop closes identically
  in both modes — but this is a decision to RATIFY, not assume.

- **A3 (blocking) — "mirror into the emitted .github copy byte-identically" needs a
  parameterisation caveat.** The seed is a TypeScript template-literal generator
  (`generateAdvanceLifecycleWorkflow`) that interpolates `${setupWith}` (provider
  secrets). The emitted `.github/workflows/advance-lifecycle.yml` is NOT
  byte-identical to the template SOURCE — it is the template's OUTPUT. The slice's
  acceptance ("seed and emitted copy stay byte-identical") is wrong as phrased: the
  builder must regenerate the emitted workflow from the updated generator (or hand-
  mirror the rendered change), not diff the .ts against the .yml. Re-phrase to
  "regenerate the emitted workflow from the updated generator; the emitted copy
  reflects the new `jq`."

- **A4 (non-blocking) — disjointness claim is correct but worth a guard test.** A
  `needsAnswers` item is `eligible:false` (verified, eligibility.ts) so it cannot
  also be a build leg, and observations are a separate `obs:` namespace — so no
  double-leg. Good. Keep the `unique` + the disjointness acceptance test (already
  present); no change needed.

## Cross-slice / destination check (lens 5)

- The B-before-A dependency is correct and load-bearing: A's end-to-end acceptance
  ("a propose leg's sidecar reaches the arbiter") is only true once B lands. Good.
- Coverage gap surfaced by A2: SPEC story 4 (apply the committed answer) is NOT
  cleanly delivered on the propose path unless A2 is resolved to enumerate apply
  legs. Until then, the decomposition does NOT provably reach the SPEC end-state in
  propose mode — exactly the lens-5 hole that must block.

## Routing recommendation

- Slice B: set `needsAnswers: true` with B1 (the promote-apply criterion) listed,
  OR just fold B1's criterion + B2/B3 prompt clarifications in directly (cheap, no
  human judgement needed — they are spec tightenings, not open questions).
- Slice A: set `needsAnswers: true` with the A2 fork (does the propose matrix
  enumerate apply items? — the story-4 closure question) as the listed open
  question, and fold in A1 + A3 (both are unambiguous corrections, not questions).

## Resolution (2026-06-16)

All findings folded into the slices; both remain agent-buildable (no
`needsAnswers` left):

- **B1/B2/B3 folded** into `advance-in-place-publishes-treeless-results`: the
  promote-apply no-op case (gate purely on `TREELESS_RUNGS`, harmless ff no-op)
  added as scope + an acceptance criterion + prompt note; both in-place entry points
  (`runSelectedInSequence` AND the single named `performAdvance` path) named, with
  `AdvanceContext.arbiter` as the source.
- **A2 DECIDED by the human: yes, the propose matrix enumerates apply items, so the
  on-answer loop closes identically to merge.** Folded into
  `ci-propose-matrix-enumerates-lifecycle-items` (scope, an apply-leg acceptance
  criterion, the prompt). No open question remains → no `needsAnswers`.
- **A1 folded:** reuse `gatherLifecycleInPlace` / `gatherLifecycleMirror` (the
  existing sidecar-resolving seam) instead of re-deriving — named in scope,
  acceptance, and prompt.
- **A3 folded:** the emitted workflow is the OUTPUT of the
  `generateAdvanceLifecycleWorkflow` generator, not a byte-copy of the .ts — the
  "byte-identical" phrasing replaced with "edit the generator, REGENERATE the
  emitted workflow" throughout.

Both slices now `approve`.
