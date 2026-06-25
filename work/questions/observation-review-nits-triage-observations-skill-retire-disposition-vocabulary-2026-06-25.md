<!-- dorfl-sidecar: item=observation:review-nits-triage-observations-skill-retire-disposition-vocabulary-2026-06-25 type=observation slug=review-nits-triage-observations-skill-retire-disposition-vocabulary-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this review-nits observation? The single non-blocking nit it records (acceptance criterion #2's decision-recording location) appears satisfied-in-spirit on investigation, so the live options are: delete it as discharged, leave it as a live signal, or take some other path (e.g. amend, or first record the decision in a done note for the audit trail).**

> Native observation-triage question. The observation is the durable home for the one nit Gate 2 raised when APPROVING the task 'triage-observations-skill-retire-disposition-vocabulary'. Investigation against current reality: the landing commit (#242, 14d3b66) has an EMPTY body (confirmed via git log) and there is NO separate done-record file in work/, so criterion #2's literal 'recorded in a done note / PR description' was not met that way. BUT the kept-vs-reframed taxonomy decision + rationale IS recorded durably in the artifact itself at skills/triage-observations/SKILL.md:26 ('This is THIS skill's own human-workflow recommendation set... It is NOT the engine's old `disposition=` token vocabulary'), which is arguably a better, more permanent home than a transient PR body. The signal is thus a satisfied-in-spirit nit with no buildable residue. If the call is to discard, that is the DIRECT delete (git rm / dorfl drop obs:<slug>), which also removes any question sidecar — not a token.

_Suggested default: Delete this observation as discharged: the one nit is satisfied-in-spirit (the decision + rationale live durably in skills/triage-observations/SKILL.md:26, which serves the audit trail better than a transient PR body), it carries no buildable residue, and the task it reviews already landed approved._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Is recording the kept-vs-reframed taxonomy decision IN-BAND in the skill artifact (skills/triage-observations/SKILL.md:26, the 'recommendation set ... NOT the engine's old `disposition=` token vocabulary' paragraph) sufficient for acceptance criterion #2, or do you want it ALSO captured in a done note / PR description for the audit trail before this nit is closed?**

> Carried over verbatim from the observation body (the one non-blocking Gate-2 finding; reviewOf: triage-observations-skill-retire-disposition-vocabulary). NON-BLOCKING nit, so an optional/low-priority question, not a blocker on advancing. Criterion #2 literally says the decision should be RECORDED in a done note / PR description with its rationale. Verified: git log -1 14d3b66 body = title line only (empty body), no separate done-record file exists; skills/triage-observations/SKILL.md:26 carries the decision + rationale durably inside the artifact. The reviewer treated this as satisfied-in-spirit and flagged it only so the human can confirm the recording location is acceptable.

_Suggested default: Accept the in-band recording in skills/triage-observations/SKILL.md:26 as sufficient (durable in the artifact, where the next reader needs it, beats a transient PR body); no backfilled done note required._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
