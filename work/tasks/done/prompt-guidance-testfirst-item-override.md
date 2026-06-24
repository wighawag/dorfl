---
title: 'promptGuidance.testFirst: per-item override on task + brief frontmatter'
slug: prompt-guidance-testfirst-item-override
brief: prompt-guidance-test-first
blockedBy: [prompt-guidance-testfirst-config-and-prompt-seam]
covers: [5]
---

## What to build

Let a single task or brief override the repo-level `promptGuidance.testFirst` policy via frontmatter, with the SAME shape used for `humanOnly` / `autoBuild` at the item level. This is the per-item escape hatch: an exploratory task can opt out (`promptGuidance.testFirst: false`) even when the repo defaults to true; a critical task can opt in (`promptGuidance.testFirst: true`) even when the repo defaults to false.

End-to-end behaviour:

1. Task frontmatter (the shape parsed in `packages/dorfl/src/frontmatter.ts` and consumed wherever the prompt-assembly path reads the task) accepts an optional `promptGuidance.testFirst: true | false`. Omitted ⇒ inherit the resolved repo policy from the sibling tracer slice. Present ⇒ overrides for THIS item only.
2. Brief frontmatter accepts the SAME key, with the SAME meaning, so a maintainer can pin the nudge for an entire brief's worth of tasks at the brief level (the per-task override still wins over the per-brief override).
3. Precedence becomes (highest → lowest): per-task frontmatter > per-brief frontmatter (if the task carries a `brief:`) > resolved repo policy (CLI flag > env > per-repo > global > default `false`, from the sibling slice). Document this in the same place the existing `humanOnly`/`autoBuild` precedence is documented (`work/protocol/WORK-CONTRACT.md`); keep the SOURCE in `skills/setup/protocol/WORK-CONTRACT.md` and mirror to `work/protocol/`.
4. The prompt-assembly seam built in the sibling tracer uses the per-item-resolved value (not the repo-only value) when assembling the worker prompt.
5. Update `task-template.md` and `brief-template.md` (both SOURCE in `skills/setup/protocol/`, both MIRRORS in `work/protocol/`) with a commented-out example of the override key, matching the style of the existing commented `humanOnly` / `needsAnswers` examples.

## Acceptance criteria

- [ ] A task with `promptGuidance.testFirst: true` in frontmatter assembles a prompt with the strengthened test-first line, even when the repo default is `false`. (Asserted at the prompt-assembly seam.)
- [ ] A task with `promptGuidance.testFirst: false` in frontmatter assembles a prompt WITHOUT the strengthened line, even when the repo default is `true`.
- [ ] When the task omits the key, it inherits from the brief (if the task has a `brief:` and the brief sets it), else from the resolved repo policy.
- [ ] Precedence is per-task > per-brief > repo-resolved, with tests covering each tier and the inheritance path.
- [ ] `WORK-CONTRACT.md` documents the new per-item override in the same section that documents `humanOnly`/`autoBuild` precedence; SOURCE (`skills/setup/protocol/`) and MIRROR (`work/protocol/`) stay byte-identical.
- [ ] `task-template.md` and `brief-template.md` carry a commented example of the key, in both SOURCE and MIRROR locations.
- [ ] Unknown / mistyped values fail in the same way the existing frontmatter parser fails for `humanOnly` (no silent coerce).
- [ ] No change to `verify` semantics or to AGENTS.md.
- [ ] No test in this slice writes to a shared / global location.

## Blocked by

- `prompt-guidance-testfirst-config-and-prompt-seam` — the repo-level resolver + prompt-assembly seam must exist first so this slice only adds the per-item layer on top.

## Prompt

> You are adding the PER-ITEM OVERRIDE layer for `promptGuidance.testFirst`, on top of the repo-level resolver + prompt-assembly work landed in the blocker slice. The repo policy already flows through the prompt; this slice lets a task or brief override it, exactly like `humanOnly` / `autoBuild` can be overridden per item.
>
> FIRST: re-read the source brief (`work/briefs/ready/prompt-guidance-test-first.md`) — User Story #5 + the "Per-item override" decision — AND verify the blocker slice's seam decision (Option A/B/C). Drift-check: does the blocker actually plumb a resolved repo value into prompt assembly the way the brief assumes? If not, route to needs-attention (`work/protocol/WORK-CONTRACT.md` "Drift is a needs-attention signal").
>
> DOMAIN VOCAB: `repo policy` (the resolved value from CLI/env/config); `per-item override` (frontmatter on task or brief that supersedes the repo policy for that item); `precedence chain` (the documented ordering already used by `humanOnly`/`autoBuild`).
>
> WHERE TO LOOK: the frontmatter parser + types in `packages/dorfl/src/frontmatter.ts`; the prompt-assembly site in `packages/dorfl/src/prompt.ts` (where the blocker reads the resolved repo policy — extend it to read the item-level override too); the contract doc `skills/setup/protocol/WORK-CONTRACT.md` (SOURCE) + `work/protocol/WORK-CONTRACT.md` (MIRROR, byte-identical); the templates `task-template.md` and `brief-template.md` in the same two locations.
>
> SEAMS TO TEST AT: the prompt-assembly seam, parameterised over (repo-resolved × brief-override × task-override) to cover the precedence matrix. The frontmatter-parsing seam for type rejection (a `promptGuidance.testFirst: "yes"` string is rejected the same way a string `humanOnly` is). Do NOT test process-level behaviour ("the agent really wrote a test first") — out of scope.
>
> CONSTRAINTS: SOURCE-and-MIRROR protocol docs MUST stay byte-identical (this repo's `AGENTS.md` rule). AGENTS.md MUST NOT be touched. `verify` semantics MUST NOT change.
>
> DONE means: precedence matrix is implemented + tested; templates + WORK-CONTRACT.md document the override; `pnpm -r build && pnpm -r test && pnpm format:check` is green.
>
> RECORD non-obvious decisions (e.g. whether a task without a `brief:` can still carry the override — yes, by symmetry with `humanOnly`, but record it if anything surprising emerges).
