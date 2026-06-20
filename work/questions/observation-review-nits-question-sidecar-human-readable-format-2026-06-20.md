<!-- agent-runner-sidecar: item=observation:review-nits-question-sidecar-human-readable-format-2026-06-20 type=observation slug=review-nits-question-sidecar-human-readable-format-2026-06-20 allAnswered=false -->

## Q1

**How should we triage the nit: ratify (and document) that `answered=` override is only emitted when it DISAGREES with the answer-derived predicate, and a redundant override is DROPPED on parse?**

> Reviewer flagged: the slice/ADR specified non-empty answer ⇒ answered with explicit override honoured, but did not specify WHEN to emit the field. Agent chose to omit on agreement and drop redundant overrides on parse, so a stale comment cannot become a sticky override that freezes a future tolerant edit. Documented in module doc but not in a `## Decisions` block — the main rule a human reviewer would want logged.

_Suggested default: promote-adr (record the emit-only-on-disagreement rule as a small ADR / decisions note so the design choice is durable, not just buried in module doc)_

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):

## Q2

**How should we triage the nit: identity HTML comment's redundant `type=`/`slug=` fields are IGNORED on parse — parser re-derives from `item=` via `resolveSidecarIdentity` and never validates them?**

> `parseIdentityComment` returns only `item` (+ advisory `allAnswered`). A hand-editor who changes `type=` / `slug=` to disagree with `item=` gets silent re-derivation, not an error. Slice did not specify validation. Options surfaced: (a) keep silent re-derivation, (b) omit redundant fields on serialise, (c) refuse on mismatch.

_Suggested default: promote-slice (small follow-up slice: either drop the redundant fields on serialise OR add a mismatch refusal — pick one so the format has a single source of truth without silent tolerance)_

<!-- q2 fields: id=q2 disposition=promote-slice -->

**Your answer** (write below this line):

## Q3

**How should we triage the nit: heading uses uppercase `## Q1` while machine id and per-entry comment label are lowercase `q1` (parser only matches `^<!--\s*q\d+\s+fields:`)?**

> Slice prompt itself wrote `## Q1`, so case-mix is sanctioned. A human editing the heading to `## q1` is not detected (heading is purely a separator; id comes from per-entry comment). Reviewer suggests a one-line note in SKILL.md hand-writer section that heading case is cosmetic and the per-entry comment id is what counts.

_Suggested default: promote-slice (tiny docs slice: add the one-line note to SKILL.md hand-writer section)_

<!-- q3 fields: id=q3 disposition=promote-slice -->

**Your answer** (write below this line):

## Q4

**How should we triage the nit: a question text containing `**…**` markup will be truncated by the non-greedy bold-question regex `^\*\*(.+?)\*\*\s*$`?**

> `parseEntrySection` matches the first `**…**` and stops; e.g. `**Why does `**bold**` mean X?**` would parse as `Why does ` plus stray text. Surfacers presumably do not nest bold, so this is a latent corner — reviewer flagging only so the next surface-questions change keeps it in mind.

_Suggested default: keep (latent corner case unlikely to fire in practice; leave the observation as the durable record without spawning work)_

<!-- q4 fields: id=q4 disposition=keep -->

**Your answer** (write below this line):

## Q5

**How should we triage the nit: multi-paragraph context only keeps the FIRST contiguous blockquote run — a non-quoted blank-content paragraph between two `>` runs loses the second run on parse?**

> `parseEntrySection` flips `inBlockquote=false` once a non-quoted non-blank line breaks the run, then ignores later `> …` lines (so incidental `>` in human preamble cannot be re-absorbed as context). Serialiser emits blank lines inside the blockquote as `>` so its own output round-trips, but a hand-author who blank-line-separates two paragraphs without the `>` prefix silently loses the second. Reviewer calls it an acceptable trade-off; worth a sentence in SKILL.md.

_Suggested default: promote-slice (tiny docs slice: add a sentence to SKILL.md hand-writer section warning that every paragraph in context must keep the `>` prefix)_

<!-- q5 fields: id=q5 disposition=promote-slice -->

**Your answer** (write below this line):
