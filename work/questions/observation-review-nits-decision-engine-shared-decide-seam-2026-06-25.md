<!-- dorfl-sidecar: item=observation:review-nits-decision-engine-shared-decide-seam-2026-06-25 type=observation slug=review-nits-decision-engine-shared-decide-seam-2026-06-25 allAnswered=false -->

## Q1

**What should become of this observation (the three non-blocking review nits on the now-integrated 'decision-engine-shared-decide-seam')? Now that consumers have hardened, do you want to (a) ratify all three landed choices and delete this note as resolved, (b) mint a small task to retro-record the in-scope decisions, or (c) something else?**

> Triage question for an untriaged observation (needsAnswers: true). The item records 3 NON-BLOCKING nits from a Gate-2 APPROVE of 'decision-engine-shared-decide-seam'; the task is already in work/tasks/done/ and integrated, so none of these block anything. Investigation against current code shows the central nit has largely RESOLVED itself downstream (see q2), so the live decision is mostly disposal vs. a tidy-up retro-record task. The human owns this; surfacing the residue, not deciding it.

_Suggested default: Ratify the landed choices and delete the note (option a): the choices are sound and now consumer-canonical, and a retro '## Decisions' record adds little once consumers have hardened around them._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Ratify the landed choices and delete the note (option a). The choices are sound and now consumer-canonical; a retro `## Decisions` record adds little once consumers have hardened around them. Q2-Q4 below ratify the specifics.

## Q2

**Is the SHORT outcome token set `{task | prd | adr | delete | ask}` the canonical wire vocabulary (vs. the PRD's longer `{mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}`), so future ADRs/consumers must use the short names? Confirm and (if so) close this nit, since downstream code has already hardened on it.**

> decision-engine.ts:54 DecisionOutcome = 'task'|'prd'|'adr'|'delete'|'ask'. The nit feared an unrecorded divergence from PRD decision 3/14's longer tokens. Current reality has effectively answered it: apply-decide.ts:32 and advance.ts:693 now state verbatim that `{task|prd|adr|delete|ask}` IS `{mint-task|mint-prd|mint-adr|delete-source|ask-follow-up}` (equivalent), the short set matches intake's IntakeOutcome ('ask'|'task'|'prd'|'bounce') prior art, and agentic-apply-mint-adr-route (now in work/tasks/done/) wired the `adr` route on the short set. So the 'rename now before consumers harden' window has effectively closed in favour of the short set; this is now a ratification, not an open design fork.

_Suggested default: Yes — ratify the short token set as canonical and close this nit; the divergence is already reconciled in the JSDoc of apply-decide.ts and advance.ts, and no rename is warranted._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes, ratify the short token set `{task|prd|adr|delete|ask}` as canonical. The divergence from the PRD's longer names is already reconciled in the JSDoc of apply-decide.ts and advance.ts (documented as equivalent), it matches intake's prior art, and the adr route was wired on the short set. No rename.

## Q3

**Ratify (or reject) the landed positional-decider DI shape `decide(input, decider, allowedOutcomes)` (3 params), which the spec/PRD shorthand wrote as `decide(input, allowedOutcomes)` (2 params) and which differs from intake's option-injected `decide?: IntakeDecider`?**

> decision-engine.ts:174 `export async function decide<TInput>(input, decide, allowedOutcomes: Iterable<DecisionOutcome>)`. Task title + PRD US#9 say `decide(input, allowedOutcomes)`. Threading the injected seam positionally is a defensible reading for a PURE function (the injected seam is the whole point of the task), but it is an in-scope API decision the spec elided and the agent did not record in a `## Decisions` block.

_Suggested default: Ratify the 3-param positional shape: it is idiomatic for a pure injected-seam function and the test suite already exercises it; no change._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Ratify the 3-param positional shape `decide(input, decider, allowedOutcomes)`. Threading the injected seam positionally is idiomatic for a pure injected-seam function (the whole point of the task) and the test suite already exercises it. No change.

## Q4

**Ratify (or revise) the four unrecorded in-scope decisions the agent made in 'decision-engine-shared-decide-seam' but did not surface in a `## Decisions` block: (a) `parseDecisionVerdict` + `DisallowedOutcomeError` + `EmptyAllowedOutcomesError` exported as public production-wire surface beyond the bare `decide` core; (b) `EmptyAllowedOutcomesError` as a new fail-fast on an empty allowed set; (c) the guard inspects ONLY the `outcome` discriminator and never validates per-outcome content (pushed to the dispatching caller); (d) `allowedOutcomes` accepts any `Iterable` (Set or array), not just an array?**

> git show -s b67942c has no Decisions block; work/tasks/done/decision-engine-shared-decide-seam.md is byte-identical to its launch snapshot, yet the task prompt explicitly asked the agent to RECORD non-obvious in-scope choices. Each choice is sound and JSDoc-documented in decision-engine.ts (confirmed: lines 122/144 for the error classes, 174-186 for the Iterable guard + empty-set fail-fast, 210 for parseDecisionVerdict). Per the task's own instruction an un-recorded in-scope decision is a ratification finding, not a silent default.

_Suggested default: Ratify all four as-is: each is sound, JSDoc-documented, and test-covered; capturing them in this note's context is sufficient record without reopening the done task._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Ratify all four as-is. Each (the exported parse/error surface, the empty-allowed-set fail-fast, the discriminator-only guard delegating content validation to the caller, and the `Iterable` acceptance) is sound, JSDoc-documented, and test-covered. Capturing them in this note's context is sufficient record without reopening the done task.
