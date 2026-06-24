---
title: Phase 0: guard test that no .ts outside work-layout contains a raw work/<folder> literal
slug: guard-test-no-raw-work-literal-outside-work-layout
prd: folder-taxonomy-reorg-and-rename
humanOnly: true
blockedBy: [work-layout-module-centralises-all-work-paths]
covers: [4, 5]
---

## What to build

A structural guard test that locks in the Phase-0 centralisation so it cannot
silently regress: assert that NO `.ts` file in the package, other than the
`work-layout` module itself, contains a raw `work/<folder>` path literal. Once the
centralisation lands, this guard is what keeps a future edit from re-scattering a
raw `work/backlog/...` string back through the codebase (which would also re-expose
the rename to a fragile find-replace).

Mirror the repo's existing structural-guard test style (see
`ledger-lint.test.ts` and `main-divergence-guard.test.ts` for the house pattern of
a test that scans source and asserts an invariant). The guard scans `src/` (not
test fixtures, which legitimately contain literal `work/...` paths to build
throwaway repos), allow-lists `work-layout` as the one permitted home of the
literals, and fails with a clear message naming any offending file + line so a
regression is trivially located.

This is a test-only slice, file-orthogonal to the src edits of the centralisation
slice, so the two rebase trivially.

> FORWARD-POINTER (planted by the conductor after the centralisation slice
> `work-layout-module-centralises-all-work-paths` landed, PR #173): the Phase-0
> centralisation routed every PATH-CONSTRUCTION site through `work-layout`, but it
> DELIBERATELY left ~26 `work/<folder>` literals in `src/*.ts` that are NOT path
> construction: doc-comments, error/log/`--help` PROSE, and embedded CI-workflow
> template YAML (e.g. the `work/questions/**` push-trigger globs in
> `advance-ci-template.ts` / `advance-lifecycle-template.ts`, and agent-prompt
> example JSON). Those are legitimate human-readable text, not paths, and the
> centralisation slice correctly left them. THEREFORE this guard MUST be
> context-aware: scope the rule to PATH-CONSTRUCTION literals (a `work/<folder>`
> string used as a path, i.e. the kind `work-layout` helpers now build), NOT a
> blanket text-regex over every source line, or it will FALSE-POSITIVE on those ~26
> legitimate prose/template strings and red the acceptance gate. Allow-list
> `work-layout` as the one home of path-construction literals; do NOT satisfy the
> rule by per-file disables or by deleting the legitimate prose. If a precise
> path-context detection is impractical, distinguishing "inside a string passed to a
> path/`join`/template-path site" from "prose in a comment or a triggers: glob" is
> the cut line the guard must encode. (This does not change the criteria below; it
> tells you HOW to keep criterion #5's gate green given the intended residual.)

## Acceptance criteria

- [ ] A test asserts no `.ts` under `packages/dorfl/src` except
      `work-layout` contains a raw `work/<folder>` literal.
- [ ] The allow-list is exactly the `work-layout` module (the single permitted
      home); the rule cannot be satisfied by sprinkling per-file disables.
- [ ] The failure message names the offending file + line(s) so a regression is
      immediately locatable.
- [ ] The guard scans SOURCE only, not test fixtures (which legitimately hold
      literal `work/...` paths for throwaway-repo construction).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- `work-layout-module-centralises-all-work-paths`, the guard can only pass once
  the literals have been routed through `work-layout`.

## Prompt

> Add a structural guard test for the `folder-taxonomy-reorg-and-rename` PRD: no
> `.ts` outside the `work-layout` module may contain a raw `work/<folder>` path
> literal. This locks in the Phase-0 centralisation so it cannot silently regress.
>
> FIRST, check this slice against current reality: confirm the `work-layout` module
> now exists and the centralisation slice
> (`work-layout-module-centralises-all-work-paths`) has landed in `done/`. If the
> literals are still scattered (centralisation not done), this guard would fail on
> legitimate code, route to needs-attention rather than weakening the guard to
> pass.
>
> Domain vocabulary + where to look: the house pattern for a source-scanning
> structural guard is `ledger-lint.test.ts` / `main-divergence-guard.test.ts`,
> follow it. The single allowed home for `work/<folder>` literals is the
> `work-layout` module. Scan `packages/dorfl/src` only; test fixtures under
> `test/` legitimately contain literal `work/...` paths (they construct throwaway
> repos) and must NOT be flagged.
>
> "Done" means: the guard exists, passes against the centralised tree, fails loudly
> (with file + line) if a raw `work/<folder>` literal reappears in `src/` outside
> `work-layout`, and the full acceptance gate is green.
