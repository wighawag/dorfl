<!-- dorfl-sidecar: item=task:review-nits-question-sidecar-human-readable-format-2026-06-20 type=task slug=review-nits-question-sidecar-human-readable-format-2026-06-20 allAnswered=false -->

## Q1

**Nit 1 — the `answered=` override is only emitted when it disagrees with the answer-derived predicate, and a redundant override is dropped on parse. Should this slice RATIFY that rule by writing it explicitly into the ADR (`docs/adr/question-sidecar-human-readable-format.md`) and the module doc, or change the behaviour, or drop the nit?**

> From observation/review notes: 'The slice/ADR specified that a non-empty answer ⇒ answered with an explicit override honoured, but did not specify when to emit the field. The agent chose to omit it on agreement (and to drop a redundant value on parse) so a stale comment cannot become a sticky override that freezes a future tolerant edit.' No `## Decisions` block was left on the original task; reviewer flagged this as 'the main one a human reviewer would want logged.'

_Suggested default: Ratify: amend the ADR (and the parseEntrySection module doc) to state the rule verbatim — emit `answered=` only when it disagrees with the answer-derived predicate; drop a redundant override on parse._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit 2 — the identity HTML comment's `type=`/`slug=` fields are silently IGNORED on parse (the parser re-derives type+slug from `item=`). Pick one: (a) keep silent re-derivation and ratify in the ADR, (b) omit the redundant `type=`/`slug=` fields on serialise, or (c) make the parser refuse / warn when they disagree with `item=`.**

> `parseIdentityComment` returns only `item` (+ advisory `allAnswered`). A hand-editor who changes `type=` or `slug=` to disagree with `item=` gets silent re-derivation, not an error. Reviewer: 'Re-deriving from the single source of truth is the right call, but consider either omitting the redundant fields on serialise or adding a validation refusal.'

_Suggested default: (b) Omit `type=`/`slug=` on serialise — the single source of truth (`item=`) round-trips, and there is nothing for a hand-editor to silently desync. Falls back to (a) ratify-in-ADR if removing the fields breaks an external consumer._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit 3 — heading case (`## Q1` uppercase) vs machine id (`q1` lowercase) is asymmetric: the heading is purely a separator, the id lives in the per-entry HTML comment. Add a one-line note to `skills/surface-questions/SKILL.md` clarifying that, or leave it implicit, or normalise the heading case?**

> The slice prompt itself wrote `## Q1`, so the case-mix is sanctioned, but a human editing the heading to `## q1` is not detected. Parser only matches `^<!--\s*q\d+\s+fields:` (lowercase) for the per-entry comment.

_Suggested default: Add a one-line clarifying note to SKILL.md's hand-writer section: heading case is cosmetic; the per-entry comment id is authoritative._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Nit 4 — a question text containing nested `**…**` markup will be truncated by the non-greedy bold-question regex `^\*\*(.+?)\*\*\s*$` in `parseEntrySection`. Worth fixing now (greedy match / different delimiter), or document as a known latent corner, or drop?**

> Example: `**Why does `**bold**` mean X?**` parses as `Why does ` plus stray text. Reviewer judged: 'Surfacers presumably do not nest bold, so this is a latent corner — flagging only so the next surface-questions change keeps it in mind.'

_Suggested default: Document as a known latent corner (one sentence in SKILL.md and/or the parser's module doc); do not change the regex now — no real surface emits nested bold, and a greedy fix risks consuming a following section._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**Nit 5 — multi-paragraph context only keeps the FIRST contiguous blockquote run; a context with an un-prefixed paragraph between two `>` runs silently loses the second run. Add a SKILL.md sentence telling hand-authors to prefix every line with `>` (including blank-content lines as `>`), or change the parser to be permissive, or drop?**

> `parseEntrySection` flips `inBlockquote=false` once a non-quoted non-blank line breaks the run; the serialiser already emits blank lines inside the blockquote as `>` so machine output round-trips, but a hand-author who blank-separates two paragraphs without the `>` prefix loses the second. Reviewer judged 'acceptable trade-off; worth a sentence in SKILL.md.'

_Suggested default: Add a sentence to SKILL.md's hand-writer section: every line of the context blockquote — including blank lines between paragraphs — must be prefixed `>`. Do not change the parser (the current behaviour deliberately prevents an incidental `>` in the human's preamble from being re-absorbed as context)._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

## Q6

**Scope check: is this slice intended to be DOCS-ONLY (ADR + SKILL.md + module-doc edits to ratify the five nits) with no behavioural change, or may it also include the small parser/serialiser tweaks suggested above (omit `type=`/`slug=` on serialise, etc.)? This determines whether the slice's verify floor needs any new tests beyond docs.**

> All five findings are non-blocking nits and the original gate APPROVED the feature. The defaults above lean docs-only except nit 2 which proposes a small serialise change. The task body just says 'draft this into a buildable slice' — it does not pin docs-only vs code-touching.

_Suggested default: Docs-only PLUS the nit-2 serialise tweak (drop redundant `type=`/`slug=` from the identity comment, with a fixture-update test). Everything else lands as ADR/SKILL.md/module-doc edits._

<!-- q6 fields: id=q6 -->

**Your answer** (write below this line):
