---
title: Cut docs/adr prose over to task/brief/tasking vocabulary (coherence sweep)
slug: rename-adr-prose-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

## What to build

Sweep the retired vocabulary out of the ADR prose under `docs/adr/`, replacing slice/PRD/slicing with task/brief/tasking where the words refer to the live concepts. ADRs are durable but editable for vocabulary coherence (CONTEXT.md "Coherence").

Important boundary: an ADR's recorded DECISION and its historical framing must not be falsified. Where an ADR genuinely describes a past state (e.g. "originally we used a `work/slicing/` folder"), keep the historical term and, if helpful, note the current name in parentheses. Only rename where the word denotes the CURRENT concept. Keep real historical slugs (filenames like `*-slicing-vs-build`, decision names) verbatim.

This task is fully file-orthogonal (only `docs/adr/*.md`), so it can run any time.

## Acceptance criteria

- [ ] ADR prose uses task/brief/tasking for the CURRENT concepts; genuine historical references are preserved (with a current-name note where useful).
- [ ] No real historical slug or decision name is altered.
- [ ] No code or test changes; build/test/format:check stays green (format covers the markdown).

## Blocked by

- None — can start immediately. (Touches only `docs/adr/`.)

## Prompt

> Goal: a vocabulary-coherence sweep of `docs/adr/` prose, slice/PRD/slicing → task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. Docs-only, fully orthogonal.
>
> FIRST check reality: read each ADR before editing — distinguish a word denoting the CURRENT concept (rename it) from one describing a PAST state the ADR is recording (keep it, optionally note the current name). Do not falsify a recorded decision or its history. Keep real historical slugs verbatim.
>
> Where to look: `docs/adr/*.md`. Grep for `slic`/`prd`/`PRD`. Run `pnpm format` after editing so the prettier gate passes.
>
> Done = format:check green, ADR prose coherent with the live task/brief/tasking vocabulary, history intact.

---

### Claiming this task

```sh
agent-runner claim rename-adr-prose-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-adr-prose-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-adr-prose-slicing-to-tasking.md work/tasks/done/rename-adr-prose-slicing-to-tasking.md
```
