---
title: intake-lone-slice-bounded-internal-review — the lone-SLICE outcome runs a bounded (3-round, hard-capped) adversarial self-review on the single drafted slice before emitting; non-converge flips SLICE→ASK carrying the draft + open question(s) in the comment body
slug: intake-lone-slice-bounded-internal-review
spec: issue-intake
blockedBy: []
covers: []
---

> Derives from the `issue-intake` SPEC and the observation `work/observations/intake-lone-slice-skips-adversarial-review-the-spec-path-gets.md` (2026-06-10, three settled maintainer rulings A/B/C). A slice born from an issue thread today gets STRICTLY WEAKER scrutiny than one born from a SPEC: `do prd:` runs `runSliceReviewLoop` (adversarial review→edit→re-review), but intake's lone-SLICE outcome (`dispatchSlice`, `src/intake.ts`) runs the decision prompt ONCE and emits with NO review-edit pass. This closes that gap for the lone-SLICE outcome ONLY, with a small intake-native step — a PROMPT, NOT slicer-loop integration. The slicer loop is a SET-level (N≥2) decomposition reviewer whose headline lenses (graph/gaps/overlap/"does the SET compose") no-op on a single slice; reusing it would be a costume (synthetic-source seam, an N=1 branch, re-mapped non-converge sinks, pre-emit disk churn). What a lone slice DOES need is the per-slice well-formedness + DESTINATION check, bounded a few rounds, else ASK the human carrying the draft.

## What to build

In `dispatchSlice` (`packages/dorfl/src/intake.ts`) — the `slice` branch ONLY — insert a BOUNDED internal adversarial self-review on the SINGLE drafted slice, AFTER the decision prompt has returned a `slice` verdict and BEFORE the runner writes/integrates `work/backlog/<slug>.md`:

- A new intake-native review step (a PROMPT + a small loop in the dispatcher), modeled on the slicer loop's verdict/output CONVENTIONS (a fenced JSON `{verdict, findings, ...}` parsed via the shared `extractJsonObjectSpan`; an injectable gate seam so tests drive it with a canned verdict, no model/network — mirror `IntakeDecider` / `SliceReviewGate`). Do NOT call `runSliceReviewLoop`, do NOT import it, do NOT add a synthetic-source seam or an N=1 loop mode.
- Each round, the review agent applies the `review` skill's lenses to THIS SINGLE drafted slice: per-slice well-formedness AND the DESTINATION check ("if this slice is built exactly as written, do we end up with the behaviour the issue asks for?"). The SET/graph/overlap lenses do NOT apply (N=1) and are deliberately OFF — the prompt must say so, exactly as the observation specifies. A round may propose an EDIT (the full replacement slice body); the runner applies it in memory to the candidate (nothing is written to `work/backlog/` until convergence — no pre-emit disk churn) and re-reviews.
- **Cap = 3 rounds, HARD-CODED** (ruling A). NOT configurable, NO flag, NO `--slicer-loop`-style knob, NOT optional (ruling B — always on, fixed depth). Bounds oscillation the way `slicerLoopMax` bounds the slicer loop, but as a literal constant.
- **CONVERGE** — a round finds NO new blocking issue → emit the IMPROVED slice (the existing `dispatchSlice` write+integrate path) and post the existing `slice created` completion comment (`composeIntakeCompletionComment`, unchanged).
- **NON-CONVERGE** — a round surfaces a blocking question with NO clear answer in the issue thread, OR the 3-round cap is hit with an unresolved blocking issue → the verdict FLIPS from `slice` to the EXISTING `ask` outcome (`IntakeRunOutcome` = `asked`). The ASK comment body carries BOTH (a) the proposed slice DRAFT and (b) the open question(s) that arose — so the human reacts to a concrete draft, strictly richer than today's blank-question ASK. The flipped ASK reuses `kind=ask` via the existing `dispatchComment` path with `markerKind: 'ask'` (ruling C — the draft rides in the comment BODY, NOT a new marker kind). NEVER silently emit the under-refined slice; NEVER write `work/backlog/<slug>.md` on the non-converge path.

The review step's JUDGEMENT is NOT unit-tested (exactly as the decision prompt's is not); only the bounded control flow + the convergence/flip dispatch is. Tests inject a canned review verdict through the new gate seam (no model/network), mirroring the existing intake dispatcher tests.

## Acceptance criteria

- [ ] On a `slice` verdict whose internal review CONVERGES (a round returns no new blocking issue), the (possibly edited) slice is written to `work/backlog/<slug>.md` and integrated exactly as today; outcome `sliced`; the `slice created` completion comment is posted. Asserted at the stubbed seams with a canned converging review verdict.
- [ ] A review round that proposes an EDIT is applied to the candidate IN MEMORY and re-reviewed; the EMITTED slice on convergence reflects the edit (the body differs from the agent's first draft). No `work/backlog/` write occurs until convergence (tested: no file written on the pre-convergence rounds).
- [ ] The round cap is a HARD-CODED constant = 3 (no config field, no CLI flag, no `PerformIntakeOptions` knob); a test pins that a never-converging review verdict stops after exactly 3 rounds and flips to ASK (not an infinite loop, not a silent emit).
- [ ] On NON-CONVERGE (a blocking question with no thread answer, OR cap hit with an open blocker), the verdict flips `slice → ask`: outcome `asked`, NO `work/backlog/<slug>.md` written, NO integrate; ONE comment posted via the existing `dispatchComment`/`postIssueComment` path carrying BOTH the proposed slice DRAFT and the open question(s), stamped with `markerKind: 'ask'`. Asserted at the stubbed seam.
- [ ] Zero new `IntakeRunOutcome`, zero new marker kind, zero config flag are introduced (the diff adds none — verified by inspection in the test/review). The non-converge path uses the EXISTING `asked` outcome and the EXISTING `kind=ask` marker; the next intake run resumes via the already-built triage gate (unchanged).
- [ ] `runSliceReviewLoop` is NOT imported or called from `intake.ts`; the SPEC, ASK, and BOUNCE outcomes are untouched (only `dispatchSlice` / the `slice` branch changes). Verified by inspection.
- [ ] The review gate DEGRADES honestly: a review-agent launch/parse failure maps onto the existing `agent-failed` outcome (exit 1) via the dispatcher's try/catch discipline — never a silent emit of the un-reviewed slice. A test pins this.
- [ ] Tests STUB the issue seam + the new review gate seam (no network); mirror the existing intake dispatcher tests.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None. `dispatchSlice`, the `ask`/`dispatchComment` path (`kind=ask`), `composeIntakeCompletionComment`, the `asked` outcome, and the triage resume gate already exist (verified in `src/intake.ts`); this slice only inserts the bounded review BETWEEN the `slice` verdict and the existing write/integrate, and reuses the existing ASK sink for the flip.

## Prompt

> Give intake's lone-SLICE outcome the adversarial refinement the SPEC path already gets — but as a small intake-NATIVE bounded review, NOT by integrating the slicer loop. SPEC: `work/spec-sliced/issue-intake.md`. Source observation: `work/observations/intake-lone-slice-skips-adversarial-review-the-spec-path-gets.md` (rulings A/B/C are SETTLED — read them).
>
> DRIFT CHECK FIRST: confirm `dispatchSlice` in `packages/dorfl/src/intake.ts` today runs the decision prompt ONCE and writes/integrates the slice with NO review-edit pass (the `do prd:` path's `runSliceReviewLoop` in `src/slicer-review-loop.ts` is the asymmetry). If a bounded internal review already runs before the lone-slice emit, this slice is done. Read `slicer-review-loop.ts` to MIRROR its verdict/output conventions (fenced JSON `{verdict, findings, edits}`, `extractJsonObjectSpan`, injectable gate seam) — but do NOT import or call it.
>
> WHAT TO BUILD: in the `slice` branch of `dispatchSlice` ONLY, AFTER the `slice` verdict and BEFORE the write/integrate, run a bounded adversarial self-review on the SINGLE drafted slice. New intake-native PROMPT + a small loop + an injectable review-gate seam (mirror `IntakeDecider`). Each round runs the `review` skill's lenses on the ONE slice: per-slice well-formedness + the DESTINATION check; the SET/graph/overlap lenses are N=1 and are explicitly OFF in the prompt. A round may propose an EDIT (full replacement body) applied IN MEMORY (no `work/backlog/` write pre-convergence) and re-reviewed. Cap = 3 rounds, HARD-CODED literal (ruling A) — not optional, no flag, no config (ruling B). CONVERGE (no new blocking issue) → emit the improved slice via the existing write/integrate + the existing `slice created` completion comment. NON-CONVERGE (a blocking question with no thread answer, OR cap hit with an open blocker) → FLIP the verdict to the EXISTING `ask` outcome (`asked`): post ONE comment via the existing `dispatchComment`/`postIssueComment` path carrying BOTH the slice DRAFT and the open question(s), with `markerKind: 'ask'` (ruling C — draft in the BODY, not a new marker kind). NEVER write the slice on non-converge; NEVER silently emit the under-refined slice.
>
> SCOPE FENCE (from the observation): lone-SLICE outcome ONLY — do NOT touch SPEC / ASK / BOUNCE. Do NOT call/import `runSliceReviewLoop`; do NOT add a synthetic-source seam, an N=1 loop mode, or a new non-converge outcome. ZERO new `IntakeRunOutcome`, ZERO new marker kind, ZERO config flag, no `--slicer-loop`-style knob. The non-converge path is the EXISTING `asked` outcome (verdict flips SLICE→ASK) with the draft + question(s) in the comment body; the next run resumes via the already-built triage gate.
>
> SEAM TO TEST AT: the new injectable review-gate seam + the stubbed issue seam (no model/network), mirroring the existing intake dispatcher tests. Assert: convergence emits the (edited) slice + completion comment; an edit is reflected in the emitted body; no `work/backlog/` write before convergence; a never-converging verdict stops after exactly 3 rounds; non-converge flips to `asked` with NO slice written, ONE comment carrying draft + question(s) and `kind=ask`; a review launch/parse failure maps to `agent-failed` (no silent emit). The review prompt's JUDGEMENT is NOT unit-tested (only the bounded flow + dispatch), exactly as the decision prompt's is not.
>
> "Done" = intake's lone-slice path refines its single drafted slice up to 3 hard-capped adversarial rounds, emits the improved slice on convergence, else flips to an ASK carrying the draft + open question(s) — adding no new outcome/marker/flag — and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Needs attention

acceptance gate failed (exit 1)

## Requeue 2026-06-10

Gate failure was a BASE-branch format RED (an unformatted observation file from slice 1's review gate), NOT slice work — now fixed on main via a format chore. Re-claim CONTINUES from the kept work branch tip; build the bounded internal review on dispatchSlice as specified.
