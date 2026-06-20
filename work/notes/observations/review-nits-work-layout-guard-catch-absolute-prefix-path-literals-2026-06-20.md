---
title: review-gate non-blocking nits for 'work-layout-guard-catch-absolute-prefix-path-literals' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: work-layout-guard-catch-absolute-prefix-path-literals
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'work-layout-guard-catch-absolute-prefix-path-literals' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the agent's structural choice to keep the `:`-suffixed git-ref prefix and the `/`-suffixed interpolated path prefix as a parallel alternation `(?:refPrefix|pathPrefix)?` rather than folding them into a single combined prefix — and consider whether the done file / PR body should carry an explicit `## Decisions` block recording it, as the slice prompt requested.
  (Slice prompt (work/tasks/done/work-layout-guard-catch-absolute-prefix-path-literals.md, `## Prompt` final paragraph): "RECORD non-obvious in-scope decisions you make while building (e.g. how you structure the prefix alternation, whether you keep the `:` and `/`-prefix branches separate or fold them)." The diff implements the separated form (test/work-layout-guard.test.ts: `const refPrefix = "[A-Za-z0-9_.$\\{\\}/-]*:"; const pathPrefix = "\\$\\{[^}]*\\}/"; const prefix = "(?:${refPrefix}|${pathPrefix})?";`) with an in-source comment explaining why, but no out-of-band Decisions record was added to the done file or the commit body (`git log -1 a79e806` shows an empty body).)
