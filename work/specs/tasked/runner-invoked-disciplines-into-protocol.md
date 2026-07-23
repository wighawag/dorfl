---
title: 'Move every runner-invoked discipline (review, surface-questions, slicing) into work/protocol/ so spawned-agent prompts work in every set-up repo, not just dorfl''s own'
slug: runner-invoked-disciplines-into-protocol
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) plus the code; remaining work: `work/tasks/todo/` tasks. Governing context: `docs/adr/methodology-and-skills.md` §6 (skills are human-facing and NOT copied; this brief REFINES that for runner-invoked disciplines) and the in-band-for-portability doctrine in `work/protocol/CLAIM-PROTOCOL.md` ("the boundary travels with the prompt"). Supersedes the narrower `review-lenses-into-protocol` framing (this brief generalises it after finding review was one of three).

## Problem Statement

**The runner hands spawned agents prompts that say "use the `X` skill", but the skill exists only in dorfl's OWN repo.** It works here purely because dorfl is the repo that builds dorfl (the `skills/` tree is a sibling). A target repo that ran `setup` does NOT get the skills (setup copies `work/protocol/` docs but, per `methodology-and-skills.md` §6, deliberately does NOT copy skills), and the npm package vendors only `CLAIM-PROTOCOL.md`. So in any consumer repo the spawned agent is told to apply a discipline that is not present. It never errors (the gate parses whatever JSON returns); it silently degrades.

There are THREE such runner-invoked disciplines, across SEVEN prompt builders:

1. **`review`** (SEVERE: nothing inlined). `buildReviewPrompt` + `buildSliceAcceptancePrompt` (`review-gate.ts`), `buildLoneSliceReviewPrompt` (`intake.ts`), `buildSliceReviewPrompt` (`slicer-review-loop.ts`). Each says "Run the `review` skill / apply its lenses IN ORDER" but inlines NONE of the 5 lenses. In a consumer repo: a weak or hallucinated review.
2. **`surface-questions`** (MODERATE: partially inlined). `buildSurfacePrompt` (`surface-gate.ts`) says "Run the `surface-questions` skill" and restates its two laws (GATHER-only / PERSIST-NEVER) + the humility rule, but not the full discipline.
3. **slicing / `to-task`** (MODERATE: partially inlined). `buildSlicingBrief` (`slicing.ts`) says "Use the **to-slices** skill" and restates the confidence-check + `humanOnly` rules, but not the full slicing discipline. (It ALSO carries STALE vocabulary, see bonus bug below.)

**Secondary problem: the partially-inlined prompts duplicate discipline content** that also lives in the skill, so the two can drift. The review prompts additionally re-embed the JSON verdict contract verbatim in each builder, and two verdict types model one shape (`ReviewVerdict` in `review-gate.ts`, `SliceReviewVerdict` in `slicer-review-loop.ts`).

**Bonus bug found while investigating (fix in passing):** `buildSlicingBrief` uses PRE-RENAME vocabulary in a live spawned prompt: `to-slices` (now `to-task`), `work/backlog/`, `work/spec/`. This is exactly the claim-vs-reality drift the review discipline exists to catch, leaking into the runner's own output.

**Scope boundary established by investigation:** the runtime reads NO other this-repo-only files (no `CONTEXT.md`, `docs/adr/`, etc. read at runtime; verified). The blast radius is EXACTLY the skill-named prompts above. There is nothing else of this class.

The root cause is one thing: a discipline the autonomous runner INVOKES BY NAME is content the runner consumes, but it currently lives only in a SKILL (an operator tool) in this one repo, out-of-band from the protocol every consumer repo receives.

## Solution

Recognise the GENERAL principle: **any discipline the autonomous runner invokes by name is a PROTOCOL concern and must travel in-band via `work/protocol/`**, exactly like `CLAIM-PROTOCOL.md` and the git boundary. The protocol already owns the full quality contract: how work is AUTHORED (`WORK-CONTRACT.md`, the templates), CLAIMED and BUILT (`CLAIM-PROTOCOL.md`, the Gate-1 `verify` floor). The runner-invoked disciplines are the rest of that same contract (how work is judged, how questions are surfaced, how a SPEC is sliced), so they belong with the protocol, not in human-facing skills.

Build the SHARED MACHINERY once, then move each discipline onto it:

- **Each runner-invoked discipline becomes a PROTOCOL DOC** (source of truth in `skills/setup/protocol/`, mirrored byte-identical into `work/protocol/`): `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md` (names per D1). Each holds its discipline content + a PROSE DESCRIPTION of its emitted shape (the shape stays code-owned per D2).
- **Generalise the resolver + vendor + setup to a doc SET** (D3): `resolveClaimProtocolPath` becomes `resolveProtocolDoc(name, cwd)` (precedence: override > target-repo `work/protocol/` > vendored `dist/protocol/` > dev-only `skills/` walk); `vendor-protocol.mjs` vendors the SET of runtime-read docs into `dist/protocol/`; `setup` already copies the whole `skills/setup/protocol/` directory, so adopting the contract adopts every discipline.
- **Each prompt builder POINTS AT its resolved doc** instead of "use the X skill" + partial re-inlining. The per-builder FRAMING (code-vs-slice, slice-SET, lone-slice, surface-one-item, slice-a-SPEC) stays distinct; only the shared discipline + emitted-shape is centralised.
- **Each `SKILL.md` becomes a THIN human-facing pointer** at its protocol doc (the `grill-with-docs`-over-`grilling` thinness): the operator entry point, while the standard lives in the protocol.
- **De-duplicate within the review family:** one shared verdict-contract prompt helper across the four review builders; one unified verdict type (`ReviewVerdict` + `SliceReviewVerdict` collapse).
- **Fix the stale slicing vocabulary** as part of porting the slicing discipline.

This fixes portability AND de-duplication in one move, for all three disciplines, because giving each discipline one protocol-doc home is what lets the prompts stop re-embedding it.

## User Stories

1. As a maintainer of a repo that adopted the work/ contract (NOT dorfl's own repo), I want review, question-surfacing, AND slicing to apply their FULL discipline, so quality matches dorfl's own repo and nothing silently degrades.
2. As the runner, I want to resolve each discipline doc from `work/protocol/<DISCIPLINE>-PROTOCOL.md` (target-repo copy first, vendored package copy as fallback), so every spawned agent has its discipline in-band, never depending on a host-installed skill.
3. As `setup`, I want to copy ALL discipline docs into every target repo's `work/protocol/` (re-synced, version-stamped) like the other protocol docs, so adopting the contract adopts its review/surface/slicing standards.
4. As the dorfl package, I want the discipline docs vendored into `dist/protocol/` (like `CLAIM-PROTOCOL.md`), so an installed CLI running against a not-yet-set-up repo still has them.
5. As a contributor editing a discipline, I want ONE source of truth per discipline (its protocol doc), so editing it does not require touching the skill AND the prompt builders, and they cannot drift.
6. As the review-gate code, I want ONE verdict type and ONE JSON-verdict-contract helper shared across the four review builders, so the output contract is stated once.
7. As a human, I want each `SKILL.md` to stay my entry point (a thin pointer to its protocol doc), so I can still invoke the discipline interactively without the standard living in two places.
8. As the runner, I want the slicing prompt to use CURRENT vocabulary (`to-task`, `work/tasks/`, the staged-pool names), so a live spawned prompt does not carry pre-rename drift.
9. As a future maintainer, I want a stated RULE ("no spawned-agent prompt may name a skill that is not resolvable in-band"), so the next runner-invoked discipline is born as a protocol doc, not a fourth instance of this bug.

### Autonomy notes (the two gate axes)

Omit both `humanOnly` and `needsAnswers`. The shaping questions are RESOLVED (D1 to D4 below); the brief is straightforwardly agent-sliceable. Slice review FIRST as the keystone (D4).

## Implementation Decisions

- **Three new protocol docs** (D1), source-of-truth in `skills/setup/protocol/`, mirrored byte-identical into `work/protocol/` (the existing `diff -r skills/setup/protocol work/protocol` discipline extends to them): `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md`. Content lifted verbatim from each current `SKILL.md` body + a PROSE DESCRIPTION of its emitted shape (shape stays code-owned per D2).
- **`resolveClaimProtocolPath` becomes `resolveProtocolDoc(name, cwd)`** (D3), reused for `CLAIM-PROTOCOL.md` and the three new docs; same precedence chain.
- **`vendor-protocol.mjs` generalised** (D3) to copy the SET of runtime-read protocol docs into `dist/protocol/`.
- **`setup`** copies the new docs in Phase A alongside the existing ones; bumps `work/protocol/VERSION`.
- **Prompt builders point at the resolved doc**, dropping "use the X skill" + partial re-inlining: `review-gate.ts` (×2), `intake.ts` (lone-slice), `slicer-review-loop.ts` (review); `surface-gate.ts` (surface); `slicing.ts` (slicing, AND fix the stale `to-slices`/`work/backlog`/`work/spec` vocabulary).
- **Each `SKILL.md`** (`review`, `surface-questions`, `to-task`) reduced to a thin human-facing pointer at its protocol doc (keep `review`/`surface-questions` model-invoked descriptions; `to-task` stays user-invoked).
- **Review-family de-dup:** one shared JSON-verdict-contract helper across the four review builders; `ReviewVerdict` + `SliceReviewVerdict` unified to one type + one parser.
- **Per-discipline shape drift guards** (D2): for each discipline, a test asserting a canonical emitted fixture both PARSES (`parseReviewVerdict` / `parseSurfaceEmit` / the slice parser) AND matches the shape its protocol doc documents.
- **State the rule + refine the ADR**: update `methodology-and-skills.md` §6 to the refined dividing line. ORCHESTRATION skills are human-facing and not copied; but any DISCIPLINE the autonomous runner invokes by name is a PROTOCOL concern and travels via `work/protocol/`. The protocol owns the full quality contract: authoring (templates, WORK-CONTRACT), build+claim (CLAIM-PROTOCOL, Gate-1 verify), judgement-before-landing (review), question-surfacing (surface), and slicing. Add the standing rule: no spawned-agent prompt may name a skill that is not resolvable in-band.

## Testing Decisions

- Resolver seam: each discipline doc resolves target-repo-first, then vendored, then dev-walk (mirror the existing `resolveClaimProtocolPath` tests, now `resolveProtocolDoc`).
- Each assembled prompt REFERENCES its discipline doc (and the shared verdict contract, for review), and NO builder re-inlines discipline prose (mirror `prompt.test.ts` assertion style).
- `setup` copies all discipline docs into `work/protocol/` and stamps VERSION (mirror the existing protocol-copy setup tests).
- Per-discipline emitted-shape parse tests stay green against the unified/again-parsed types.
- A regression test that the slicing prompt uses CURRENT vocabulary (no `to-slices` / `work/backlog/` / `work/spec/`).
- Do NOT regress existing review-gate / surface-gate / slicing verdict-parse + routing tests.

## Out of Scope

- Changing any discipline's CONTENT (the lenses, the surface laws, the slicing rules). This is RELOCATION + de-duplication + a vocabulary fix, not a re-authoring; discipline text moves verbatim (except the stale slicing nouns).
- Copying the ORCHESTRATION skills (`orchestrate`, `drive-backlog`, `to-brief`, `setup`, `triage-observations`, `capture-signal`, the `work` router) into target repos. They stay human-facing and uncopied per §6; only the three RUNNER-INVOKED disciplines are reclassified as protocol. (Note: `capture-signal` is model-invoked but the RUNNER never spawns an agent against it by name, so it is not in this class; if that changes, it joins.)
- The Gate-1 `verify` floor (already protocol, unchanged).
- Any hidden runtime file-dependency: verified there are none beyond the protocol docs and these skills.

## Resolved decisions (the former open questions)

**D1. One doc per discipline, named `<DISCIPLINE>-PROTOCOL.md`.** Each discipline's rules + emitted-shape description form one coherent unit always used together; splitting invites the cross-file drift this brief exists to kill, and the sibling protocol docs are each single whole units. Names pair with `WORK-CONTRACT.md` / `CLAIM-PROTOCOL.md`: `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md` (each "holds more than lenses/laws", so `-PROTOCOL` not `-LENSES`).

**D2. Each emitted SHAPE is owned by its PARSER code; the doc DESCRIBES it.** A discipline's emitted shape has two readers: the prompt (tells the agent what to emit) and the parser (which ENFORCES it, rejecting a wrong shape). The ENFORCING reader wins, so the shape's single source of truth is the parser code (`parseReviewVerdict`, `parseSurfaceEmit`, the slice parser), and the protocol doc mirrors it in prose. A per-discipline fixture-matches-doc test guards drift. (Contrast: the discipline CONTENT is owned by the DOC, because code never enforces it. Enforced shape to code; judgement content to doc.)

**D3. Generalise the resolver + vendor + setup to a doc SET.** The discipline docs are the 2nd/3rd/4th runtime-read protocol docs after `CLAIM-PROTOCOL.md`. Several runtime-read docs is past the moment to generalise (one adapter = hypothetical seam, two = real): `resolveProtocolDoc(name, cwd)`, vendor the set, and `setup` already copies the whole directory.

**D4. Slice REVIEW first as the keystone; surface + slicing follow.** Review is the SEVERE case (nothing inlined) AND it builds the shared machinery (the doc-set resolver, vendor-the-set, setup-copies-the-set, the thin-skill pattern). Task 1 builds that machinery THROUGH the review case, proven end-to-end. Tasks 2 (surface) and 3 (slicing + stale-vocabulary fix) are then THIN: lift content to a doc, point the prompt at it, thin the skill, on machinery that already exists. Tracer-bullet vertical slicing: build the spine once, reuse it. The review-family de-dup (shared verdict helper, unified type) rides task 1.
