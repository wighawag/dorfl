---
title: parseInlineList mis-parses a trailing `# comment` on `blockedBy: []`/`prdAfter: []`, marking template-default tasks ineligible (never enumerated/auto-built)
type: observation
status: spotted
spotted: 2026-06-24
reviewOf: frontmatter
needsAnswers: true
---

## What was seen

`disable-rename-detection-on-continue-rebase` (and `recovery-rebase-retry-against-moving-arbiter-main`) sit in `work/tasks/todo/` with `blockedBy: []` and no gates, yet the CI `advance-lifecycle` enumeration step never produced a `task:<slug>` leg for them — they were silently NOT considered for auto-build.

Root cause is in the frontmatter parser, not CI. `dorfl scan --json` reports:

```
"slug":"disable-rename-detection-on-continue-rebase",
"eligibility":{"eligible":false,"gatePass":true,
  "blockedBy":{"satisfied":false,"missing":["] # startable no"]}}
```

The phantom dependency `"] # startable no"` is the giveaway.

## Where (refs)

- `packages/dorfl/src/frontmatter.ts` — `parseInlineList(value)` (~L158): does `value.trim().slice(1, -1)` assuming the raw value is EXACTLY `[...]`. When the line is `blockedBy: [] # startable now`, `rawValue` is `"[] # startable now"`; `.slice(1, -1)` strips the leading `[` and the LAST CHAR (`w` of "now"), yielding `"] # startable no"`, which (no comma) becomes the single-element list `["] # startable no"]`.
- The dispatch at `frontmatter.ts` ~L351 routes any `rawValue.startsWith('[')` to `parseInlineList` without stripping a trailing inline `# comment`.
- Eligibility consumer: a non-empty `blockedBy` whose slugs aren't in `work/tasks/done/` ⇒ `eligible:false` ⇒ the CI scan/jq leg filter (`.eligibility.eligible == true`) drops the task ⇒ never enumerated.

## Why it matters (severity: high)

The trailing inline comment on `blockedBy: [] # ...` is the **documented house style**, shipped in the canonical templates `setup` propagates to EVERY repo:

- `skills/setup/protocol/task-template.md:8` — `blockedBy: [] # slugs that must reach work/tasks/done/ first; [] = startable now`
- `skills/setup/protocol/WORK-CONTRACT.md:154`, `:169` (`prdAfter: [] # ...`)
- mirrored in `work/protocol/*`.

So a task authored straight from the template is parsed as blocked-by-a-phantom-dep and is **silently un-buildable by the autonomous runner** (and mis-reported by `scan`/`status`). This is a self-inflicted, repo-wide eligibility hole: the parser disagrees with the parser's own template.

`covers: [] # ...` hits the same `parseInlineList` flaw but does NOT affect eligibility (covers isn't an eligibility input); still worth fixing for honest parsing.

## Suggested fix (for the spawned task)

Strip a trailing inline `# comment` from a flow-style scalar before `parseInlineList` (respecting `#` inside quotes / inside the `[...]`), OR find the matching closing `]` and ignore everything after it instead of blind `slice(1,-1)`. Add fixtures: `blockedBy: [] # c`, `blockedBy: [a, b] # c`, `prdAfter: [x] # c`, and a `#` INSIDE a quoted slug must survive. A regression guard that asserts the SHIPPED template lines parse to `[]` would prevent the template/parser drift recurring.

## Conduct note

Not a conduct signal — verified code defect (read `frontmatter.ts` + reproduced via the built CLI's `scan --json`).

## Update 2026-06-24 — fixed

Fixed in `frontmatter.ts`: `parseInlineList` now routes through a new quote-aware `inlineListInner(value)` helper that finds the MATCHING closing `]` and ignores everything after it (so a trailing `# comment` is dropped; a `#`/`]` inside a quoted item survives), instead of the blind `slice(1, -1)`.

Verified: `dorfl scan --json` now reports `disable-rename-detection-on-continue-rebase` and `recovery-rebase-retry-against-moving-arbiter-main` as `eligibility.eligible: true` (phantom `"] # startable no"` dep gone). Gate green: build + 2593 tests + format:check.

Tests added (`test/frontmatter.test.ts`): empty/non-empty inline `blockedBy` + `prdAfter` with trailing `# comment`, a `#`-inside-quoted-slug guard, and a parser↔template drift guard that parses the shipped `blockedBy: [] # ...` lines from `{skills/setup,work}/protocol/{task-template,WORK-CONTRACT}.md` to `[]`.
