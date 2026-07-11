---
title: Conformance guard — the convert-from-prd-to-spec skill doc carries its load-bearing discipline
slug: convert-from-prd-to-spec-skill-doc-conformance-guard
spec: vocabulary-cutover-prose-sweep-skill
blockedBy: [author-convert-from-prd-to-spec-skill]
covers: [10]
---

## What to build

A fixture test (a drift guard) that asserts `skills/convert-from-prd-to-spec/SKILL.md` describes its load-bearing discipline, so the skill doc cannot silently drift or ship half-written. Modelled on the existing doc-conformance pattern (`packages/dorfl/test/tasking-protocol-doc.test.ts`): read the SKILL.md and assert (`toMatch`) that the prose carries each non-negotiable element.

The guard asserts the doc:

- Has the expected frontmatter identity (`name: convert-from-prd-to-spec`, `disable-model-invocation: true`).
- Names the deterministic command it drives (`dorfl prd-to-spec`) AND the fact that it CALLS the command rather than re-implementing it.
- States the two-half orchestration (command → prose sweep → bi-word leak-scan gate).
- States the runner-agnostic fallback (works with `dorfl` absent).
- Teaches the reusable-pattern items: the `''…''` provenance marker, the bi-word (prd + brief) scan, the provenance-vs-living split, and the identity allow-list.
- POINTS at the two reference-implementation scans (`prd-src-prose-leak-scan` / `prd-word-cutover-leak-scan`) rather than forking their logic.
- Does NOT re-introduce a stale live-back-compat claim (e.g. no assertion-negative for a "`prd:` still accepted" phrasing).

The guard is a single thin test file in `packages/dorfl/test/`. It is file-orthogonal to the skill doc (different tree) and `blockedBy` the authoring task (it asserts against that doc's content), so it cannot go green until the doc exists.

## Acceptance criteria

- A new test file under `packages/dorfl/test/` reads `skills/convert-from-prd-to-spec/SKILL.md` and asserts the elements listed in What-to-build (frontmatter identity; calls-not-reimplements `dorfl prd-to-spec`; two-half orchestration; runner-agnostic fallback; the marker + bi-word + provenance-split + identity-allow-list discipline; the pointer to the two reference scans).
- The guard is NON-VACUOUS: it fails if the doc is missing an element (not merely if the file is absent) — i.e. it asserts specific load-bearing phrases, mirroring `tasking-protocol-doc.test.ts`'s per-element `toMatch` assertions.
- The guard itself introduces no artifact-word `prd`/`brief` LEAK the WORD/src scans would flag (a test-file string that names the retired word uses backticks or the `''…''` marker where the scan walks it; `packages/dorfl/test` is exempt from the WORD scan but the src-prose scan does not walk test files, so this is a non-issue — keep the test prose clean regardless).
- Test coverage: this task IS the test; it needs no further test-of-the-test beyond its own non-vacuous self-shape.
- The full acceptance gate is green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

`author-convert-from-prd-to-spec-skill` — the guard asserts against the skill doc that task writes, so it cannot go green until the doc exists.

## Prompt

GOAL: add a fixture drift-guard test in `packages/dorfl/test/` that asserts `skills/convert-from-prd-to-spec/SKILL.md` carries its load-bearing discipline, so the skill doc cannot silently drift or ship half-written.

WHERE TO LOOK (by concept): the existing doc-conformance test `packages/dorfl/test/tasking-protocol-doc.test.ts` is the pattern — it `readFileSync`s a doc and asserts per-element `toMatch(...)` on the load-bearing prose. Read the skill doc this guards, `skills/convert-from-prd-to-spec/SKILL.md` (produced by the blocking task `author-convert-from-prd-to-spec-skill`), and the spec `work/specs/tasked/vocabulary-cutover-prose-sweep-skill.md` for the exact discipline the doc must carry.

WHAT TO ASSERT (each a per-element `toMatch`, so a missing element FAILS): frontmatter identity (`name: convert-from-prd-to-spec`, `disable-model-invocation: true`); that the doc names `dorfl prd-to-spec` and states it CALLS the command (not re-implements it); the two-half orchestration (command → prose sweep → bi-word leak-scan gate); the runner-agnostic fallback; the reusable-pattern items (the `''…''` provenance marker, the bi-word prd+brief scan, the provenance-vs-living split, the identity allow-list); and the pointer to the two reference scans (`prd-src-prose-leak-scan`, `prd-word-cutover-leak-scan`).

SEAM TO TEST AT: the skill doc file content (read-and-assert), exactly like `tasking-protocol-doc.test.ts`. No model, no network, no dorfl invocation — it is a static doc-shape guard.

WATCH OUT: keep the guard NON-VACUOUS (assert specific phrases, not just file existence) so it actually catches a half-written doc. Run `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.

DONE = the guard exists, is non-vacuous (fails on a doc missing any asserted element), and the full acceptance gate is green.
