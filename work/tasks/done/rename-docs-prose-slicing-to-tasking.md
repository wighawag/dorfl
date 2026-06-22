---
title: Cut docs/ prose (ADRs + docs/ci) over to task/brief/tasking vocabulary (coherence sweep)
slug: rename-docs-prose-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: []
covers: []
---

## What to build

Sweep the retired vocabulary out of the durable-docs PROSE under `docs/`, replacing slice/PRD/slicing with task/brief/tasking where the words refer to the live concepts. This covers BOTH `docs/adr/*.md` AND `docs/ci/README.md` (and any other non-generated `docs/*.md` carrying the old vocabulary). ADRs are durable but editable for vocabulary coherence (CONTEXT.md "Coherence").

`docs/ci/README.md` specifically carries `PRD`, `slices`, `work/prd/`, and `do prd:` prose describing the advance/CI flow; bring it in line with the task/brief/tasking vocabulary and the current folder names (`work/briefs/ready/`, `do brief:`).

Important boundary: an ADR's recorded DECISION and its historical framing must not be falsified. Where a doc genuinely describes a PAST state (e.g. "originally we used a `work/slicing/` folder"), keep the historical term and, if helpful, note the current name in parentheses. Only rename where the word denotes the CURRENT concept. Keep real historical slugs (filenames like `*-slicing-vs-build`, decision names, brief slugs such as `advance-loop`/`runner-in-ci`) verbatim.

Do NOT touch generated workflow YAML under `.github/workflows/*` (regenerated from the emitters by the token task / a human running `install-ci`); this task is prose-only.

This task is file-orthogonal (only `docs/` markdown), so it can run any time.

## Acceptance criteria

- [ ] `docs/adr/*.md` AND `docs/ci/README.md` use task/brief/tasking for the CURRENT concepts; genuine historical references are preserved (with a current-name note where useful).
- [ ] No real historical slug or decision name is altered.
- [ ] No `.github/workflows/*` or other generated file is touched.
- [ ] No code or test changes; build/test/format:check stays green (format covers the markdown).

## Blocked by

- None — can start immediately. (Touches only `docs/` markdown.)

## Prompt

> Goal: a vocabulary-coherence sweep of `docs/` prose (ADRs + `docs/ci/README.md`), slice/PRD/slicing → task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. Docs-only, fully orthogonal.
>
> FIRST check reality: read each doc before editing — distinguish a word denoting the CURRENT concept (rename it) from one describing a PAST state the doc is recording (keep it, optionally note the current name). Do not falsify a recorded decision or its history. Keep real historical slugs verbatim. Note the `tasks/todo`→`tasks/ready` pool rename is NOT yet implemented, so the live task pool is `todo`; the brief pool is already `ready`.
>
> Where to look: `docs/adr/*.md` and `docs/ci/README.md`. Grep for `slic`/`prd`/`PRD`/`work/prd/`/`do prd:`. Do NOT edit generated workflow files. Run `pnpm format` after editing so the prettier gate passes.
>
> Done = format:check green, docs prose coherent with the live task/brief/tasking vocabulary, history intact, no generated file touched.

---

### Claiming this task

```sh
agent-runner claim rename-docs-prose-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-docs-prose-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-docs-prose-slicing-to-tasking.md work/tasks/done/rename-docs-prose-slicing-to-tasking.md
```

## Requeue 2026-06-22

Gate-2 fix: docs/ci/README.md must point at work/briefs/tasked/runner-in-ci.md, NOT briefs/ready/. The runner-in-ci brief lives in briefs/tasked/ (decomposed-and-resting), confirmed via find. Fix BOTH occurrences your commit introduced (lines 13 and 125), AND the pre-existing same-class miss at line ~85 (land-time-reverify reference, also written 'ready/' but the brief is in 'tasked/') — all three are in this same file you own for the docs coherence sweep, and the acceptance criterion is 'docs use the current folder names', so a path that does not resolve is a violation, not a nit. Ignore the task PROMPT's stale hint 'work/briefs/ready/' — the correct current home for a TASKED brief is work/briefs/tasked/ (briefs/ready/ is the auto-tasking pool, a different folder). Keep all other docs-prose edits from your prior commit; just correct these brief-path references. Re-verify: grep docs/ci/README.md for 'briefs/ready/runner-in-ci' returns nothing.
