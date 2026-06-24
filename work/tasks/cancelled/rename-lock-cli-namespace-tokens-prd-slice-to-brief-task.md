---
title: Rename the prd:/slice: lock+CLI namespace tokens to brief:/task: (+ orphan-lock sweep)
slug: rename-lock-cli-namespace-tokens-prd-slice-to-brief-task
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
reason: superseded
---

> **CANCELLED / SUPERSEDED 2026-06-22 (decided conductor + human, during the `drive-tasks` backlog drive).**
> This task's load-bearing premise — that the per-item-lock + CLI/advance namespace TOKENS still
> spell `prd:`/`slice:` and must be cut over to `brief:`/`task:` — was already STALE at decomposition
> time. The token cutover landed in PR #179 (`slice-task-prd-brief-vocabulary-hard-cutover`, merged
> 2026-06-19), BEFORE this task was decomposed from the brief on 2026-06-22. Live code already
> constructs/parses ONLY the new tokens at every seam this task named: `slug-namespace.ts`
> (`TASK_PREFIX='task:'`/`BRIEF_PREFIX='brief:'`, old prefixes gone), `item-lock.ts`/`sidecar.ts`
> (lock entry = `task-<slug>`/`brief-<slug>`), the advance arg resolver (bare/`task:`/`brief:`/`obs:`),
> and the CI emitters (they emit `task:`/`brief:`/`obs:` legs). No `slice:`/`prd:` token literal remains
> in live code. The 3rd criterion (document the one-shot orphan-lock sweep) needs NO code: `release-lock`
> / `gc --ledger` already name lock refs by raw ref string, so they can clear an old-token (`slice-`/`prd-`)
> ref already (6 such orphaned `slice-*` locks were observed lingering on the local hub mirror at drive time
> — harmless, and clearable with the existing `release-lock`). The dependent `rename-config-keys-slicing-to-tasking`
> had its `blockedBy` updated to drop this slug, since this task's substance is already on `main`.

## What to build

Rename the namespaced item-identity TOKENS used on per-item lock refs and in the CLI/advance argument grammar from `prd:`/`slice:` to `brief:`/`task:`, end-to-end (lock acquire/release/status/scan, the advance tick arg resolver, the apply/surface identity strings, and every place that parses or constructs `<type>:<slug>`). This is a CLEAN BREAK (Decision 1): no dual-read of old tokens.

Because existing per-item lock refs in a live arbiter are keyed by the OLD token (`refs/dorfl/lock/prd-<slug>` / `slice-<slug>` and the `action`/identity body), they become unreachable after the cutover. Provide the one-shot recovery: ensure `gc --ledger` (the existing stuck/orphan-lock report + `release-lock`) can NAME and clear an old-token lock, and document the manual sweep step in the cutover notes. Do NOT add a long-lived back-compat reader.

GENERATED CI is in scope: the CI template emitters (`advance-ci-template.ts`, `advance-lifecycle-template.ts`, `close-job-template.ts`, `intake-trigger-template.ts`) bake the `prd:`/`slice:` namespace tokens into the workflow YAML they emit (e.g. `advance prd:<slug>` legs, `.namespace + ":" + .slug` jq). These MUST be renamed WITH the tokens or freshly-generated CI emits dead `prd:`/`slice:` legs against a runner that no longer understands them. Rename the emitted tokens and update the template-snapshot tests in this task. (Agents never edit `.github/workflows/*` directly — you edit the EMITTERS, the source; see CONTEXT.md.)

## Acceptance criteria

- [ ] No live (non-test-fixture, non-`work/`-history) code constructs or matches the tokens `prd:` / `slice:` / `prd-<slug>` / `slice-<slug>` as an item-identity namespace; the live tokens are `brief:` / `task:` (and the ref spelling `brief-<slug>` / `task-<slug>`).
- [ ] Lock acquire / release / status / scan, the advance tick arg resolver (bare / `brief:` / `task:` / `obs:`), and the apply/surface identity strings all round-trip the new tokens.
- [ ] `gc --ledger` (and `release-lock`) can name and clear a lock ref written under the OLD token; the cutover note documents the one-shot manual sweep.
- [ ] The CI template emitters (`advance-ci-template.ts`, `advance-lifecycle-template.ts`, `close-job-template.ts`, `intake-trigger-template.ts`) emit the NEW tokens; their snapshot tests are updated; no emitted workflow carries `prd:`/`slice:` legs.
- [ ] Tests cover the new tokens (rename the asserting fixtures/expectations in the SAME task); the suite is green.
- [ ] No shared/global write is introduced; tests stay isolated to throwaway repos + local `--bare` arbiters.

## Blocked by

- None — can start immediately. (Foundational; other rename tasks build on the new tokens.)

## Prompt

> Goal: cut the per-item-lock and CLI/advance namespace tokens over from `prd:`/`slice:` to `brief:`/`task:` as a CLEAN BREAK, per brief `code-identifier-slice-prd-to-task-brief-rename` (Decision 1). The user-facing vocabulary is already `task`/`brief`; only the code identifiers lag.
>
> FIRST check this against current reality (it is a launch snapshot): confirm the token grammar still lives where this task assumes (the item-lock module, the advance arg resolver, the claim/release/status/scan paths, apply/surface identity construction) before editing. If the lock model changed, route to needs-attention rather than building on a stale premise.
>
> Where to look (by concept, not brittle paths): the per-item lock module (acquire/release/state-machine), `claim`/`scan`/`status`, the advance tick arg/namespace resolver, the apply-persist / surface-persist identity strings, and `gc`'s ledger/stuck-lock report + `release-lock`. Search the codebase for the literal token strings to find every site.
>
> Seams to test at: the lock-ref round-trip (acquire under the new token, release/status find it), the advance arg resolver (bare = task, `brief:`/`task:`/`obs:` prefixes), and the `gc --ledger` / `release-lock` path naming an OLD-token ref so a real arbiter can be swept once at cutover.
>
> Done = `pnpm -r build && pnpm -r test && pnpm format:check` green with the new tokens everywhere live, the old tokens gone from live code, and the one-shot sweep documented. Record any non-obvious in-scope decision (e.g. exact ref spelling) per WORK-CONTRACT.md.

---

### Claiming this task

```sh
dorfl claim rename-lock-cli-namespace-tokens-prd-slice-to-brief-task --arbiter <remote>
git fetch <remote> && git switch -c work/rename-lock-cli-namespace-tokens-prd-slice-to-brief-task <remote>/main
# on completion:
git mv work/tasks/todo/rename-lock-cli-namespace-tokens-prd-slice-to-brief-task.md work/tasks/done/rename-lock-cli-namespace-tokens-prd-slice-to-brief-task.md
```
