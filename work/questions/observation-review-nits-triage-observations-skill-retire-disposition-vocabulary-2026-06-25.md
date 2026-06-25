<!-- dorfl-sidecar: item=observation:review-nits-triage-observations-skill-retire-disposition-vocabulary-2026-06-25 type=observation slug=review-nits-triage-observations-skill-retire-disposition-vocabulary-2026-06-25 allAnswered=false -->

## Q1

**Is recording the kept-vs-reframed taxonomy decision IN-BAND inside skills/triage-observations/SKILL.md (the 'This is THIS skill's own human-workflow recommendation set… NOT the engine's old disposition= token vocabulary' paragraph) sufficient to satisfy acceptance criterion #2, or do you want it ALSO captured in a separate done note / amended PR body for the audit trail?**

> Source: work/notes/observations/review-nits-triage-observations-skill-retire-disposition-vocabulary-2026-06-25.md — a single non-blocking nit raised by Gate 2 (which APPROVED the task). Acceptance criterion #2 of 'triage-observations-skill-retire-disposition-vocabulary' asked for the kept-vs-reframed taxonomy decision (keep leave/delete/make-task/amend/fold-into-ADR, rename the framing from 'disposition' to 'recommendation/outcome') to be RECORDED with rationale. Current state: `git log -1 d897560` body is the title line only — no `## Decisions` block, no separate done-record file. However skills/triage-observations/SKILL.md:26 carries the decision + rationale durably inside the artifact itself, which is arguably a better home than a transient PR body the next reader is unlikely to find. The reviewer flagged this as satisfied-in-spirit and asks only that the human confirm the recording location is sufficient. Since this is the SOLE nit on the observation, the answer also determines whether the observation should then be deleted (signal discharged) or promoted to a small follow-up task to add the audit-trail record.

_Suggested default: leave — the in-band recording in SKILL.md is the durable home; treat AC#2 as satisfied-in-spirit and delete this observation (no follow-up task)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
