<!-- dorfl-sidecar: item=observation:surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10 type=observation slug=surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10 allAnswered=false -->

Item: [`observation:surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10`](../notes/observations/surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10.md)

## Q1

**What should become of this observation — mint a task to fix it, and if so along which angle (strengthen the surface-questions SKILL prompt to always emit a bare {questions: []} object when there is nothing to ask, or short-circuit already-triaged / decision-record observations in the engine so they never reach the surface agent), pursue both, defer, or drop it?**

> Observation records a recurrence of the 'surface agent produced no parseable {questions} result' hard-error on a pure decision-record observation (rename-spec-4b-namespace-consumer-clause-noop-2026-07-10). The note-field mitigation from the prior observation (surface-rung-agent-emits-no-parseable-questions) did not fully close it. The observation is explicit that it is tangential to the cutover, not blocking, and names two candidate angles without deciding. It carries no ## Open questions block; verified at work/notes/observations/surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10.md and surface-gate.ts:102-146.

_Suggested default: Mint a surface-robustness task pursuing BOTH angles: engine-side short-circuit for already-triaged / decision-record observations (removes the model round-trip and its flakiness), plus a SKILL-prompt tightening so the fallback path reliably emits {questions: []} — belt-and-braces, since the loud-failure design is correct and the residual defect is agent reliability._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Mint a task pursuing BOTH angles, prioritising the engine short-circuit. Primary: short-circuit already-triaged / decision-record observations in the engine so they never reach the surface agent (deterministic, does not depend on the model behaving). Secondary: also strengthen the surface-questions SKILL prompt to always emit a bare {questions: []} object when there is nothing to ask (best-effort defence-in-depth). The engine fix is the load-bearing half.
