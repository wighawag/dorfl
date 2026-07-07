<!-- dorfl-sidecar: item=observation:mechanical-blockedby-passes-while-true-implementation-premise-unmet-build-agent-is-backstop-2026-06-26 type=observation slug=mechanical-blockedby-passes-while-true-implementation-premise-unmet-build-agent-is-backstop-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this signal — should the gap between mechanical blockedBy and true implementation premise be addressed by promoting one of the listed 'Possible directions' into a task/ADR, or should the observation be closed as accepted-and-filed (the build-agent backstop is the intended design)?**

> Observation records a real CI incident (run 28256817530): task apply-rung-merge-disposition passed mechanical blockedBy at commit 14d0d239 but TASK-STOPped because its true premise required a not-yet-existing sibling task; human re-scoped it (0122fdd) adding 2 new blockers. The observation itself concludes this is 'the dependency-graph backstop working as designed' plus one misleading log (already fixed + tested in claim-cas.ts). It offers two forward-looking directions: (a) surface premise-deps at promote/review time so blockedBy is complete before the pool; (b) route premise-unmet TASK-STOPs to a cheaper re-scope queue rather than a full stuck bounce. No blocking claim is made against current code; the log-message spawn is already discharged.

_Suggested default: Close as accepted-and-filed: the backstop worked, the concrete bug it spawned (misleading claim-success wording) is already fixed with a test, and the two forward-looking directions are speculative enough to wait for a second recurrence before spending task budget on them._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep as record and clear needsAnswers (no task). The dependency-graph backstop worked as designed, and the concrete bug it spawned (misleading claim-success wording) is already fixed with a test. The two forward-looking directions (surface premise-deps at promote/review time; a cheaper re-scope queue for premise-unmet TASK-STOPs) are speculative, wait for a second recurrence before spending task budget. This is a KEEP disposition: retain the note as a standing record, do not delete (it documents the intended-backstop design).
