---
needsAnswers: false
status: resolved
resolvedBy: rename-slicing-modules-and-symbols-to-tasking
resolvedDate: 2026-06-23
triaged: keep
---

# Stale `slice:`/`prd:` tokens in the slice-only-command guard comments (cli.ts)

> RESOLVED 2026-06-23 by `rename-slicing-modules-and-symbols-to-tasking`. The
> `resolveTaskOnlySlug` docstring (~L827) and every repeated "Slice-only command
> (§3a): accept bare + `slice:`, reject `prd:`" guard comment were rewritten to the
> task:/brief: reality ("Task-only command (§3a): accept bare + `task:`, reject
> `brief:`"; "operates on tasks, not briefs"). The broad `do prd:` -> `do brief:`
> + `slicing path/gate/transition` -> `tasking ...` + renamed-symbol `{@link}`/
> backtick references were swept across the touched modules (cli.ts, do.ts,
> intake.ts, ledger-read.ts, scan.ts, select-priority.ts, mirror-pool-scan.ts,
> close-job.ts, review-gate.ts, prompt.ts, item-lock.ts, work-layout.ts,
> slug-namespace.ts, advance-drivers.ts, lifecycle-pools.ts). NOT in this task's
> scope and deliberately left for their owners: `config.ts` config-key prose
> (`slicerLoop*` keys owned by a later key-rename task), `advance.ts`, the
> `SLICING-PROTOCOL.md` path (dependent protocol-doc task), the `select-order.ts`
> `'slice'` selection-pool VALUE literal, and the wire-level enum literals
> (`'sliced'` / `'uncertain-slices'` / `type:'slicing'`) that cross into lock-ref
> disk state + commit tags (a ratified separate-follow-up deferral).


2026-06-22 (noticed during `rename-cli-verb-and-flags-do-prd-to-do-brief`).

After the `task:`/`brief:` namespace-token cutover (PR #179), several doc comments
in `packages/dorfl/src/cli.ts` (e.g. the `resolveSliceOnlySlug` docstring
~L826, and the repeated "Slice-only command (§3a): accept bare + `slice:`, reject
`prd:`" comments at ~L916/923/1339/1545/1604/1707/3134) still describe the guard
in the RETIRED tokens. The actual code (`resolveSliceOnlyArg` in
`slug-namespace.ts`) now accepts `task:` and rejects `brief:` with an "operates on
tasks, not briefs" message, so these comments directly contradict the code they
annotate. The same applies to the broad `do prd:`/`prd:<slug>`/`slice:<slug>`
doc-comment wording across `do.ts`, `slicing.ts`, `advance.ts`, `intake.ts`,
`config.ts`, `spec-complete.ts`, etc.

Left untouched here: this is doc-comment prose, owned by
`rename-slicing-modules-and-symbols-to-tasking` ("doc comments in the touched
modules use task/brief/tasking wording") and the protocol/skills prose sweep, not
the CLI flag/verb rename. Captured so the contradiction is not lost.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:rename-slicing-modules-and-symbols-to-tasking` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation's own front-matter declares status: resolved, resolvedBy: rename-slicing-modules-and-symbols-to-tasking, and that task is in work/tasks/done/ — the cli.ts guard-comment sweep was executed there. Unambiguous map to that single existing item.
