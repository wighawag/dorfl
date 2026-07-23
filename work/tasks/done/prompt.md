---
title: 'prompt — emit the work-agent prompt for a slice (wrapper + slice Prompt)'
slug: prompt
spec: dorfl
humanOnly: true
blockedBy: [scan]
covers: []
---

## What to build

`dorfl prompt [<slug>]` — print, to stdout, the full prompt for working a slice: the constant work-agent **wrapper** + the slice's own `## Prompt` section. This is the same prompt-assembly the autonomous runner feeds to `agentCmd` (SPEC "agentCmd prompt" decision + CLAIM-PROTOCOL "the prompt handed to the work agent") — surfaced as a human command first. Dual-use, not throwaway: it IS the runner's prompt builder.

End-to-end:

- Locate the slice file (in `work/in-progress/<slug>.md`, falling back to `work/backlog/<slug>.md`), extract its `## Prompt` body, and wrap it with the canonical work-agent wrapper (claimed-at path, read-the-file, no-git-ops on this repo, tests-may-use-throwaway-repos, stop-when-green-and-report), substituting `<slug>` and the source SPEC (`prd:` field).
- **Slug inference**: if `<slug>` is omitted and the current branch is `work/<slug>`, infer it (so on your work branch, bare `dorfl prompt` prints the prompt for the thing you're working on).
- **stdout only** — composable (`dorfl prompt foo | pbcopy`, or pipe into an agent). No launching, no side effects.

## Acceptance criteria

- [ ] `dorfl prompt <slug>` prints the wrapper + the slice's `## Prompt`, with `<slug>` and the source SPEC path substituted.
- [ ] Resolves the slice from `work/in-progress/` then `work/backlog/`.
- [ ] With no `<slug>` on a `work/<slug>` branch, infers the slug.
- [ ] Output goes to stdout only; no side effects, no launching.
- [ ] The emitted wrapper matches the canonical text in CLAIM-PROTOCOL.md ("the prompt handed to the work agent").
- [ ] Tests cover slug-given, slug-inferred-from-branch, and the in-progress-over-backlog resolution order.

## Blocked by

- `scan` — needs the package/core + frontmatter/section parsing; independent of the substrate.

## Prompt

> Implement `dorfl prompt [<slug>]` in `packages/dorfl/`: print to stdout the full work-agent prompt for a slice. READ FIRST: CLAIM-PROTOCOL.md ("the prompt handed to the work agent" \u2014 the canonical wrapper text), the SPEC's agentCmd-prompt decision, and the existing frontmatter/markdown parsing in the scan core.
>
> Assemble: the constant wrapper (points the agent at `work/in-progress/<slug>.md` as its brief; read the file + its `prd:` source SPEC; do NO git ops on this repo but TESTS may use throwaway repos; stop when build/test/format green and report)
>
> - the slice's own `## Prompt` body. Resolve the slice from `work/in-progress/` then `work/backlog/`. If `<slug>` is omitted and the branch is `work/<slug>`, infer it. stdout only, no side effects \u2014 this must be the SAME assembly the autonomous runner will use to build `agentCmd`'s prompt (dual-use).
>
> TDD with vitest: slug given, slug inferred from branch, in-progress-over-backlog resolution, and that the wrapper matches the CLAIM-PROTOCOL canonical text. Match house style; `commander`. \"Done\" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
