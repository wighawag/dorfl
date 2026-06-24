---
title: A question sidecar has no human-VISIBLE link to the item it asks about — a Markdown link would help (GitHub + VSCode)
type: observation
status: spotted
spotted: 2026-06-20
needsAnswers: true
---

## What was seen

A question/answer sidecar (`work/questions/<type>-<slug>.md`, `src/sidecar.ts`)
identifies the item it asks about ONLY via machine state inside an HTML comment:

```
<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->
```

GitHub and VSCode render HTML comments as NOTHING (that invisibility is deliberate
— ADR `question-sidecar-human-readable-format` made the machine state invisible so a
human edit can't break it). The visible body is then just `## Qn` headings + bold
question lines + the answer markers. So a human reading a sidecar (very often
through the GitHub web UI — the ADR's stated primary surface) sees the QUESTION but
has NO clickable way to jump to the TASK/BRIEF/OBSERVATION it concerns. They must
manually reconstruct the path and go find it.

Confirmed: there is NO visible back-pointer. The module doc is explicit — "There is
NO back-pointer field in the item body" — and the sidecar→item linkage is the
HTML-comment `item=`/`slug=`/`type=` only (`src/sidecar.ts`, `serialise` ~L540;
`sidecarPathFor` ~L232 derives the path as `work/questions/<type>-<slug>.md`).

## Why it matters

The sidecar is THE human-facing surface of the answer loop (humans read the
question and write the answer here, per the ADR). To answer well a human usually
needs the item's context (the task body, the brief, the observation). With no link,
every answer round pays a manual "now where is that item?" tax. Now that the format
is real Markdown rendered on GitHub/VSCode, a relative Markdown link would be
clickable RIGHT THERE in both surfaces — a cheap, high-leverage readability win
fully in the spirit of the format-readability ADR.

## The idea (NOT decided here)

Add a human-visible Markdown link to the item near the top of the sidecar (e.g.
under the identity comment), pointing at the item file, so it resolves on GitHub and
in VSCode. Two things to get right:

1. **The item MOVES between lifecycle folders** (`tasks/backlog/ ↔ tasks/todo/ ↔
   tasks/done/ ↔ tasks/cancelled/`; briefs similarly), and the sidecar is
   IDENTITY-keyed precisely so it survives those `git mv`s with no lock-step move.
   A STATIC relative link (`../tasks/todo/foo.md`) would therefore go STALE the
   moment the item is promoted/completed — this is the very reason there is no
   back-pointer today. Options to weigh:
   - render the link to the item's CURRENT folder at serialise time, accepting it
     can stale until the next serialise (the sidecar IS re-serialised on each
     append/answer, so it would self-heal on the next write — but a resting sidecar
     could point at the old folder);
   - link to a STABLE locator that does not depend on folder (e.g. a search/anchor,
     or a slug-based convention), if one exists;
   - or link "best-effort to the most likely folder" with a note that the item may
     have moved. Whichever is chosen, the link must DEGRADE to harmless text, never
     break the parser (keep it OUTSIDE the per-entry parse regions, like the
     identity comment).
2. **Keep round-trip SEMANTIC.** The format's round-trip is model-equal, not
   byte-equal, and tolerant of human edits. A visible link line must be
   regenerated on serialise (not parsed as content) so a human editing answers
   never has to maintain it and can't corrupt the model by touching it.

## Provenance / refs

- `src/sidecar.ts` module doc ("On-disk text format", "Identity-keyed, NOT
  folder-keyed", "There is NO back-pointer field"); `serialise` (~L528+),
  `sidecarPathFor` (~L228+).
- ADR `docs/adr/question-sidecar-human-readable-format.md` (the format is real
  Markdown for GitHub readability — a link extends that goal).
- Related existing observations on the same surface:
  `question-sidecar-renders-poorly-on-github.md`,
  `review-nits-question-sidecar-human-readable-format-2026-06-20.md`.

## Note on scope

Readability ENHANCEMENT, not a bug. The folder-move staleness wrinkle (point 1) is
the only non-trivial part and is the reason this is captured for a human to decide
rather than treated as obvious. A human decides whether to spec a task.
