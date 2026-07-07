<!-- dorfl-sidecar: item=task:review-nits-question-sidecar-human-readable-format-2026-06-20 type=task slug=review-nits-question-sidecar-human-readable-format-2026-06-20 allAnswered=false -->

## Q1

**This task is a thin stub: it says only "draft this into a buildable slice" and carries needsAnswers:true, but defines no scope, no acceptance criteria, and no '## Decisions' block. The five findings it inherits are a mix of two flavours: 'Ratify ...' asks (accept an already-shipped, working behaviour as authorised) and doc nits ('worth a sentence in SKILL.md'). What is the actual scope of this task: (a) ratify the design choices and record them as decisions/ADR with NO code change, (b) add the documentation sentences the nits call for to skills/surface-questions/SKILL.md, (c) harden the parser for the flagged edge cases (nested-bold question, split-blockquote context), or some explicit subset of these?**

> work/tasks/ready/review-nits-question-sidecar-human-readable-format-2026-06-20.md — body is only the promotion stub. The 5 findings come from work/notes/observations/review-nits-question-sidecar-human-readable-format-2026-06-20.md, all marked NON-BLOCKING (Gate-2 APPROVED). The code they describe is already shipped and passing in packages/dorfl/src/sidecar.ts (answeredOverride drop-on-agreement, resolveSidecarIdentity re-derivation, ## Q1 case-mix, the bold-question regex, blockquote-run parsing).

_Suggested default: Scope to (a)+(b): record the two genuine design rules (answered= emitted only on disagreement; type=/slug= ignored and re-derived from item=) as decisions, and add the one-line hand-writer notes the nits request to SKILL.md. Treat the two edge-case nits (nested bold, split blockquote) as documented latent corners only, NOT code changes, since both are self-described as acceptable trade-offs._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Scope to (a)+(b): record the two genuine design rules (answered= emitted only on disagreement; type=/slug= ignored and re-derived from item=) as decisions, and add the one-line hand-writer notes the nits request to SKILL.md. Treat the two edge-case nits (nested bold, split blockquote) as documented latent corners only, NOT code changes, since both are self-described as acceptable trade-offs. This is a small doc-only task.

## Q2

**Nit 1 (the main one a reviewer would want logged): the parser emits the `answered=` override ONLY when it DISAGREES with the answer-derived predicate, and DROPS a redundant override on parse. The slice/ADR specified the answered predicate but not WHEN to emit the field. Should this rule be ratified as-is and recorded (decision/ADR), or is a different emit policy wanted?**

> Described in the observation; confirmed in packages/dorfl/src/sidecar.ts: isEntryAnswered honours answeredOverride; serialise drops redundant override so a stale comment cannot freeze a future tolerant edit. Documented in the module doc but never logged as a decision on the task (no '## Decisions' block exists).

_Suggested default: Ratify as-is and record it: omitting the field on agreement is the right robustness choice (a stale override should not become sticky); capture it as a decision/ADR rather than change behaviour._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Ratify as-is and record it. Emitting `answered=` only on disagreement (and dropping a redundant override on parse) is the right robustness choice, a stale override must not become sticky and freeze a future tolerant edit. Capture as a decision, no behaviour change.

## Q3

**Nit 2: the identity HTML comment's `type=`/`slug=` fields are IGNORED on parse — the parser re-derives type+slug from `item=` via resolveSidecarIdentity and never validates the redundant fields, so a hand-editor who makes them disagree with `item=` gets silent re-derivation, not an error. Ratify the silent tolerance, OR change it (either OMIT the redundant fields on serialise, or ADD a validation refusal on disagreement)?**

> Observation finding; parseIdentityComment returns only item (+ advisory allAnswered). The slice did not specify whether to validate. Re-deriving from the single source of truth (item=) is sound; the open call is whether to keep emitting the unused fields silently.

_Suggested default: Ratify silent re-derivation, but if a small change is in scope, prefer OMITTING the redundant type=/slug= on serialise over adding a validation refusal — fewer fields cannot disagree._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Ratify silent re-derivation from item= (the single source of truth). If a small change is in scope, prefer OMITTING the redundant type=/slug= on serialise over adding a validation refusal, fewer fields cannot disagree. But omission is optional polish, not required.

## Q4

**Nit 3 (coherence): the sidecar heading is uppercase `## Q1` while the machine id and per-entry comment label are lowercase `q1` (parser only matches `^<!--\s*q\d+\s+fields:`). The heading is purely a separator; a human editing it to `## q1` is not detected. Is a one-line SKILL.md note ('heading case is cosmetic; the per-entry comment id is what counts') the desired fix, or should the parser/heading be made case-consistent?**

> Observation finding; the slice prompt itself wrote `## Q1`, so the case-mix is sanctioned. Confirmed the hand-writer section of SURFACE-PROTOCOL.md / SKILL.md uses `## Qn`.

_Suggested default: Add the one-line SKILL.md note; do not change the parser or heading case (the mix is sanctioned by the slice prompt)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Add the one-line SKILL.md note ("heading case is cosmetic; the per-entry comment id is what counts"). Do not change the parser or heading case, the `## Q1` / `q1` mix is sanctioned by the slice prompt itself.

## Q5

**Nit 4 (edge case): a question whose text contains nested `**…**` markup is truncated by the non-greedy bold-question regex `^\*\*(.+?)\*\*\s*$`. Leave this as a documented latent corner (surfacers do not nest bold), or harden the regex / escape policy?**

> Observation finding; parseEntrySection in packages/dorfl/src/sidecar.ts matches the first `**…**` and stops. Self-described as a latent corner flagged 'only so the next surface-questions change keeps it in mind.'

_Suggested default: Leave as a documented latent corner — no code change; surfacers do not nest bold and the cost of hardening exceeds the risk._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):

Leave as a documented latent corner, no code change. Surfacers do not nest bold in a question, and the cost of hardening the regex exceeds the risk. A one-line SKILL.md note is enough.

## Q6

**Nit 5 (edge case): multi-paragraph context keeps only the FIRST contiguous blockquote run; a hand-author who separates two `>` paragraphs with a non-quoted blank-content line silently loses the second run (the serialiser itself emits `>` on blank lines so its own output round-trips). Leave as a documented trade-off with a sentence in SKILL.md, or change the parser to re-absorb later `>` runs?**

> Observation finding; parseEntrySection flips inBlockquote=false on a non-quoted non-blank line so an incidental `>` in a human preamble cannot be re-absorbed. Self-described as 'Acceptable trade-off; worth a sentence in SKILL.md.'

_Suggested default: Add the SKILL.md sentence (blank-separated context paragraphs must keep the `>` prefix); do not change the parser — the current behaviour deliberately avoids re-absorbing an incidental `>`._

<!-- q6 fields: id=q6 -->

**Your answer** (write below this line):

Add the SKILL.md sentence (blank-separated context paragraphs must keep the `>` prefix on the blank line). Do not change the parser, the current behaviour deliberately avoids re-absorbing an incidental `>` in a human preamble, which is the safer default.
