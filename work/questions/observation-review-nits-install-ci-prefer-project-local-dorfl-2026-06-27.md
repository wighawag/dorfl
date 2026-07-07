<!-- dorfl-sidecar: item=observation:review-nits-install-ci-prefer-project-local-dorfl-2026-06-27 type=observation slug=review-nits-install-ci-prefer-project-local-dorfl-2026-06-27 allAnswered=false -->

## Q1

**What should become of nit 1 — the missing '## Decisions' block recording the shim-on-GITHUB_PATH mechanism choice for install-ci-prefer-project-local-dorfl?**

> Task line 42 required a Decisions block; the shipped task (work/tasks/done/install-ci-prefer-project-local-dorfl.md) has none. There is already a sibling observation 'decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22' tracking that the convention is broadly skipped, so this nit is a fresh instance of an already-open systemic question.

_Suggested default: Delete this bullet as a duplicate signal; let the existing 2026-06-22 observation own the enforce-or-relax decision._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Drop this nit as a duplicate: the missing `## Decisions` block is a fresh instance of the standing `decisions-block-convention-repeatedly-skipped` observation (answered RELAX). Let that one own the systemic question.

## Q2

**What should become of nit 2 — extending the install-ci uniformity test to also pin verify-workflow-template and advance-ci-template against absolute/local-only dorfl paths?**

> Confirmed against packages/dorfl/test/install-ci.test.ts (lines ~942-1090, ~1820): the shipped capabilities list only pins advance-lifecycle, intake, close-job. verify-workflow-template.ts and advance-ci-template.ts also emit dorfl invocations through the shared setup action and are currently unguarded.

_Suggested default: Promote to a small task: widen the uniformity test to cover verify-workflow-template and advance-ci-template._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Promote a small task: widen the install-ci uniformity test to also pin verify-workflow-template and advance-ci-template against absolute/local-only dorfl paths (they emit dorfl invocations through the shared setup action and are currently unguarded). Real coverage gap. Then delete this observation.

## Q3

**What should become of nit 3 — ratifying that the resolver shim step is appended unconditionally in BOTH registry and workspace install modes?**

> install-ci-core.ts appends resolverStep unconditionally; the workspace-mode ordering test covers it, so the shim runs after 'pnpm link --global'. Task said to leave the workspace path intact; behaviour is preserved but the workspace path does now carry the extra shim step. No ADR records this scope choice.

_Suggested default: Keep-as-is and close: record a one-line note in the task/PR that uniform application was intentional, then delete this bullet — no code change needed._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Ratify and close: the unconditional resolver-shim step in both registry and workspace install modes is intended and behaviour-preserving (workspace ordering test covers it running after `pnpm link --global`). No code change; the ratification is recorded here. Fold into the Q2 task's delete.
