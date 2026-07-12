---
promotedFrom: observation:spec-migrate-4c-scope-decisions
---

## What to build

Add the durable lessons from the answered observation `observation:spec-migrate-4c-scope-decisions` into the shared rename/cutover-lessons finding under `work/notes/findings/` (the same note gathering D6's surface-class checklist). Two lessons to capture:

1. **The three-surface distinction for a `spec`/`prd`-style rename.** When renaming a namespace-ish token, distinguish:
   - **Resolver namespace** — the `SlugNamespace` union produced by `resolveSlug` / `resolveAdvanceArg`. This is the load-bearing routing surface (e.g. `do.ts:711`, `do.ts:1893`, `advance.ts sidecarTypeFor`). Widen these.
   - **Selection namespace** — a distinct union (`SelectedNamespace = 'task' | 'spec' | 'observation'`) owned by the selection layer (`select-priority.ts`). Sites switching on `item.namespace` of this type (`argForSelectedItem`, `argForSelected`, `remoteArgFor`, `runSelectedInSequence`) CANNOT be widened until the selection union itself migrates — adding a new branch is a TS2367 no-overlap error under strict, and would be dead code because the selection layer never emits the new value.
   - **Artifact-type / promote-alias surface** — e.g. `verdict.outcome: DecisionOutcome` in `decision-engine.ts` (consumed by `triage-persist.ts` via `artifact === 'spec'`) and locally-typed `PromotableItem` fields in `needs-attention.ts`. These are alias surfaces, not resolver-namespace consumers; touching them requires editing the alias source (`decision-engine.ts` / promote alias) and belongs to the contract/alias-removal task, not the routing rename.
   Checklist heuristic: for each `xxx === 'oldname'` site, ask WHICH union the LHS is typed as, and route the edit to whichever sub-batch owns that union.

2. **Atomic-symbol-rename authorisation.** A task's symbol assignment (e.g. `renderPrdBody`/`PrdTask` belong to sub-batch X) implicitly authorises editing whichever file DEFINES that symbol, even if the task's file list names only a sibling file. Renaming an exported symbol requires editing its definition site or the build breaks; the task's file list is an under-approximation of the symbol assignment, not an over-approximation. No WORK-CONTRACT change is warranted — this is inherent to atomic renames — but recording it as a lesson prevents future agents from second-guessing.

If a `rename-cutover-lessons.md` (or D6 surface-class checklist) file already exists under `work/notes/findings/`, APPEND these two lessons to it, matching its existing structure. If no such consolidated note exists yet, CREATE `work/notes/findings/rename-cutover-lessons.md` with a short intro ("lessons collected across the spec/prd rename cutover and the D6 surface-class work") and these two lessons as its first sections. Cross-reference the source observation slug (`spec-migrate-4c-scope-decisions`) in a footer so provenance is discoverable.

No code changes. No protocol / WORK-CONTRACT changes. Documentation only.

## Prompt

> Add two durable lessons to `work/notes/findings/rename-cutover-lessons.md` (create it if missing; otherwise append, matching existing structure) so future rename/cutover work can reuse them.
>
> **Lesson 1 — three-surface distinction for namespace-ish renames.** When a token like `prd`→`spec` is being renamed across the codebase, three DIFFERENT surfaces look identical at a `x === 'spec'` grep but belong to different sub-batches:
> - **Resolver namespace** (`SlugNamespace` from `resolveSlug` / `resolveAdvanceArg`) — the routing surface. Load-bearing sites like `do.ts:711`, `do.ts:1893`, `advance.ts sidecarTypeFor`. Widen these in the routing sub-batch.
> - **Selection namespace** (`SelectedNamespace` in `select-priority.ts`, typically `'task' | 'spec' | 'observation'`) — a DISTINCT union consumed by `argForSelectedItem`, `argForSelected`, `remoteArgFor`, `runSelectedInSequence`. Cannot be widened until the selection union itself migrates; adding a new branch early is a TS2367 no-overlap error AND dead code.
> - **Artifact-type / promote-alias surface** — e.g. `DecisionOutcome` in `decision-engine.ts` (consumed by `triage-persist.ts artifact === 'spec'`) and locally-typed `PromotableItem` in `needs-attention.ts`. These are alias surfaces downstream of the artifact-type / promote alias, not resolver-namespace consumers. They migrate with the alias-removal / contract task.
> - Heuristic: for every `xxx === 'oldname'` hit, identify which UNION the LHS is typed as, and route the edit to that union's sub-batch.
>
> **Lesson 2 — atomic symbol renames authorise editing the defining file.** A sub-batch's symbol assignment (e.g. `renderPrdBody`/`PrdTask` belong to 4c) implicitly authorises editing whichever file DEFINES the symbol, even if the task's file list only names a sibling (e.g. lists `spec-complete.ts` but the symbol lives in `buildable-body.ts`). Renaming an exported symbol requires editing its definition site or the build breaks. The task's file list is an under-approximation of its symbol assignment, not an over-approximation. This is inherent to atomic renames — no WORK-CONTRACT change is needed, but recording the lesson prevents future agents from either splitting the rename (breaking the build) or opening a needless clarification.
>
> Reference the source observation `spec-migrate-4c-scope-decisions` in a footer for provenance. Documentation-only change: no code touched, no protocol change, no ADR.
>
> Acceptance: `pnpm -r build && pnpm -r test && pnpm format:check` all green (should be trivially so — docs-only change).
