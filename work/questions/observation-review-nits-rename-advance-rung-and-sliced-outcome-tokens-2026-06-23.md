<!-- agent-runner-sidecar: item=observation:review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23 type=observation slug=review-nits-rename-advance-rung-and-sliced-outcome-tokens-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking nits from the Gate-2 review of 'rename-advance-rung-and-sliced-outcome-tokens' (a stale doc-comment in do.ts:548 still listing 'sliced' in the passthrough-outcomes contract, and the ratification of the in-scope comment-only edits to integration-core.ts that the task body did not list)?**

> Both findings verified against current code:
> - packages/agent-runner/src/do.ts:548 — the JSDoc still reads `* contract: outcomes pass through (sliced / gate-refused / stale / agent-failed /` even though the surrounding code at do.ts:558-559 was renamed to 'tasked' in the same slice. Pure cosmetic (comment only, no behaviour) but directly inside the rename's blast radius — a one-word `sliced` → `tasked` fix.
> - integration-core.ts edits (3 occurrences, lines ~153-159 and ~922-926: commitTag JSDoc + inline comment, 'sliced' → 'tasked') were made even though the task body listed only do.ts/tasking.ts/intake.ts for Rename 2. The change is comment-only and correct (otherwise the comments would have stranded the renamed tag); the reviewer recommends ratifying the scope extension. No '## Decisions' block exists in the PR description.
> Neither nit blocks integration; this observation is their durable triage home.

_Suggested default: promote-task — a tiny, well-scoped follow-up slice doing a one-word `sliced` → `tasked` comment sweep across do.ts:548 (and a grep to catch any other stale 'sliced' references in comments/docs), plus a one-line note ratifying the integration-core.ts comment edits as in-scope for the rename. Trivial to verify; closes the residue cleanly._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
