---
title: 'review-gate non-blocking nits for ''question-sidecar-human-readable-format'' (Gate 2 approve)'
date: 2026-06-20
status: open
reviewOf: question-sidecar-human-readable-format
needsAnswers: false
triaged: keep
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

## Triaged: promoted

Promoted to a new backlog slice `work/tasks/todo/review-nits-question-sidecar-human-readable-format-2026-06-20.md` (a human answered
"promote"). This observation is resolved; the new item carries the work.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `task:review-nits-question-sidecar-human-readable-format-2026-06-20` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: Observation's own body already records it was triaged and promoted to work/tasks/todo/review-nits-question-sidecar-human-readable-format-2026-06-20.md; this is an unambiguous map to that existing slice.

## Resolution (recovered from an orphaned question sidecar, 2026-07-12)

CORRECTION: the promoted carrier task was DELETED in commit `d4fd53db` ("repair 12 promptless promoted tasks", GROUP A); no such file exists under `work/tasks/*`. Its question sidecar (6 questions) was answered by a human and lived nowhere else; recovered verbatim below before the orphaned sidecar is removed. This is a small doc-only body of work; carry it into any re-minted task.

- **Q1 (scope):** Scope to (a)+(b): record the two genuine design rules (`answered=` emitted only on disagreement; `type=`/`slug=` ignored and re-derived from `item=`) as decisions, and add the one-line hand-writer notes the nits request to `SKILL.md`. Treat the two edge-case nits (nested bold, split blockquote) as documented latent corners only, NOT code changes, since both are self-described as acceptable trade-offs.
- **Q2 (`answered=` on disagreement):** Ratify as-is and record it. Emitting `answered=` only on disagreement (and dropping a redundant override on parse) is the right robustness choice; a stale override must not become sticky and freeze a future tolerant edit. Capture as a decision, no behaviour change.
- **Q3 (`type=`/`slug=` re-derivation):** Ratify silent re-derivation from `item=` (the single source of truth). If a small change is in scope, prefer OMITTING the redundant `type=`/`slug=` on serialise over adding a validation refusal (fewer fields cannot disagree). Omission is optional polish, not required.
- **Q4 (heading case):** Add the one-line `SKILL.md` note ("heading case is cosmetic; the per-entry comment id is what counts"). Do not change the parser or heading case; the `## Q1` / `q1` mix is sanctioned by the slice prompt itself.
- **Q5 (nested bold):** Leave as a documented latent corner, no code change. Surfacers do not nest bold in a question, and the cost of hardening the regex exceeds the risk. A one-line `SKILL.md` note is enough.
- **Q6 (split blockquote):** Add the `SKILL.md` sentence (blank-separated context paragraphs must keep the `>` prefix on the blank line). Do not change the parser; the current behaviour deliberately avoids re-absorbing an incidental `>` in a human preamble, which is the safer default.
