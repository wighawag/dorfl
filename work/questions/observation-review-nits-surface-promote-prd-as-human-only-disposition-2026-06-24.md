<!-- dorfl-sidecar: item=observation:review-nits-surface-promote-prd-as-human-only-disposition-2026-06-24 type=observation slug=review-nits-surface-promote-prd-as-human-only-disposition-2026-06-24 allAnswered=false -->

## Q1

**Ratify the out-of-task observation note `git-integration-tests-time-out-under-parallel-load-2026-06-24` that the build agent captured during this task — does the human accept it as a legitimate inbox signal, and what becomes of THIS nit (the act of capturing it)?**

> Nit #1 in the observation body: the agent added `work/notes/observations/git-integration-tests-time-out-under-parallel-load-2026-06-24.md` in commit 13bbf4b alongside the disposition change, flagging two git-integration tests flaking under parallel load at the 5000ms per-test timeout. It is correctly bucketed (observation, `needsAnswers: true`, open question on raising `testTimeout` vs capping parallelism) and explicitly disclaimed as unrelated to the surface/triage vocabulary change. The review-gate flagged it non-blocking — the human should ratify that capturing it was in-scope-of-the-run, not scope creep. The downstream CI-flake question belongs to that OWN observation's surface pass, not this one; this nit is only about ratifying the capture.

_Suggested default: dropped — ratified as good capture hygiene; the captured observation will be triaged on its own via its own surface pass, so THIS nit needs no further action._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

## Q2

**What becomes of the unreachable-assertion nit in `triage-gate.test.ts` (the US#5 `if (emit.auto) { expect(['duplicate','map']).toContain(emit.kind); }` block guarded by a preceding `expect(emit.auto).toBe(false)`)?**

> Nit #2 in the observation body: in `packages/dorfl/test/triage-gate.test.ts` the `NEVER auto-promotes` case asserts `expect(emit.auto).toBe(false)` and THEN has an `if (emit.auto) { ... }` block that is unreachable at runtime — it serves as compile-time type-narrowing only, despite reading like a runtime assertion. Review marked it harmless and non-blocking; the question is whether to leave it (self-documenting) or tidy it (e.g. `expect(emit.auto).toBe(false); if (!emit.auto) return;` style, or drop the dead branch).

_Suggested default: dropped — harmless and arguably self-documenting; not worth a task._

<!-- q2 fields: id=q2 disposition=dropped -->

**Your answer** (write below this line):
