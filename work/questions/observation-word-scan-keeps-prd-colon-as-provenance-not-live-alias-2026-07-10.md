<!-- dorfl-sidecar: item=observation:word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10 type=observation slug=word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10 allAnswered=false -->

Item: [`observation:word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10`](../notes/observations/word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10.md)

## Q1

**What becomes of this observation — keep as an ADR-worthy policy note (WORD scan treats prd: as provenance; SRC scan is the hard-cutover gate), spawn the suggested follow-up task to sweep prose 'prd:' from the handful of live maintained docs (docs/adr/methodology-and-skills.md, skills/orchestrate/SKILL.md, docs/adr/land-primitive-rebase-reverify-advance.md), or discard it as fully captured by the task itself?**

> work/notes/observations/word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10.md records a deliberate split from the hard-cutover task: SRC-prose scan drops the prd: colon exemption (real gate on live code, caught ~7 leaks fixed to spec); WORD scan KEEPS it, re-documented as PROVENANCE (terminal history in work/tasks/done/ + ADRs would be falsified if swept). Note explicitly flags a narrow, deliberately-scoped follow-up for live maintained docs (~3 files) as separate work.

_Suggested default: Spawn the small follow-up task to sweep prose 'prd:' from the three named live-doc files, then discard the observation (the WORD-vs-SRC policy is adequately recorded in the two test files' comments and the done-task record)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
