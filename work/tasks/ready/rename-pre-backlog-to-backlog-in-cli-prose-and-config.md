---
promotedFrom: observation:promote-cli-prose-still-says-pre-backlog-2026-07-11
---

## What to build

Retire the `pre-backlog` vocabulary throughout the dorfl CLI and its config cascade, in favor of `backlog`. The staged folder is `work/backlog/` and the pool side stays `ready`. This is a real rename, not a prose-only touch-up — `pre-backlog` is NOT a stable UX/config token to preserve.

Scope covers both user-visible prose AND the accepted-value / type cascade:

1. `--tasks-land-in <pre-backlog|ready>` flag
   - Rename the accepted value `pre-backlog` -> `backlog` in `packages/dorfl/src/cli.ts` wherever this flag is declared / parsed / documented.
   - Cascade into the env-config enum, the `tasksLandIn` / `explicitTasksLandIn` config union types (`packages/dorfl/src/tasking.ts`, `packages/dorfl/src/do.ts`), and `landingToSide` — the union becomes `'backlog' | 'ready'`.
   - Update related prose in `ledger-write.ts`, `needs-attention.ts`, and `repo-config.ts` to match.

2. `promote` verb wiring in `packages/dorfl/src/cli.ts` (call sites from observation body):
   - `.description(...)` around L3580: replace `work/pre-backlog/<slug>.md -> work/backlog/<slug>.md` and "the tasks in pre-backlog/" with the live layout using `workFolderPrefix(...)` (matching how the spec side of the same message is already written).
   - Surrounding comment ~L3570.
   - Empty-list message ~L3608 ("Nothing staged to promote ... (work/pre-backlog/ ...)").

3. Widen the sweep to ALL user-visible prose sites in `packages/dorfl/src/cli.ts` that hardcode `work/backlog/` (or `pre-backlog`) in prose, not just the promote-verb wiring. From the observation's follow-up scan:
   - `claim` ~L1520
   - `prompt` ~L1793
   - `from-issue` ~L3828
   - `remote-scan` ~L4176
   Route these through `workFolderPrefix(...)` the same way, so the user-facing vocabulary is consistent in one pass and no straggler prose is left behind.

4. Update / add tests to cover the renamed flag value and the new prose so a future regression is caught. Grep the repo for any remaining `pre-backlog` occurrences after the change and either update them or justify their retention in-line.

Acceptance: `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` all green, and `rg -n 'pre-backlog' packages/dorfl/src` returns only intentional survivors (e.g. changelog-style notes), if any.

## Prompt

> Rename `pre-backlog` -> `backlog` across the dorfl CLI's user-visible prose, its `--tasks-land-in` accepted value, and the config/type cascade. The staged folder is `work/backlog/`; the pool side stays `ready`. This is a real rename — `pre-backlog` is NOT a stable UX/config token.
>
> In `packages/dorfl/src/cli.ts`:
> - Change the `--tasks-land-in <pre-backlog|ready>` flag so its accepted value is `backlog` instead of `pre-backlog` (update declaration, parsing, help text).
> - Fix the `promote` verb prose: the `.description(...)` (~L3580) that reads `work/pre-backlog/<slug>.md -> work/backlog/<slug>.md` and "the tasks in pre-backlog/", the surrounding comment (~L3570), and the empty-list message (~L3608 "Nothing staged to promote ... (work/pre-backlog/ ...)"). Route these through `workFolderPrefix(...)` the way the spec side of that message already does.
> - Sweep the OTHER user-visible prose sites that hardcode `work/backlog/` (or `pre-backlog`) in `cli.ts` too — at minimum `claim` (~L1520), `prompt` (~L1793), `from-issue` (~L3828), and `remote-scan` (~L4176). Do this in the same pass so vocabulary is consistent.
>
> Cascade the flag rename through:
> - the env-config enum,
> - the `tasksLandIn` and `explicitTasksLandIn` config union types in `packages/dorfl/src/tasking.ts` and `packages/dorfl/src/do.ts` (union becomes `'backlog' | 'ready'`),
> - `landingToSide`,
> - prose in `packages/dorfl/src/ledger-write.ts`, `packages/dorfl/src/needs-attention.ts`, and `packages/dorfl/src/repo-config.ts`.
>
> Update or add tests for the new flag value and the new prose. Then run `pnpm format`, and verify `pnpm -r build && pnpm -r test && pnpm format:check` is green. Finally `rg -n 'pre-backlog' packages/dorfl` and either fix or explicitly justify each remaining hit.
>
> Do NOT perform any git operations; the runner owns git-state transitions.
