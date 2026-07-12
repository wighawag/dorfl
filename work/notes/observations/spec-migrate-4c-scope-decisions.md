---
needsAnswers: true
---

# 2026-07-10 — sub-batch (c) spec→spec: scope/coherence decisions

Recorded while building `rename-spec-remaining-src-modules-c` (do/advance family consumers + `do spec:`/`advance spec:` verb dispatch + `spec-complete.ts → spec-complete.ts`). These are the judgement calls where the task's literal file/symbol list met the code's actual shape. Full gate green (`pnpm -r build && pnpm -r test && pnpm format:check`; 2918 tests).

## 1. The selection→arg mappers were LEFT UNCHANGED (type-blocked, and not the routing path)

The task prompt says "add `|| resolved.namespace === 'spec'` beside the `=== 'spec'` routes in `do.ts:711`/`:1893` + `advance.ts`/`advance-drivers.ts`/`do-autopick.ts`". I added the `spec` branch to the three sites that consume the RESOLVER namespace (`SlugNamespace`, which HAS `'spec'`): `do.ts:711`, `do.ts:1893` (dispatch), and `advance.ts sidecarTypeFor` (line ~431, maps `'spec' → 'spec'` sidecar type). Those are the load-bearing routing sites.

The other named "peers" — `argForSelectedItem` (`do-autopick.ts`), `argForSelected` (`advance-drivers.ts`, `advance-isolated.ts`, `advance-loop-driver.ts`), `remoteArgFor` (`do-remote-auto.ts`), `runSelectedInSequence` (`do-autopick.ts`) — switch on `item.namespace` typed `SelectedNamespace = 'task' | 'spec' | 'observation'` (owned by `select-priority.ts`, which is sub-batch (a)/(b) territory I must NOT touch). Under `strict:true`, adding `item.namespace === 'spec'` there is a TS2367 no-overlap ERROR, and it would be dead code anyway: the selection layer never emits `'spec'` until `SelectedNamespace` is migrated (a/b/contract). The `do spec:`/`advance spec:` routing this task delivers flows entirely through the EXPLICIT-arg path: `resolveSlug('spec:x')`/`resolveAdvanceArg('spec:x')` → `{namespace:'spec'}` → the dispatch sites above. Verified end-to-end by two new tests (`do spec:<slug>` → tasked; `advance spec:<slug>` → `task-spec` rung). Leaving the mappers is correct, not an omission; touching them would either break the build or reach into out-of-scope types.

## 2. `renderPrdBody` lives in `buildable-body.ts`, not `spec-complete.ts`

The task lists the symbol `renderPrdBody` as mine ("+ symbols `renderPrdBody`/`PrdTask`") and batch (a) explicitly carved it out for 4c. But `renderPrdBody`/`RenderPrdBodyInput` are defined in `buildable-body.ts` (not in the task's file list, which names `spec-complete.ts`). I renamed them `renderSpecBody`/`RenderSpecBodyInput` at the definition + every importer (`index.ts` re-export, `intake.ts`, `triage-persist.ts`, `buildable-body.test.ts`) atomically, same pattern as batch (a)'s exported-symbol renames. The file-list omission of `buildable-body.ts` is an oversight in the task prose; the symbol assignment (cross-referenced by (a)) is unambiguous, and renaming an internal export requires editing its definition file. `spec-complete.ts`'s own symbols (`isPrdComplete → isSpecComplete`, `PrdCompleteInput/Result → Spec*`, `PrdTask → SpecTask`) rode the `git mv` to `spec-complete.ts`.

## 3. `triage-persist` `artifact === 'spec'` and `needs-attention` `{namespace:'spec'}` were LEFT as-is

The acceptance criterion lists triage-persist + needs-attention as files whose `namespace === 'spec'` consumers should also match `'spec'`. In reality neither file has a `namespace === 'spec'` consumer of the RESOLVER namespace:
- `triage-persist.ts` switches on `artifact === 'spec'` where `artifact?: 'task' | 'spec'` is fed by `verdict.outcome` (`DecisionOutcome = 'task' | 'spec' | 'adr' | 'delete' | 'ask'`, `decision-engine.ts`). That is the deliberate `spec` ARTIFACT-TYPE alias surface (no `'spec'` member), which the task says NOT to touch and the contract task removes/renames.
- `needs-attention.ts` PRODUCES `{namespace: 'spec' as const}` for a `PromotableItem` (a local type read into the `promote` verb display), the promote-alias surface.

Both are downstream of the artifact-type / promote `spec` alias, not resolver-namespace consumers. Widening them to `'spec'` would be dead code AND require editing `decision-engine.ts`/the promote alias (out of scope). Left untouched; they migrate with the alias surface in the contract task.

## Also touched (rename-consequence, pure doc comments)

`work-layout.ts` had two doc comments naming `spec-complete.ts` — updated to `spec-complete.ts` since my `git mv` made the old name dangle. Comment-only, no behaviour, no overlap with (a)/(b) symbols.
