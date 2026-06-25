---
title: review-gate non-blocking nits for 'triage-observations-skill-retire-disposition-vocabulary' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: triage-observations-skill-retire-disposition-vocabulary
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'triage-observations-skill-retire-disposition-vocabulary' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Acceptance criterion #2 asks for the kept-vs-reframed taxonomy decision to be RECORDED in a done note / PR description with its rationale, but the commit is a bare one-liner with no `## Decisions` block and there is no separate done-record file. Is recording it IN-BAND (the new 'This is THIS skill's own human-workflow recommendation set... It is NOT the engine's old `disposition=` token vocabulary' paragraph) acceptable, or does the human want it also captured in a done note for the audit trail?
  (git log -1 d897560 body = the title line only; skills/triage-observations/SKILL.md:26 carries the decision + rationale durably inside the artifact. The one in-scope design decision the task flagged (keep the leave/delete/make-task/amend/fold-into-ADR taxonomy, rename the framing from 'disposition' to 'recommendation/outcome') is recorded where the next reader needs it, arguably better than a transient PR body. Treating this as satisfied-in-spirit; flagged only so the human can confirm the recording location is sufficient.)
