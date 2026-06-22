---
title: review-gate non-blocking nits for 'work-layout-guard-catch-absolute-prefix-path-literals' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: work-layout-guard-catch-absolute-prefix-path-literals
needsAnswers: false
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'work-layout-guard-catch-absolute-prefix-path-literals' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the agent's structural choice to keep the `:`-suffixed git-ref prefix and the `/`-suffixed interpolated path prefix as a parallel alternation `(?:refPrefix|pathPrefix)?` rather than folding them into a single combined prefix — and consider whether the done file / PR body should carry an explicit `## Decisions` block recording it, as the slice prompt requested.
  (Slice prompt (work/tasks/done/work-layout-guard-catch-absolute-prefix-path-literals.md, `## Prompt` final paragraph): "RECORD non-obvious in-scope decisions you make while building (e.g. how you structure the prefix alternation, whether you keep the `:` and `/`-prefix branches separate or fold them)." The diff implements the separated form (test/work-layout-guard.test.ts: `const refPrefix = "[A-Za-z0-9_.$\\{\\}/-]*:"; const pathPrefix = "\\$\\{[^}]*\\}/"; const prefix = "(?:${refPrefix}|${pathPrefix})?";`) with an in-source comment explaining why, but no out-of-band Decisions record was added to the done file or the commit body (`git log -1 a79e806` shows an empty body).)

## Applied answers 2026-06-22

### q1: Triage the single non-blocking Gate-2 review nit on 'work-layout-guard-catch-absolute-prefix-path-literals': should the structural choice to keep `refPrefix` and `pathPrefix` as a parallel `(?:refPrefix|pathPrefix)?` alternation (rather than a folded combined prefix) be ratified, and if so should a follow-up slice retroactively add an explicit `## Decisions` block to the done file / a future PR body recording it — or is the in-source comment in `test/work-layout-guard.test.ts` sufficient and the observation can be dropped?

DROPPED — the rationale is durably recorded at the choice site (the in-source comment in `test/work-layout-guard.test.ts` documenting the parallel `refPrefix`/`pathPrefix` alternation), Gate 2 already approved without a `## Decisions` block, and a retroactive done-file edit is churn for one nit. Part of the recurring "decision recorded in-source, not in a `## Decisions` block" pattern captured in the meta-observation — if it recurs a third time, that pattern is worth its own "enforce-or-relax the Decisions convention" item rather than chasing this one retroactively. Disposition: dropped.

disposition: dropped

## Recommended: delete

A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.
