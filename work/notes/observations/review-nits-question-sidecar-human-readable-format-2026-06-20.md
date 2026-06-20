---
title: review-gate non-blocking nits for 'question-sidecar-human-readable-format' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: question-sidecar-human-readable-format
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'question-sidecar-human-readable-format' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the `answered=` override is emitted only when it DISAGREES with the answer-derived predicate, and a redundant override is DROPPED on parse (re-interpreted in `parseEntrySection`).
  (The slice/ADR specified that a non-empty answer ⇒ answered with an explicit override honoured, but did not specify when to emit the field. The agent chose to omit it on agreement (and to drop a redundant value on parse) so a stale comment cannot become a sticky override that freezes a future tolerant edit. This is a sensible robustness choice and is documented in the module doc, but it is a new behavioural rule worth recording explicitly. No "## Decisions" block was left on the task; this is the main one a human reviewer would want logged.)
- Ratify: the identity HTML comment's `type=`/`slug=` fields are IGNORED on parse — the parser re-derives type+slug from `item=` via `resolveSidecarIdentity` and never validates the redundant fields.
  (`parseIdentityComment` returns only `item` (+ the advisory `allAnswered`). A hand-editor who changes `type=` or `slug=` to disagree with `item=` gets silent re-derivation, not an error. The slice did not specify whether to validate. Re-deriving from the single source of truth is the right call, but consider either omitting the redundant fields on serialise or adding a validation refusal — flagging so a human can ratify the silent-tolerance choice.)
- Coherence nit: the heading uses uppercase `## Q1` while the machine id and per-entry comment label are lowercase `q1` (and the parser only matches `^<!--\s*q\d+\s+fields:`).
  (The slice prompt itself wrote `## Q1`, so the case-mix is sanctioned, but a human editing the heading to `## q1` is not detected (the heading is purely a separator; the id comes from the per-entry comment). Worth a one-line note in the SKILL.md hand-writer section that the heading case is cosmetic and the per-entry comment id is what counts.)
- Edge case: a question text containing `**…**` markup will be truncated by the non-greedy bold-question regex `^\*\*(.+?)\*\*\s*$`.
  (`parseEntrySection` matches the first `**…**` and stops; a question like `**Why does `**bold**` mean X?**` would parse as `Why does ` plus stray text. Surfacers presumably do not nest bold, so this is a latent corner — flagging only so the next surface-questions change keeps it in mind.)
- Edge case: multi-paragraph context only keeps the FIRST contiguous blockquote run; a context with a non-quoted blank-content paragraph between two `>` runs loses the second run on parse.
  (`parseEntrySection` flips `inBlockquote=false` once a non-quoted non-blank line breaks the run, then ignores later `> …` lines (so the human's incidental `>` in their preamble cannot be re-absorbed as context). The serialiser emits blank lines inside the blockquote as `>` so its own output round-trips, but a hand-author who blank-line-separates two paragraphs without the `>` prefix will silently lose the second. Acceptable trade-off; worth a sentence in SKILL.md.)
