---
title: The question/answer sidecar is reformatted for human readability on GitHub (Markdown content + machine fields in HTML comments), at the cost of byte-exact round-trip
status: accepted
created: 2026-06-20
decided: 2026-06-20
supersedes:
superseded_by:
---

# ADR: the question sidecar is a human-readable Markdown surface, not a tooling-owned YAML-ish file

> This REVISITS a resolved format. The original sidecar format is RESOLVED in the `advance-loop`
> brief (`work/briefs/tasked/advance-loop.md`, "The sidecar FORMAT (RESOLVED here)") and the design
> note `work/notes/ideas/advance-loop-question-answer-protocol.md`, and was built faithfully to that
> spec. This ADR records the maintainer's decision to change it and the
> why, so the change is not read as drift and the trade-off is not re-litigated.

## Context

The question/answer sidecar (`work/questions/<type>-<slug>.md`, `serialiseSidecar`/`parseSidecar`
in `packages/agent-runner/src/sidecar.ts`) is the HUMAN-FACING surface of the "human is the clock"
answer loop: the `advance` family writes a question per item, and the human reads the question and
writes the answer IN THIS FILE, very often through the GitHub web UI (the `on: push
work/questions/**` trigger consumes those commits).

The original format was chosen to be tooling-OWNED and round-trip-stable: per-entry `## Qn`
headings with bare `key: |` YAML block scalars (`question:`, `context:`, `default:`, `answer:`)
plus machine fields (`id:`, `answered:`, `disposition:`) inline. On GitHub this renders BADLY: the
block-scalar `|` pipes show literally and the indentation/newlines collapse, so the file reads as
run-together noise instead of a skimmable Q&A. The very humans the loop depends on get the worst
experience exactly where it matters most. Readability-on-GitHub was never a stated design goal of
the original format; it was sacrificed for tooling-ownership and a byte-exact round-trip.

## Decision

Reformat the sidecar so the SAME file is both human-readable on GitHub AND machine-parseable:

- **Content is real Markdown.** The question is a bold line, context is a blockquote, the suggested
  default is italic. A human skims it as a question, not a config file.
- **Machine fields live in HTML comments** (`<!-- agent-runner-sidecar: ... -->` for identity,
  `<!-- qN fields: id=.. answered=.. disposition=.. -->` per entry). GitHub renders HTML comments
  as NOTHING, so the machine state is invisible to the human and unbreakable by their edit.
- **The answer has a fixed, obvious labelled region** ("**Your answer** (write below this line):")
  that the human types prose under, with NO format knowledge required (no `key:`, no escaping, no
  fence).
- **The answer boundary is HEADING-DELIMITED**: the answer is the text from the answer marker up to
  the next entry heading (not a `---` rule), so a human cannot accidentally break parsing by typing
  `---` inside their answer.

### The three maintainer-ratified trade-offs

1. **Round-trip is SEMANTIC, not byte-exact (DECIDED).** The original invariant was
   `parseSidecar(serialiseSidecar(m))` byte-identical. Because a human edits this file by hand on
   GitHub, byte-exactness fights the use case (a reflowed line or an extra blank breaks it). The new
   invariant is SEMANTIC: parse -> serialise recovers the same MODEL (entries, ids, answers,
   answered-state, dispositions), and re-serialising CANONICALISES the text. The load-bearing rules
   are kept: a non-empty answer => answered (with an explicit override), stable monotonic ids, the
   tolerant "human writes only the answer" edit.

2. **Answer boundary is heading-delimited, not `---`-delimited (DECIDED).** Robust against a human
   typing a horizontal rule inside an answer.

3. **Clean CUTOVER + migrate the existing files (DECIDED).** No dual-format parser is maintained.
   The new parser reads the new format only; the existing `work/questions/*.md` files (this repo's 3
   live ones, plus any in adopted repos) are MIGRATED to the new format as part of the change. (This
   repo's stale orphaned sidecars were already removed during triage; only live ones migrate.)

## Consequences

- The PRD-resolved "tooling-owned, byte-exact round-trip" property is deliberately RELAXED to
  semantic round-trip. This is the cost we accept to make the human surface readable; it is the
  whole point of the change.
- `serialiseSidecar`/`parseSidecar` and `sidecar.test.ts` are rewritten; the surface-questions skill
  (`skills/surface-questions/SKILL.md`) documents the new hand-written shape; the `advance-loop`
  brief's (`work/briefs/tasked/advance-loop.md`) "sidecar FORMAT (RESOLVED here)" section is updated
  to point here.
- The clean cutover means an un-migrated old-format sidecar would not parse; the migration must cover
  every live sidecar in one change (verified: 3 live in this repo at decision time).
- A future reader seeing Markdown + HTML comments instead of the brief's documented YAML-ish format
  must find THIS ADR to understand the deliberate change; hence it is recorded.

## Status

Accepted (maintainer, 2026-06-20). Implementation is owned by the task
`work/tasks/backlog/question-sidecar-human-readable-format.md`.
