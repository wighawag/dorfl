---
title: "Move the review discipline (lenses) into work/protocol/ so the Gate-2 review works in every set-up repo, and centralise the duplicated review-prompt prose"
slug: review-lenses-into-protocol
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) plus the code; remaining work: `work/tasks/todo/` tasks. Governing context: `docs/adr/methodology-and-skills.md` §6 (skills are human-facing and NOT copied; this brief REFINES that for the review discipline) and the in-band-for-portability doctrine in `work/protocol/CLAIM-PROTOCOL.md`.

## Problem Statement

Two problems, one root cause.

**1. The Gate-2 review silently degrades in every repo except this one.** The review-gate prompt (`packages/agent-runner/src/review-gate.ts` → `buildReviewPrompt`, `buildSliceAcceptancePrompt`, and the lone-slice variant in `intake.ts`) instructs the spawned fresh-context agent to *"Run the `review` skill"* and *"Apply the review skill's lenses IN ORDER"*. But it NEVER inlines the lenses; it depends on the agent being able to LOAD `skills/review/SKILL.md`. That file exists only in agent-runner's OWN monorepo. A target repo that ran `setup` does NOT get it (setup copies `work/protocol/` docs but, by `methodology-and-skills.md` §6, deliberately does NOT copy skills), and the npm package does NOT vendor it (only `CLAIM-PROTOCOL.md` is vendored). So in any consumer repo, the review agent is told "apply the review skill's lenses" with no review skill present. It does not error (the gate parses whatever JSON returns); it just produces a much weaker or hallucinated review. Silent quality loss.

**2. The review-prompt prose is duplicated and drift-prone.** The three prompt builders re-embed overlapping instruction blocks: the JSON verdict contract verbatim in each, AND full restatements of the in-scope-decision-ratification and conceptual-coherence lenses that ALSO exist as lenses 3/4 in the `review` skill. Two verdict types model one shape (`ReviewVerdict` in `review-gate.ts`, `SliceReviewVerdict` in `slicer-review-loop.ts`). The lens content thus lives in two places and can drift.

The root cause is the same: the review DISCIPLINE (the lenses, the verdict shape) is content the autonomous runner CONSUMES, but it currently lives only in a SKILL (an operator tool) in this one repo, out-of-band from the protocol that every consumer repo receives.

## Solution

Recognise that the review discipline is a PROTOCOL concern, not an orchestration skill. The protocol already owns the full quality contract: how work is AUTHORED (`WORK-CONTRACT.md`, the templates), CLAIMED and BUILT (`CLAIM-PROTOCOL.md`, including the deterministic Gate-1 `verify` floor). The review lenses are the JUDGEMENT half of that same acceptance contract: how an item is judged TRUSTWORTHY before it lands (Gate 2). They belong with the protocol, alongside Gate 1, not in a human-facing skill.

So:

- Make the review lenses a PROTOCOL DOC, e.g. `work/protocol/REVIEW-LENSES.md` (source of truth in `skills/setup/protocol/`, like the other protocol docs). It holds the core disciplines, the 5 lenses, and the `{verdict, findings}` verdict shape.
- `setup` copies it into every target repo's `work/protocol/` (re-synced, version-stamped) exactly like the other protocol docs. The npm package vendors it (extend `vendor-protocol.mjs`) for the not-yet-set-up / installed-CLI fallback.
- The review-gate prompt builders POINT AT the doc (resolved target-repo-first by a generalised version of `resolveClaimProtocolPath`), so the review agent finds the lenses in EVERY repo, in-band, never depending on a host skill.
- The `review` SKILL.md becomes a THIN human-facing pointer at `work/protocol/REVIEW-LENSES.md` (the same thinness as Matt's `grill-with-docs` over `grilling`): the operator entry point, while the standard itself lives in the protocol.
- Centralise the duplicated prompt prose: one shared JSON-verdict-contract helper reused by all three builders; the lens prose deleted from the prompts in favour of "apply the lenses in `work/protocol/REVIEW-LENSES.md`"; one unified verdict type.

This fixes BOTH problems with ONE move: the portability fix (lenses travel in-band to every repo) and the de-duplication (the lenses get a single source of truth the gate references instead of re-embedding) are the same change.

## User Stories

1. As a maintainer of a repo that adopted the work/ contract (NOT agent-runner's own repo), I want the Gate-2 review to apply the full review lenses, so the review quality is the same as in agent-runner's own repo and does not silently degrade.
2. As the review gate, I want to resolve the review lenses from `work/protocol/REVIEW-LENSES.md` (target-repo copy first, vendored package copy as fallback), so the spawned review agent always has the lenses in-band, never depending on a host-installed skill.
3. As `setup`, I want to copy `REVIEW-LENSES.md` into every target repo's `work/protocol/` (re-synced, version-stamped) like the other protocol docs, so adopting the contract also adopts its review standard.
4. As the agent-runner package, I want `REVIEW-LENSES.md` vendored into `dist/protocol/` (like `CLAIM-PROTOCOL.md`), so an installed CLI running against a not-yet-set-up repo still has the lenses.
5. As a contributor editing the review discipline, I want ONE source of truth for the lenses (the protocol doc), so editing them does not require touching the skill AND three prompt builders, and they cannot drift.
6. As the review-gate code, I want ONE verdict type and ONE JSON-verdict-contract prompt helper shared by `buildReviewPrompt` / `buildSliceAcceptancePrompt` / the intake lone-slice prompt, so the output contract is stated once.
7. As a human, I want the `review` SKILL.md to stay my entry point (a thin pointer to the protocol doc), so I can still invoke the review discipline interactively without the standard living in two places.

### Autonomy notes (the two gate axes)

Omit `humanOnly`. Set `needsAnswers: true` while the open questions below are unresolved (they are slicing-shaping decisions, not free-form). Clear it once they are answered.

## Implementation Decisions

- **New protocol doc** `work/protocol/REVIEW-LENSES.md`, source-of-truth at `skills/setup/protocol/REVIEW-LENSES.md`, mirrored into `work/protocol/` byte-identical (the existing `diff -r skills/setup/protocol work/protocol` discipline extends to it). Content lifted from the current `skills/review/SKILL.md` body (core disciplines + 5 lenses + verdict shape).
- **`vendor-protocol.mjs`** generalised from copying one file to copying the protocol-doc SET (or extended to include `REVIEW-LENSES.md`), landing it in `dist/protocol/`.
- **`resolveClaimProtocolPath`** generalised to a doc-name-parameterised resolver (same precedence: override > target-repo `work/protocol/` > vendored `dist/protocol/` > dev-only `skills/` walk), reused for `REVIEW-LENSES.md`.
- **`setup`** copies `REVIEW-LENSES.md` in Phase A alongside the other protocol docs; bumps `work/protocol/VERSION`.
- **Prompt builders** (`review-gate.ts`, `intake.ts`): replace the inlined lens prose and the per-builder JSON contract with (a) a reference to the resolved `REVIEW-LENSES.md` and (b) a shared verdict-contract helper. Keep the per-builder FRAMING (code-vs-slice vs slice-SET vs lone-slice) distinct; only the shared discipline/contract is centralised.
- **`review` SKILL.md** reduced to a thin human-facing pointer at `work/protocol/REVIEW-LENSES.md` (keep its model-invoked description; it is still composed by conductors/gates).
- **Verdict types** unified (`ReviewVerdict` and `SliceReviewVerdict` collapse to one; one `parseReviewVerdict`).
- **ADR refinement**: update `methodology-and-skills.md` §6 to state the refined dividing line. ORCHESTRATION skills are human-facing and not copied; but DISCIPLINE content the autonomous runner consumes (the review lenses) is a PROTOCOL concern and travels via `work/protocol/`, like the contract docs and the claim wrapper. The protocol owns the full quality contract: authoring (templates, WORK-CONTRACT), build+claim (CLAIM-PROTOCOL, Gate-1 verify), AND judgement-before-landing (Gate-2 review lenses).

## Testing Decisions

- Test EXTERNAL behaviour at the resolver seam: `REVIEW-LENSES.md` resolves target-repo-first, then vendored, then dev-walk (mirror the existing `resolveClaimProtocolPath` tests).
- Test that the assembled review prompt REFERENCES the lenses doc and the shared verdict contract (mirror `prompt.test.ts` style of asserting on assembled prompt text), and that no builder re-inlines the lens prose.
- Test setup copies `REVIEW-LENSES.md` into `work/protocol/` and stamps VERSION (mirror the existing protocol-copy setup tests).
- Verdict parsing tests stay green against the unified type.
- Do NOT regress the existing review-gate verdict-parse / routing tests.

## Out of Scope

- Changing the review DISCIPLINE itself (the lenses' content). This is a RELOCATION + de-duplication, not a re-authoring; the lens text moves verbatim.
- Copying the OTHER (orchestration) skills into target repos. They remain human-facing and uncopied per §6; only the review discipline is reclassified as protocol.
- The Gate-1 `verify` floor (already protocol, unchanged).

## Further Notes / Open questions (clear `needsAnswers` when resolved)

1. **Doc name + granularity.** `work/protocol/REVIEW-LENSES.md` as one doc, or split (lenses vs verdict-shape)? One doc is simpler and matches the others. Confirm the name.
2. **Where the verdict SHAPE lives.** The `{verdict, findings}` contract is consumed by BOTH the prompt (human-readable) and the parser (`parseReviewVerdict`, machine). Does the shape live in the protocol doc (single source) with the parser referencing it in prose, or stay a code constant with the doc describing it? Decide the single source so prose and parser cannot drift.
3. **`vendor-protocol.mjs`: generalise to a doc SET vs add one more file.** Likely generalise (future protocol docs benefit), but confirm scope for this slice.
