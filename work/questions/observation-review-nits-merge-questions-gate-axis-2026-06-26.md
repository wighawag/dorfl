<!-- dorfl-sidecar: item=observation:review-nits-merge-questions-gate-axis-2026-06-26 type=observation slug=review-nits-merge-questions-gate-axis-2026-06-26 allAnswered=false -->

## Q1

**What should become of this observation capturing the two non-blocking review nits from Gate 2 on 'merge-questions-gate-axis' — promote to one or more tasks, fold into the sibling 'merge-question-surfacer' task as tracking notes, or delete as already-recorded ratification?**

> work/notes/observations/review-nits-merge-questions-gate-axis-2026-06-26.md records two non-blocking nits from the approved Gate 2 review of 'merge-questions-gate-axis':
>
> 1. Acceptance criterion #3 ('merge-question-surfacer is invoked iff this gate says so') was deliberately deferred to the sibling task 'merge-question-surfacer' (currently in work/tasks/ready/). Today no call site reads cfg.mergeQuestions outside config/test files (ripgrep confirms), so the axis is dead config until the surfacer lands. The nit suggests a Decisions-block entry on the source task and a tracking note on the surfacer task so the surfacer's reviewer verifies the gate is actually consulted at the invocation site.
>
> 2. The surface-area names introduced (env var DORFL_MERGE_QUESTIONS, flag --merge-questions, at src/env-config.ts L67-72 and src/cli.ts L2508-2510) were never named in the applied answers. They are consistent with the observationTriage / DORFL_OBSERVATION_TRIAGE / --observation-triage family (screaming-snake / kebab of the camelCase key), so they look correct — but they are user-visible defaults chosen by the builder, not by the human.
>
> Both are explicitly non-blocking; Gate 2 already APPROVED. The decision is purely about where this signal should live going forward.

_Suggested default: Fold nit #1 into the existing 'merge-question-surfacer' task as a tracking note (its reviewer must check cfg.mergeQuestions is actually read at the invocation site, otherwise the axis is dead config) and ratify nit #2 in-place (the names follow the observationTriage family convention and are correct); then delete this observation, since both nits are discharged without needing a new standalone task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
