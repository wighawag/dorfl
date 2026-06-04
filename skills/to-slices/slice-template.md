---
title: <Human Readable Title>
slug: <url-safe-slug>
prd: <source-prd-slug>   # REQUIRED: slug of the work/prd/<slug>.md this slice derives from
# humanOnly: true     # gate axis 1 (DECIDED): a HUMAN must drive the build. OMIT otherwise (most slices).
# needsAnswers: true  # gate axis 2 (DISCOVERED): open questions block autonomous work. OMIT otherwise. List them in the body.
blockedBy: []        # slugs that must reach work/done/ first; [] = startable now
covers: []           # optional: user-story numbers within `prd` this slice covers
---

## What to build

A concise description of this vertical slice — the end-to-end behaviour (a thin
path through every layer: schema → logic → API/UI → tests), NOT a layer-by-layer
implementation plan. Avoid specific file paths / code snippets (they go stale).

Exception: if a prototype produced a snippet that encodes a decision more
precisely than prose (state machine, reducer, schema, type shape), inline just the
decision-rich part and note it came from a prototype.

## Acceptance criteria

- [ ] Criterion 1 (verifiable / demoable on its own)
- [ ] Criterion 2
- [ ] Tests cover the new behaviour (mirror the repo's existing test style)

## Blocked by

- None — can start immediately.
  (or: list the blocking slugs, mirroring `blockedBy` in the frontmatter.)

## Prompt

> Self-contained instructions to paste into a fresh agent context. An AFK agent
> should be able to start from THIS FILE ALONE — no conversation history needed.
> State the goal, the relevant domain vocabulary, where to look in the codebase
> (by module/concept, not brittle paths), the seams to test at, and what "done"
> means. Reference any `work/findings/*.md` or ADRs that constrain the work.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim <slug> --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/<slug>.md work/done/<slug>.md
```
