---
needsAnswers: true
---

# Stale `slice:`/`prd:` tokens in the slice-only-command guard comments (cli.ts)

2026-06-22 (noticed during `rename-cli-verb-and-flags-do-prd-to-do-brief`).

After the `task:`/`brief:` namespace-token cutover (PR #179), several doc comments
in `packages/agent-runner/src/cli.ts` (e.g. the `resolveSliceOnlySlug` docstring
~L826, and the repeated "Slice-only command (§3a): accept bare + `slice:`, reject
`prd:`" comments at ~L916/923/1339/1545/1604/1707/3134) still describe the guard
in the RETIRED tokens. The actual code (`resolveSliceOnlyArg` in
`slug-namespace.ts`) now accepts `task:` and rejects `brief:` with an "operates on
tasks, not briefs" message, so these comments directly contradict the code they
annotate. The same applies to the broad `do prd:`/`prd:<slug>`/`slice:<slug>`
doc-comment wording across `do.ts`, `slicing.ts`, `advance.ts`, `intake.ts`,
`config.ts`, `prd-complete.ts`, etc.

Left untouched here: this is doc-comment prose, owned by
`rename-slicing-modules-and-symbols-to-tasking` ("doc comments in the touched
modules use task/brief/tasking wording") and the protocol/skills prose sweep, not
the CLI flag/verb rename. Captured so the contradiction is not lost.
