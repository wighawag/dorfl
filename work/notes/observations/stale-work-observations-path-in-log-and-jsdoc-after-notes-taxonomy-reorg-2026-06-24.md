---
title: Stale `work/observations/` path in a runtime LOG message + ~30 JSDoc/comments after the notes/ taxonomy reorg (misleads agents into the wrong folder)
date: 2026-06-24
status: open
noticedDuring: dogfood of the observation-discharge PRD (a prior agent wrote a note into work/observations/ instead of work/notes/observations/)
needsAnswers: true
---

## What I noticed

The canonical observations bucket is `work/notes/observations/` — this is what
the runtime layout constant resolves (`work-layout.ts:88` `observations:
'notes/observations'`, via `workFolderPath`), and what the agent-facing guidance
correctly says (`capture-signal` SKILL.md L29: `work/notes/observations/<slug>.md`;
`work/protocol/WORK-CONTRACT.md` uses `work/notes/observations/`).

But TWO classes of stale reference to the OLD short path `work/observations/`
survive the `notes/` taxonomy reorg (cf. the `folder-taxonomy-reorg-and-rename`
PRD in `prds/tasked/`):

1. **A MISLEADING RUNTIME LOG MESSAGE.** `integration-core.ts:2042` writes the
   auto review-nits observation via `workFolderPath(cwd, 'observations')` — i.e.
   CORRECTLY into `work/notes/observations/` — but then logs:
   `Recorded N non-blocking review nit(s) for '<slug>' in work/observations/<filename>.`
   The WRITE is right; the printed PATH is the old short one. An agent (or human)
   reading that line is told the note lives at `work/observations/`, which is the
   wrong folder.

2. **~30 stale JSDoc/comment paths** across `src/` (e.g. `ledger-read.ts`,
   `lifecycle-pools.ts`, `lifecycle-gather.ts`, `triage-persist.ts` option docs,
   `registry.ts`, `failure-cause.ts`, `needs-attention.ts`, `run.ts`,
   `integration-core.ts`, `mirror-pool-scan.ts`, `session-path.ts`,
   `tasking*.ts`) all cite `work/observations/...` in example paths. These are
   comments/JSDoc, not runtime behaviour, but they are exactly what an agent
   greps when deciding where a note goes.

## Why it matters

A prior agent on this very PRD wrote its captured note into the stray top-level
`work/observations/` instead of `work/notes/observations/` (I relocated +
committed it as `ad50a56`). The agent-facing PROTOCOL + the `capture-signal`
skill are NOT the cause — they are correct. The most likely misleader is the
runtime log line (#1): it is the one place the WRONG path is printed at the
moment a note is recorded, so it reads as authoritative. The JSDoc cruft (#2)
reinforces the wrong path on a grep.

## Suggested fix shape

- FIX #1 first (highest leverage, smallest): make the log message print the same
  path it actually wrote — derive it from `workFolderPath`/`workFolderName`
  rather than hardcoding `work/observations/${filename}` (e.g.
  `${workFolderName('observations')}/${filename}` → `notes/observations/...`).
- Then sweep the stale `work/observations/` JSDoc/comment examples to
  `work/notes/observations/` (a mechanical rename, no behaviour change). This is
  the comment-residue tail of the `folder-taxonomy-reorg-and-rename` PRD; worth
  folding into that PRD's follow-up rather than a standalone task if it is still
  open.

## Pointer

Grep anchor: `work/observations/` (the short path) vs the correct
`work/notes/observations/`. Runtime log site: `integration-core.ts` ~L2042
(`Recorded ... non-blocking review nit(s) ... in work/observations/`). Layout
truth: `work-layout.ts:88`.
