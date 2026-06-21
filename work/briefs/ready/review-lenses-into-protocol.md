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

- Make the review discipline a PROTOCOL DOC, `work/protocol/REVIEW-PROTOCOL.md` (source of truth in `skills/setup/protocol/`, like the other protocol docs). It holds the core disciplines, the 5 lenses, and a PROSE DESCRIPTION of the `{verdict, findings}` shape (per D2 the shape is OWNED by the parser code; the doc describes it).
- `setup` copies it into every target repo's `work/protocol/` (re-synced, version-stamped) exactly like the other protocol docs. The npm package vendors it (extend `vendor-protocol.mjs`) for the not-yet-set-up / installed-CLI fallback.
- The review-gate prompt builders POINT AT the doc (resolved target-repo-first by a generalised version of `resolveClaimProtocolPath`), so the review agent finds the lenses in EVERY repo, in-band, never depending on a host skill.
- The `review` SKILL.md becomes a THIN human-facing pointer at `work/protocol/REVIEW-PROTOCOL.md` (the same thinness as Matt's `grill-with-docs` over `grilling`): the operator entry point, while the standard itself lives in the protocol.
- Centralise the duplicated prompt prose: one shared JSON-verdict-contract helper reused by all three builders; the lens prose deleted from the prompts in favour of "apply the lenses in `work/protocol/REVIEW-PROTOCOL.md`"; one unified verdict type.

This fixes BOTH problems with ONE move: the portability fix (lenses travel in-band to every repo) and the de-duplication (the lenses get a single source of truth the gate references instead of re-embedding) are the same change.

## User Stories

1. As a maintainer of a repo that adopted the work/ contract (NOT agent-runner's own repo), I want the Gate-2 review to apply the full review lenses, so the review quality is the same as in agent-runner's own repo and does not silently degrade.
2. As the review gate, I want to resolve the review lenses from `work/protocol/REVIEW-PROTOCOL.md` (target-repo copy first, vendored package copy as fallback), so the spawned review agent always has the lenses in-band, never depending on a host-installed skill.
3. As `setup`, I want to copy `REVIEW-PROTOCOL.md` into every target repo's `work/protocol/` (re-synced, version-stamped) like the other protocol docs, so adopting the contract also adopts its review standard.
4. As the agent-runner package, I want `REVIEW-PROTOCOL.md` vendored into `dist/protocol/` (like `CLAIM-PROTOCOL.md`), so an installed CLI running against a not-yet-set-up repo still has the lenses.
5. As a contributor editing the review discipline, I want ONE source of truth for the lenses (the protocol doc), so editing them does not require touching the skill AND three prompt builders, and they cannot drift.
6. As the review-gate code, I want ONE verdict type and ONE JSON-verdict-contract prompt helper shared by `buildReviewPrompt` / `buildSliceAcceptancePrompt` / the intake lone-slice prompt, so the output contract is stated once.
7. As a human, I want the `review` SKILL.md to stay my entry point (a thin pointer to the protocol doc), so I can still invoke the review discipline interactively without the standard living in two places.

### Autonomy notes (the two gate axes)

Omit both `humanOnly` and `needsAnswers`. The three slicing-shaping questions are RESOLVED (decisions D1 to D3 below); the brief is straightforwardly agent-sliceable.

## Implementation Decisions

- **New protocol doc** `work/protocol/REVIEW-PROTOCOL.md` (D1), source-of-truth at `skills/setup/protocol/REVIEW-PROTOCOL.md`, mirrored into `work/protocol/` byte-identical (the existing `diff -r skills/setup/protocol work/protocol` discipline extends to it). Content lifted from the current `skills/review/SKILL.md` body: core disciplines + 5 lenses + a PROSE DESCRIPTION of the verdict shape (the shape itself stays code-owned per D2).
- **`vendor-protocol.mjs`** generalised (D3) from copying one file to copying the SET of runtime-read protocol docs, landing them in `dist/protocol/`.
- **`resolveClaimProtocolPath`** generalised (D3) to a doc-name-parameterised `resolveProtocolDoc(name, cwd)` (same precedence: override > target-repo `work/protocol/` > vendored `dist/protocol/` > dev-only `skills/` walk), reused for both `CLAIM-PROTOCOL.md` and `REVIEW-PROTOCOL.md`.
- **`setup`** copies `REVIEW-PROTOCOL.md` in Phase A alongside the other protocol docs; bumps `work/protocol/VERSION`.
- **Prompt builders** (`review-gate.ts`, `intake.ts`): replace the inlined lens prose and the per-builder JSON contract with (a) a reference to the resolved `REVIEW-PROTOCOL.md` and (b) a shared verdict-contract helper. Keep the per-builder FRAMING (code-vs-slice vs slice-SET vs lone-slice) distinct; only the shared discipline/contract is centralised.
- **`review` SKILL.md** reduced to a thin human-facing pointer at `work/protocol/REVIEW-PROTOCOL.md` (keep its model-invoked description; it is still composed by conductors/gates).
- **Verdict types** unified (`ReviewVerdict` and `SliceReviewVerdict` collapse to one; one `parseReviewVerdict`).
- **Verdict-shape drift guard** (D2): a test asserting a canonical verdict fixture both PARSES (`parseReviewVerdict`) and matches the shape `REVIEW-PROTOCOL.md` documents, so the code-owned shape and the doc's prose description cannot silently diverge.
- **ADR refinement**: update `methodology-and-skills.md` §6 to state the refined dividing line. ORCHESTRATION skills are human-facing and not copied; but DISCIPLINE content the autonomous runner consumes (the review discipline) is a PROTOCOL concern and travels via `work/protocol/`, like the contract docs and the claim wrapper. The protocol owns the full quality contract: authoring (templates, WORK-CONTRACT), build+claim (CLAIM-PROTOCOL, Gate-1 verify), AND judgement-before-landing (Gate-2 review discipline).

## Testing Decisions

- Test EXTERNAL behaviour at the resolver seam: `REVIEW-PROTOCOL.md` resolves target-repo-first, then vendored, then dev-walk (mirror the existing `resolveClaimProtocolPath` tests).
- Test that the assembled review prompt REFERENCES the lenses doc and the shared verdict contract (mirror `prompt.test.ts` style of asserting on assembled prompt text), and that no builder re-inlines the lens prose.
- Test setup copies `REVIEW-PROTOCOL.md` into `work/protocol/` and stamps VERSION (mirror the existing protocol-copy setup tests).
- Verdict parsing tests stay green against the unified type.
- Do NOT regress the existing review-gate verdict-parse / routing tests.

## Out of Scope

- Changing the review DISCIPLINE itself (the lenses' content). This is a RELOCATION + de-duplication, not a re-authoring; the lens text moves verbatim.
- Copying the OTHER (orchestration) skills into target repos. They remain human-facing and uncopied per §6; only the review discipline is reclassified as protocol.
- The Gate-1 `verify` floor (already protocol, unchanged).

## Resolved decisions (the former open questions)

**D1. Doc name + granularity: ONE doc, named `REVIEW-PROTOCOL.md`.** The disciplines, the 5 lenses, and the verdict-shape description form one coherent unit always used together; splitting them would create the cross-file drift this brief exists to kill, and the sibling protocol docs are each single whole units. The name is `REVIEW-PROTOCOL.md` (not `REVIEW-LENSES.md`): the doc holds more than lenses, and the skill's own scope-fence already calls this content "the review protocol/discipline". It pairs with its siblings `WORK-CONTRACT.md` / `CLAIM-PROTOCOL.md`.

**D2. The verdict SHAPE is owned by the PARSER code; the doc DESCRIBES it.** The `{verdict, findings}` contract has two readers: the prompt (tells the agent what to emit) and the parser (`parseReviewVerdict`/`validateVerdict` in `review-gate.ts`, which ENFORCES it and rejects a wrong shape into needs-attention). They cannot be co-equal sources; the ENFORCING reader wins, so the shape's single source of truth is the parser code, and `REVIEW-PROTOCOL.md` mirrors it in prose for the agent/human. Guard against drift with a test asserting a canonical verdict fixture both parses AND matches the shape the doc documents. (Contrast: the lenses/disciplines are owned by the DOC, because code never enforces them. Enforced shape to code; judgement content to doc.)

**D3. Generalise `vendor-protocol.mjs` and the resolver to a doc SET (not one more hardcoded file).** `REVIEW-PROTOCOL.md` is the SECOND runtime-read protocol doc (after `CLAIM-PROTOCOL.md`), and more will follow. Two runtime-read docs is the moment to generalise (one adapter = hypothetical seam, two = real): vendor the set of runtime-read docs (copy the directory or a named list) and turn `resolveClaimProtocolPath` into a doc-name-parameterised `resolveProtocolDoc(name, cwd)` reused by both docs. `setup` already copies the whole `skills/setup/protocol/` directory, so its path is unchanged.
