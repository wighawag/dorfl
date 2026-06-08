---
title: Fresh-context acceptance gate for sliced PRDs (--review/--no-review, slice-SET prompt, one-shot, no rounds) riding performIntegration
slug: slice-acceptance-gate
prd: slicing-coherence
blockedBy: [slice-output-through-integration]
covers: [5, 6]
---

## What to build

Add the slice-path mirror of the build Gate-2: a **fresh-context ACCEPTANCE
review gate** that runs BEFORE the produced slices integrate, riding
`performIntegration`'s review-before-integrate gate (which only exists on the
slicing path once the output goes through the shared core — hence blocked on
`slice-output-through-integration`).

Behaviour:

- Controlled by the BUILD `--review` / `--no-review` family (ON by default), so
  there is ONE gate-configuration story shared with the build path. `--review-model`
  applies (de-correlated reviewer model).
- The gate runs a **slice-SET prompt** (NOT the per-build-diff prompt): coherence /
  dependency graph / gaps + overlap / "if built, achieves the PRD goal /
  correct-if-implemented". A bad SET never lands unreviewed.
- The gate is **ONE-SHOT** — terminal pass/fail, NO rounds. On `approve` the slices
  integrate; on `block` the set is routed to needs-attention (the slice-path
  analogue of the build block-route), NOT integrated.
- The gate does **NOT** inherit `--review-max-rounds`. That flag is an ORPHAN on
  the build gate (a rounds bound for a revise↔review loop whose revise step does
  not exist — `work/observations/reviewmaxrounds-on-wrong-concept.md`); the slice
  gate must not carry it. Any FUTURE revise↔review loop gets its own loop-family
  flag (mirroring `--slicer-loop-max`), not a gate knob.

This gate is DISTINCT from the slicer IMPROVER loop (`slicer-review-loop.ts`, the
`--slicer-loop*` family — separate slice `slicer-loop-flag-family`): the improver
loop EDITS slices between passes in-context; THIS gate is a terminal fresh-context
accept/reject BEFORE integrate. Both can be on; they are non-overlapping concepts.
NAMING RULE: gate = `--review*` (shared with build); improver loop =
`--slicer-loop*` (slice-only). No flag name spans both.

## Acceptance criteria

- [ ] On the `do prd:` path, when `review` resolves ON (the default), a
      fresh-context acceptance gate runs BEFORE the slices integrate; `--no-review`
      skips it (mirror the build Gate-2 on/off tests).
- [ ] The gate uses a slice-SET prompt (coherence / dependency graph / gaps+overlap
      / PRD-goal "correct-if-implemented"), demonstrably distinct from the build
      per-diff review prompt.
- [ ] `block` routes the slice set to needs-attention (not integrated); `approve`
      lets it integrate. Verify both via the throwaway-git integration harness.
- [ ] The gate is ONE-SHOT (a single reviewer invocation → verdict); it does NOT
      accept or consult `--review-max-rounds` on the slice path.
- [ ] `--review-model` de-correlates the gate reviewer's model on this path.
- [ ] The gate is independently controllable from the slicer improver loop
      (`--slicer-loop*`): toggling one does not affect the other.
- [ ] Tests cover the new behaviour, mirroring `review-gate-pr.test.ts` /
      `integration-core.test.ts` style (throwaway git repos; config isolation).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `slice-output-through-integration` — the acceptance gate rides
  `performIntegration`'s review-before-integrate gate, which only reaches the
  slicing path once slice output goes through the shared core. (Also a file
  overlap: both touch `slicing.ts` / `integration-core.ts` — serialise.)

## Prompt

> Add the slice-path ACCEPTANCE GATE: a fresh-context review-before-integrate that
> runs on the produced slice SET BEFORE it integrates, riding the
> `performIntegration` review gate that `slice-output-through-integration` brought
> to the `do prd:` path. Mirror the build Gate-2 EXACTLY in flags + shape, differing
> only in the PROMPT (a slice-SET prompt) and in being ONE-SHOT.
>
> DOMAIN VOCABULARY: build Gate-2 is the `review`/Gate-2 in
> `src/integration-core.ts` (`performIntegration`, the `if (input.review) { … }`
> block) + `src/review-gate.ts` (`harnessReviewGate`, `buildReviewPrompt`,
> `parseReviewVerdict`). It is controlled by `--review`/`--no-review`/`--review-model`
> (the `reviewPr→review` rename landed — see `work/done/rename-reviewpr-to-review.md`).
> The slicer IMPROVER loop is `src/slicer-review-loop.ts` — a DIFFERENT concept
> (it edits between passes); do NOT conflate. The gate you add is one-shot
> accept/reject, the improver loop is review→edit→converge.
>
> WHERE TO LOOK: `src/integration-core.ts` (the Gate-2 review block + its
> needs-attention routing — your slice-SET gate is the SAME shape; reuse the
> routing), `src/review-gate.ts` (the prompt + parse + harness gate to mirror for a
> slice-SET prompt), `src/slicing.ts` (`performSlice` — where the gate slots in on
> the slicing path), `src/cli.ts` / `src/do-config.ts` (the `--review*` flag wiring,
> already present for the build path).
>
> ONE-SHOT, NO ROUNDS: the slice gate must NOT inherit `--review-max-rounds`. Read
> `work/observations/reviewmaxrounds-on-wrong-concept.md`: a gate is terminal
> pass/fail; `--review-max-rounds` is an orphan on the build gate (a revise↔review
> bound with no revise step). A future revise↔review LOOP would get its OWN
> loop-family flag (like `--slicer-loop-max`), never a gate knob. Do NOT add rounds
> to this gate; do NOT also remove `--review-max-rounds` from the BUILD gate here
> (that build-path cleanup is out of scope — flagged separately in that observation).
>
> SLICE-SET PROMPT: review the WHOLE candidate set — coherence, dependency graph,
> gaps + overlap, and "if every slice is built exactly as written, do we reach the
> system the PRD describes / is each slice correct-if-implemented". The `review`
> skill already has a set-of-slices lens; use it.
>
> FIRST run the drift check: confirm `performIntegration` has the Gate-2
> review-before-integrate block and that `slice-output-through-integration` has
> landed (the slicing path now goes through `performIntegration`). If the slicing
> path does NOT yet ride the shared core, this slice is not yet buildable — route
> it to `needs-attention/` (its blocker has not landed) rather than re-implementing
> the keystone here.
>
> "Done" = `do prd:` runs a one-shot slice-SET acceptance gate before integrate
> (`--review` on by default, `--no-review` skips, block → needs-attention,
> no rounds), independently controllable from the improver loop, with tests, and
> `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
