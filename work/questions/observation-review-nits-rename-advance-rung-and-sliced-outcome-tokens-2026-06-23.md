<!-- dorfl-sidecar: item=observation:review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23 type=observation slug=review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23 allAnswered=false -->

## Q1

**This observation records two non-blocking review nits from the Gate-2 approval of 'rename-advance-rung-and-sliced-outcome-tokens', and both appear ALREADY RESOLVED in current code. What becomes of this signal: delete it as discharged, or keep it open for a reason I'm missing?**

> The observation is a durable home for two cosmetic review nits (file: work/notes/observations/review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23.md, needsAnswers: true). Checking both against current reality: (1) the stale comment the first nit flags ('outcomes pass through (sliced / gate-refused / stale / agent-failed / usage-error)') no longer exists in packages/dorfl/src/do.ts — `grep -rn 'sliced' packages/dorfl/src/do.ts` returns nothing; (2) the second nit asks to extend the 'sliced' -> 'tasked' comment sweep into packages/dorfl/src/integration-core.ts — that file now contains zero 'sliced' occurrences and already reads 'the tasking transition supplies tasked' (integration-core.ts:158, 1019). Both follow-up sweeps the observation proposed seem to have already happened.

_Suggested default: Delete the observation as discharged: both nits are no longer present in the code, so there is no residual work to triage. (Verify with `grep -rn sliced packages/dorfl/src/do.ts packages/dorfl/src/integration-core.ts` returning empty before deleting.)_

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**[low-priority nit, carried verbatim] do.ts passthrough-contract comment still named the OLD outcome word 'sliced' in '* contract: outcomes pass through (sliced / gate-refused / stale / agent-failed / ...)'. Is the one-word 'sliced' -> 'tasked' fix worth a follow-up, or is it moot now?**

> Original nit cited packages/dorfl/src/do.ts:548. Cosmetic only (a comment, no behaviour), in the rename's blast radius. CURRENT-REALITY CHECK: the cited comment text is no longer findable in do.ts (no 'sliced' occurrences remain), so this nit appears already fixed in a later sweep — likely moot.

_Suggested default: Moot / no action: the stale comment is gone from do.ts. Fold into the delete-the-observation decision above._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**[low-priority nit + ratification, carried verbatim] The build agent also edited packages/dorfl/src/integration-core.ts (comment-only, 'sliced' -> 'tasked' in the commitTag JSDoc + an inline comment), a file the task body did NOT list among files to touch (it named do.ts/tasking.ts/intake.ts). No '## Decisions' block recorded the scope extension. Do you ratify extending the comment sweep to integration-core.ts?**

> Original nit cited git diff dbc13d5^ d3b2ac7 -- packages/dorfl/src/integration-core.ts (lines 153-159, 922-926). The change is correct + coherent (leaving 'sliced' there would have stranded a stale comment naming the renamed tag); the reviewer's own recommendation was 'Ratify'. CURRENT-REALITY CHECK: integration-core.ts now contains zero 'sliced' and reads 'the tasking transition supplies tasked' — the edit is in place and consistent.

_Suggested default: Ratify: the comment-only extension to integration-core.ts is correct and keeps the renamed tag's docs consistent. No corrective action needed._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
