---
title: review-gate non-blocking nits for 'decision-engine-shared-decide-seam' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: decision-engine-shared-decide-seam
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'decision-engine-shared-decide-seam' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Outcome value-name choice: the engine names its outcomes `{task | prd | adr | delete | ask}`, but PRD decision 3/14 names the advance-apply allowed set `{mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}`. Was the shortened token set (`task`/`delete`/`ask` vs `mint-task`/`delete-source`/`ask-follow-up`) a deliberate decision, and is it the canonical wire vocabulary the keystone apply task + future ADRs must use? Ratify or rename now, before consumers + an ADR-mint route harden it.
  (decision-engine.ts:DecisionOutcome = 'task'|'prd'|'adr'|'delete'|'ask'; PRD decision 3: 'advance-apply allows {mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}'. The short names actually match intake's own IntakeOutcome ('ask'|'task'|'prd'|'bounce'), so the choice is coherent with the nearer prior art — but it silently diverges from the PRD's longer tokens, and the divergence is unrecorded.)
- API shape: the spec/PRD write the engine as `decide(input, allowedOutcomes) → verdict` (2 params), but the landed signature is `decide(input, decider, allowedOutcomes)` (3 params, decider injected positionally). Intake instead injects its decider as an OPTION on performIntake (`decide?: IntakeDecider`). Ratify the positional-decider DI shape for the pure engine core (it is reasonable for a pure function, but it is an in-scope API decision the spec's shorthand elided and the agent did not record).
  (decision-engine.ts: `export async function decide<TInput>(input, decide, allowedOutcomes)`. Task title + PRD US#9 both say `decide(input, allowedOutcomes)`. The injected seam is the whole point of the task, so threading it positionally is a defensible reading; just unrecorded.)
- Unrecorded in-scope decisions (no `## Decisions` block in the PR/commit, task file unchanged from its launch snapshot). The task prompt explicitly asked the agent to RECORD non-obvious in-scope choices; it recorded none. Please ratify the following, all of which are made in the code/JSDoc but not surfaced for review: (a) `parseDecisionVerdict` + `DisallowedOutcomeError` + `EmptyAllowedOutcomesError` were added as a public, exported production-wire surface (beyond the bare `decide` core the acceptance criteria named); (b) `EmptyAllowedOutcomesError` is a new fail-fast on an empty allowed set (a new refusal); (c) the guard inspects ONLY the `outcome` discriminator and never validates per-outcome content channels (content validation is pushed to the dispatching caller); (d) `allowedOutcomes` accepts any `Iterable` (Set or array), not just an array.
  (git show -s b67942c has no Decisions block; work/tasks/done/decision-engine-shared-decide-seam.md is byte-identical to the launched task. Each choice is sound and JSDoc-documented in decision-engine.ts, but per the task's own instruction an un-recorded in-scope decision is a ratification finding, not a silent default.)
