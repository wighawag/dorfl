## Why

Gate-2 review of `merge-retries-gate-precedence` approved the change but surfaced two real follow-ups plus a process note. The human ratified the four in-scope decisions from that task inline (see "Ratified decisions" below) and asked that nits 1+2 be executed as one small task; nit 3 is a process note only, the landed commit body is NOT to be rewritten.

## Ratified decisions (from the original task, recorded here for the durable record)

1. **1000 is the modest default.** The agent picked the engine's existing `DEFAULT_MERGE_RETRIES = 1000` so behaviour is byte-for-byte unchanged when nothing sets `mergeRetries`. This is now ratified as "the modest default" going forward.
2. **Flag parsing mirrors `--review-max-rounds`:** negatives, non-integers, and empty string are parse-or-drop (rejected/ignored) rather than silently coerced.
3. **Resolution happens ONCE per `performComplete`** (not re-resolved deeper in the call graph).
4. **Cross-task callers (`intake.ts`, `tasking.ts`, `recover-isolated.ts`) were intentionally NOT threaded in that task** — that scope is picked up by THIS task (nit 2 below).

## Scope of this task

### 1. Update the stale SPEC line (nit 1)

- File: the spec for `merge-retries-gate-precedence`, around line 158, currently says `DEFAULT_MERGE_RETRIES = 5`.
- Change it to reflect that the ratified modest default is `1000` (the engine's existing `DEFAULT_MERGE_RETRIES`), and note that behaviour is unchanged from pre-task when nothing sets `mergeRetries`.
- Do not rewrite history/lens narrative beyond correcting the stale number and (if needed) a short sentence explaining the ratification.

### 2. Thread `mergeRetries` through the remaining `performIntegration` callers (nit 2 — the real correctness gap)

Today only `run.ts`, `do.ts`, and `complete.ts` forward a resolved `mergeRetries` into `performIntegration`. These other callers do not, so on their paths a per-repo config / env var / CLI-flag cap is silently dropped and the engine default takes over:

- `packages/dorfl/src/tasking.ts:632`
- `packages/dorfl/src/intake.ts:1157`
- `packages/dorfl/src/intake.ts:1297`
- `packages/dorfl/src/recover-isolated.ts:169`

For each site:

- Resolve `mergeRetries` using the SAME precedence chain used in `complete.ts` (CLI flag > env > per-repo config > engine default), resolved ONCE at the entry point (matching decision 3 above), and forward it as an option to `performIntegration`.
- If a given entry point does not naturally have a CLI flag (e.g. intake/recover paths), still honour env + per-repo config; document any layer that legitimately does not apply.
- Reject negatives / non-integers / `''` the same parse-or-drop way `--review-max-rounds` does (decision 2).
- Keep behaviour byte-for-byte identical when nothing is set (falls through to `DEFAULT_MERGE_RETRIES = 1000`).

### 3. Tests

- Add coverage that a per-repo config / env-set `mergeRetries` is actually honoured on each of the four newly-threaded call sites (a small unit or integration test per site, or a table-driven test).
- Keep existing `complete.ts` / `run.ts` / `do.ts` tests green.

## Out of scope

- Rewriting the landed commit body of `merge-retries-gate-precedence` (nit 3). The missing Decisions block is acknowledged as a process miss; the four decisions are ratified in THIS task's body instead. Do not amend history.
- Changing the default away from 1000.
- Any other `performIntegration` refactor.

## Acceptance

- `rg 'performIntegration\(' packages/dorfl/src` shows every non-test caller either forwarding a resolved `mergeRetries` or has an explicit comment justifying why it cannot.
- SPEC line ~158 no longer says `5`; it says `1000` (or references `DEFAULT_MERGE_RETRIES` without contradicting it).
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- The PR/commit body for THIS task includes a Decisions block listing: (a) 1000 ratified as modest default, (b) parse-or-drop mirrors `--review-max-rounds`, (c) resolved once per entry point, (d) which call sites were threaded and how each layer (flag/env/config) applied per site.

## Prompt

> Build the task 'thread-merge-retries-cross-task-and-ratify-default', described above.
