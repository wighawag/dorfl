---
title: 'camelCase frontmatter + needsAnswers axis — parser/eligibility migration'
slug: camelcase-frontmatter-and-needsanswers
spec: auto-slice
humanOnly: true
blockedBy: []
covers: []
---

## What to build

The Phase-2 CODE migration for the field-naming + two-axis decisions that were made in docs only (WORK-CONTRACT.md, `docs/adr/methodology-and-skills.md` §4, CONTEXT.md). This brings the parser, eligibility, and all consumers in line with the contract, atomically, keeping the acceptance gate green. (Docs already describe the target state; this slice makes the code match.)

End-to-end:

- **Frontmatter parser** (`packages/dorfl/src/frontmatter.ts`): rename the parsed key `blocked_by` → **`blockedBy`** (the `Frontmatter.blockedBy` field name is already camelCase; only the YAML key the parser matches changes), and add parsing for **`needsAnswers`** (boolean | undefined, same shape as `humanOnly`). The parser must also be usable for **SPEC** frontmatter (read `humanOnly`, `needsAnswers`, `sliceAfter`, `sliced` from a `work/spec/<slug>.md`) — extend the parsed shape as needed for `auto-slice` to consume later.
- **Eligibility** (`eligibility.ts`): add `needsAnswers` to the gate. The predicate becomes **agent-eligible iff `needsAnswers !== true` AND `humanOnly !== true` AND `allowAgents`** (both axes block; a human is never bound). Thread it through `EligibilityInput`/`resolveGate`.
- **Consumers**: thread `needsAnswers` through `scan`, `categorise`, `format`, `select`/`run` wherever `humanOnly` currently flows, and surface it in the human dashboard groupings (a `needsAnswers` item is gated like a `humanOnly` one, with its own label so the REASON is visible).
- **Rename across committed work files**: update every `work/**/*.md` (backlog, in-progress, done, spec) that uses `blocked_by:` → `blockedBy:`, and drop any `claimed_by:` / `claimed_at:` / `created:` frontmatter lines (now removed from the contract). Do this in the SAME change as the parser rename so no committed file is ever read by a parser that doesn't understand its keys.
- **Tests**: update all tests referencing the old key / shape (`frontmatter`, `scan`, `eligibility`, `categorise`, `format`, `run`, helpers `gitRepo.ts`, `complete`) and ADD coverage for the `needsAnswers` axis (the full `humanOnly × needsAnswers × allowAgents × deps` matrix) and for `blockedBy` parsing.

Note: `humanOnly` and `allowAgents` are ALREADY camelCase and shipped — do NOT rename them. `sliceAfter` parsing/enforcement for PRDs is part of `auto-slice`, not this slice (this slice only needs the parser to be ABLE to read it).

## Acceptance criteria

- [ ] Parser matches the YAML key `blockedBy` (not `blocked_by`) and parses `needsAnswers` as boolean | undefined, mirroring `humanOnly`.
- [ ] Eligibility blocks an item when `needsAnswers === true` (independently of `humanOnly`), and the four-state `humanOnly × needsAnswers` matrix resolves per the contract predicate.
- [ ] `scan` / dashboard surface `needsAnswers` items as gated, with a distinct reason label from `humanOnly`.
- [ ] No committed `work/**/*.md` uses `blocked_by`, `claimed_by`, `claimed_at`, or `created`; all dependency frontmatter uses `blockedBy`.
- [ ] All existing tests updated; new tests cover `needsAnswers` + `blockedBy`.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

## Blocked by

- None — can start immediately. (The docs/contract already specify the target.)

## Prompt

> Implement the Phase-2 code migration for the field-naming + two-axis autonomy decisions. READ FIRST: `skills/to-slices/WORK-CONTRACT.md` (the "Field-naming convention", "Frontmatter (YAML)", "two autonomy axes", and "sliceAfter" sections) and `docs/adr/methodology-and-skills.md` §4 — these are the authoritative target; your job is to make the code match them.
>
> Scope: (1) in `packages/dorfl/src/frontmatter.ts`, rename the matched YAML key `blocked_by` → `blockedBy` and add `needsAnswers` parsing (boolean | undefined, exactly like `humanOnly`); ensure the parser can also read SPEC-level `humanOnly`/`needsAnswers`/`sliceAfter`/`sliced`. (2) In `eligibility.ts`, add `needsAnswers` to the gate: agent-eligible iff `needsAnswers !== true && humanOnly !== true && allowAgents`. (3) Thread `needsAnswers` through every consumer `humanOnly` flows through (`scan`, `categorise`, `format`, `select`/`run`) and surface it in the dashboard with its own reason label. (4) In the SAME change, rewrite every committed `work/**/*.md`: `blocked_by:` → `blockedBy:`, and delete `claimed_by:` / `claimed_at:` / `created:` lines. (5) Update all affected tests and add coverage for the `needsAnswers` axis and `blockedBy` parsing.
>
> Do NOT rename `humanOnly` or `allowAgents` (already camelCase + shipped). Do NOT implement `sliceAfter` enforcement (that is the `auto-slice` slice) — only make the parser able to read it. Match house style (tabs, single quotes, vitest). "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
