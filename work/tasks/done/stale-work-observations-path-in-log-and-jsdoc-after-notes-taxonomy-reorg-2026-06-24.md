---
title: Fix stale work/observations/ path in runtime log + sweep JSDoc after notes taxonomy reorg
slug: stale-work-observations-path-in-log-and-jsdoc-after-notes-taxonomy-reorg-2026-06-24
needsAnswers: false
blockedBy: []
---

## What to build

The canonical observations bucket is `work/notes/observations/` (resolved by
`work-layout.ts:88` `observations: 'notes/observations'`). Two classes of stale
reference to the OLD short path `work/observations/` survive the `notes/`
taxonomy reorg (the `folder-taxonomy-reorg-and-rename` SPEC):

1. **A misleading RUNTIME LOG message (highest leverage, fix first).**
   `integration-core.ts:~2042` writes the auto review-nits observation CORRECTLY
   into `work/notes/observations/` (via `workFolderPath`), but then LOGS
   `Recorded N non-blocking review nit(s) for '<slug>' in work/observations/<file>.`
   — the printed path is the old short one. An agent/human reading that line is
   told the note lives at the wrong folder. (A prior agent on the
   agentic-resolution SPEC actually wrote its note into a stray top-level
   `work/observations/` because of this; it had to be relocated.) Fix: derive the
   printed path from `workFolderName('observations')` rather than hardcoding
   `work/observations/${filename}`.

2. **~30 stale JSDoc/comment example paths** across `src/` (e.g. `ledger-read.ts`,
   `lifecycle-pools.ts`, `lifecycle-gather.ts`, `triage-persist.ts`, `registry.ts`,
   `failure-cause.ts`, `needs-attention.ts`, `run.ts`, `integration-core.ts`,
   `mirror-pool-scan.ts`, `session-path.ts`, `tasking*.ts`) cite
   `work/observations/...` in examples. Comments only, but they are what an agent
   greps when deciding where a note goes. Mechanical sweep to
   `work/notes/observations/`.

## Acceptance criteria

- [ ] The `integration-core.ts` review-nits log line prints the SAME path it
      actually wrote (`notes/observations/...`), derived from the layout helper,
      not a hardcoded `work/observations/`.
- [ ] The ~30 stale `work/observations/` JSDoc/comment example paths are swept to
      `work/notes/observations/` (comments only; no behaviour change).
- [ ] A grep for the bare `work/observations/` short path finds no stale
      references left (only the correct `work/notes/observations/`).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: fix the misleading runtime log path and sweep the stale
> `work/observations/` JSDoc residue left by the notes-taxonomy reorg.
>
> Where to look: FIX #1 first (highest leverage) — `integration-core.ts` ~L2042,
> the `Recorded ... non-blocking review nit(s) ... in work/observations/<file>`
> log: make it print what it WROTE by deriving from
> `workFolderName('observations')`/`workFolderPath` instead of the hardcoded
> short path. Then sweep #2 — grep the bare `work/observations/` short path
> across `src/` (`ledger-read.ts`, `lifecycle-pools.ts`, `lifecycle-gather.ts`,
> `triage-persist.ts`, `registry.ts`, `failure-cause.ts`, `needs-attention.ts`,
> `run.ts`, `integration-core.ts`, `mirror-pool-scan.ts`, `session-path.ts`,
> `tasking*.ts`) and rename example paths to `work/notes/observations/`. Layout
> truth: `work-layout.ts:88`.
>
> Comments + one log string only; no behaviour change. Confirm via a final grep
> that no bare `work/observations/` short path remains. Keep the gate green.
