---
title: 'advance-lifecycle-template.ts / advance-ci-template.ts / tasking-lock.ts src JSDoc still say the artifact word (out of the erase-artifact-word task scope)'
date: 2026-07-10
triaged: resolve
---

## What I saw

While erasing the artifact word tree-wide (`erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary`), I noticed `packages/dorfl/src` still carries the artifact word in comment/JSDoc PROSE in a few modules the task did not authorize me to sweep (only `tasking.ts` was the sanctioned code leak):

- `advance-lifecycle-template.ts` + `advance-ci-template.ts`: JSDoc/comment prose still says `` `PRD` `` (e.g. "a ready ungated `PRD` would never become a matrix leg", "taskable-`PRD` pools"). The committed doc copy `docs/ci/advance-loop.yml.template` WAS swept by this task, so the emitter's inline template + comments now diverge in prose word from the committed copy.
- `tasking-lock.ts`: the `prd -> prd-tasked` lifecycle-move shorthand in JSDoc (x3) is stale (the folders are `work/specs/ready` -> `work/specs/tasked` now).

## Why I did NOT fix it here

Out of scope: the task's ONE authorized code leak was `tasking.ts` `buildTaskingSpec`; the leak scan it extends is WORD-scoped over `CONTEXT.md`/`README.md`/`AGENTS.md`/`skills` (non-protocol)/`docs`/`work/**`, NOT `packages/dorfl/src` prose. The source-part identifier scan (`prd-to-spec-leak-scan.test.ts`) deliberately EXEMPTS domain-PROSE `` `prd` ``/`` `PRD` `` in doc-comments, so these do not fail any gate.

## Suggested fix (for a future task)

Sweep the artifact word `` `prd` ``/`` `PRD` `` in the `packages/dorfl/src` JSDoc/comment prose (`advance-lifecycle-template.ts`, `advance-ci-template.ts`, `tasking-lock.ts`, and any sibling) to `spec`, and flip the `prd -> prd-tasked` shorthand to `specs/ready -> specs/tasked`, preserving the code aliases (`prd:` field/verb, the namespace forms). Consider widening the source-part identifier scan (or the new WORD scan) to also assert no artifact-word `` `PRD` `` in `src` doc-comment prose so it cannot re-drift.
