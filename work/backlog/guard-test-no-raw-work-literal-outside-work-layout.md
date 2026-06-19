---
title: Phase 0: guard test that no .ts outside work-layout contains a raw work/<folder> literal
slug: guard-test-no-raw-work-literal-outside-work-layout
prd: folder-taxonomy-reorg-and-rename
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

## Acceptance criteria

- [ ] A test asserts no `.ts` under `packages/agent-runner/src` except
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
> `work-layout` module. Scan `packages/agent-runner/src` only; test fixtures under
> `test/` legitimately contain literal `work/...` paths (they construct throwaway
> repos) and must NOT be flagged.
>
> "Done" means: the guard exists, passes against the centralised tree, fails loudly
> (with file + line) if a raw `work/<folder>` literal reappears in `src/` outside
> `work-layout`, and the full acceptance gate is green.
