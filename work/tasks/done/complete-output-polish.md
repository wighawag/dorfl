---
title: complete output polish — make the propose-mode next-step stand out
slug: complete-output-polish
prd: agent-runner
blockedBy: [complete-integration-flag]
covers: [7]
---

## What to build

A small UX polish on `agent-runner complete`: when it finishes in `propose` mode, the "branch pushed — here's how to open the review" message is the ONE thing the human must act on, so it must visually stand out instead of blending into log output.

End-to-end:

- After a `propose`-mode completion, print the next-step block with a **blank line before and after** and a **visually distinct treatment** (e.g. a heading marker and color) so it's unmissable.
- **TTY-aware color**: emit ANSI color only when stdout is a TTY; no color codes when piped/redirected or in non-interactive runs (and honour `NO_COLOR`).
- Keep the message content accurate: branch pushed, its ref, and the exact next command(s) to open/merge the review.

Cosmetic only — no behavioural change to gate/done-move/commit/integrate.

## Acceptance criteria

- [ ] In `propose` mode, the next-step message is separated by blank lines and visually distinct (heading + color on a TTY).
- [ ] Color is emitted only on a TTY; piped/redirected output is plain (and `NO_COLOR` is honoured).
- [ ] The message states the pushed branch/ref and the exact next command(s).
- [ ] No change to the gate/done-move/commit/integration behaviour; existing `complete` tests still pass.
- [ ] Tests cover TTY-on (color present) vs not-a-TTY/`NO_COLOR` (plain) output.

## Blocked by

- `complete-integration-flag` — not a logical dependency but a FILE-overlap serialization (ADR §10): both slices edit `complete.ts`, so they are chained to avoid a merge conflict. This cosmetic polish lands after the flag/switch-behaviour change.

## Prompt

> Polish `agent-runner complete`'s propose-mode output in `packages/agent-runner/`. Read the existing `complete.ts`. When completion finishes in `propose` mode, the "branch pushed; open the review" message must stand out: surround it with blank lines and make it visually distinct (a heading marker + ANSI color). Color must be TTY-aware — only when stdout is a TTY, plain when piped/redirected, and honour `NO_COLOR`. Keep the content accurate (pushed branch/ref + exact next commands). Cosmetic only: do not change gate/done-move/commit/integration behaviour.
>
> TDD with vitest: color present on a (simulated) TTY; plain output when not a TTY or `NO_COLOR` set; existing complete tests still green. Follow `AGENTS.md` (format with `pnpm format`; gate is check-only). Match house style; `commander`. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
