<!-- dorfl-sidecar: item=observation:review-nits-decision-engine-shared-decide-seam-2026-06-25 type=observation slug=review-nits-decision-engine-shared-decide-seam-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this bundle of non-blocking review nits — promote to a follow-up task, keep as a durable note pending the keystone apply task, or delete because the nits are already addressed in JSDoc?**

> The Gate-2 review APPROVED the PR but raised four ratification-style nits (outcome value-name vocabulary, decide() API arity, and four unrecorded in-scope decisions). Each nit is sound and JSDoc-documented in packages/dorfl/src/decision-engine.ts; none blocks integration. The PRD agentic-question-resolution-retire-disposition-vocabulary calls out a downstream keystone task (agentic-apply-retire-disposition-vocabulary) that will consume the engine next — that is the natural site for a vocabulary/API ratification to land, which is why these surfaced here as an observation rather than a task. Choices: promote-task (mint a short follow-up that ratifies vocabulary + records the four in-scope decisions in the task file as a Decisions block); keep (let the keystone consumer task force the ratification when it wires the allowed-outcome set); delete (decide the JSDoc-level documentation is sufficient and no further record is needed); dropped (out-of-scope or superseded by the keystone).

_Suggested default: promote-task — the engine names `{task|prd|adr|delete|ask}` and the PRD's decision 3/14 names `{mint-task|mint-prd|mint-adr|delete-source|ask-follow-up}`; that divergence will harden the moment the keystone apply task + the future `mint-adr` route start importing the engine, so ratifying the canonical wire vocabulary BEFORE consumers land is cheap insurance. A small task that (a) picks one vocabulary and renames if needed, (b) decides the `decide()` arity (2 vs 3 params), (c) records the four in-scope decisions in the task's Decisions block, is the honest discharge._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):

## Q2

**Is `{task | prd | adr | delete | ask}` the canonical wire vocabulary for the shared decision engine's outcomes, or should it be renamed to match the PRD's `{mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}` tokens before the keystone apply task + future `mint-adr` route consume it?**

> decision-engine.ts: `export type DecisionOutcome = 'task'|'prd'|'adr'|'delete'|'ask'`. PRD `agentic-question-resolution-retire-disposition-vocabulary` decision 3 says: 'advance-apply allows {mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}'. The short names match intake's pre-existing IntakeOutcome ('ask'|'task'|'prd'|'bounce'), so the engine's choice is coherent with the nearer prior art — but it silently diverges from the PRD's longer tokens, and the divergence is unrecorded. Whichever wins will be propagated by the keystone apply task into the sidecar's `disposition:` vocabulary; locking it in late means rewriting the keystone + an ADR-mint route.

_Suggested default: Keep the short tokens (`task`/`prd`/`adr`/`delete`/`ask`) as canonical and update PRD decision 3/14's wording in a small follow-on edit — they match intake's existing IntakeOutcome verbatim, are shorter, and the PRD's longer forms read as English description not as identifiers. Record the choice as a ratification in the follow-up task's Decisions block._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Is the landed positional-DI shape `decide(input, decider, allowedOutcomes)` the ratified API, or should the decider be moved to a named option (matching intake's `performIntake({decide?})` shape) before consumers harden?**

> PRD US #9 + the task title both write the engine as `decide(input, allowedOutcomes) → verdict` (2 params). The landed signature is `decide(input, decider, allowedOutcomes)` (3 params, decider injected positionally). Intake injects its decider as an OPTION on performIntake (`decide?: IntakeDecider`), not positionally. The seam IS the whole point of the task, so threading it positionally is defensible — but the spec's shorthand elided the question and the agent did not record the choice.

_Suggested default: Ratify the positional 3-arg shape — for a PURE function with NO other options, threading the seam positionally is simpler than wrapping it in an option-bag, and the engine genuinely has no other knobs. Intake's option-bag shape is justified by its OTHER options (octokit, logger, …); the bare engine has none. Record this as an explicit Decision in the follow-up task._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Ratify the four unrecorded in-scope additions made beyond the bare `decide` core: (a) `parseDecisionVerdict`, `DisallowedOutcomeError`, and `EmptyAllowedOutcomesError` as exported production-wire surface; (b) `EmptyAllowedOutcomesError` as a NEW fail-fast on an empty allowed set; (c) the guard inspects ONLY the `outcome` discriminator and never validates per-outcome content channels (content validation is pushed to the dispatching caller); (d) `allowedOutcomes` accepts any `Iterable`, not just an array. Keep all four, revise any?**

> git show -s b67942c has no Decisions block; work/tasks/done/decision-engine-shared-decide-seam.md is byte-identical to its launch snapshot. Each of the four choices is sound and JSDoc-documented in decision-engine.ts, but the task prompt explicitly asked the agent to RECORD non-obvious in-scope choices — so per the task's own instruction these are ratification findings, not silent defaults. The engine staying outcome-AGNOSTIC about per-outcome content channels (c) is the most consequential of the four because the dispatching caller (the keystone apply task) inherits responsibility for that validation.

_Suggested default: Keep all four as-is and record them in the follow-up task's Decisions block: they are individually defensible (publicly-exported parsing + typed errors are the right wire surface; refusing an empty allowed set is a fail-fast on a programmer error; outcome-agnostic content validation matches PRD decision 14's 'engine stays outcome-AGNOSTIC' explicitly; `Iterable` is more permissive without cost). The fix is documentation, not code._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
