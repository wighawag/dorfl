<!-- dorfl-sidecar: item=task:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 type=task slug=integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21 allAnswered=false -->

## Q1

**Is this task SUPERSEDED by the already-tasked brief `briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md` and should be `dropped` (reason: superseded)? The brief explicitly cites this observation in its launch snapshot, names the same engine seams (`integrateLock`, `mergeRetries`, the cross-job CAS loop), and has ALREADY RESOLVED the exact decision this task would carry: its `## Applied answers 2026-06-22 → q1` confirms `(a) scaled mergeRetries as the git-alone FLOOR + (b) a ref-based cross-job land-lock as the portable ACCELERATOR; (c) GitHub Actions concurrency: as optional host sugar only`, plus the ADR working name `land-is-rebase-reverify-advance-one-primitive-two-frontends` that captures the durable rule. The brief's user stories #5/#13 and its Testing Decisions also cover the cross-job concurrency test. If `dropped`, the originating observation already sits answered in `work/questions/observation-…md`; no further work is lost.**

> The task body is a one-paragraph stub: "Promoted from observation … A human answered 'promote': draft this into a buildable slice." BUT the answered sidecar (`work/questions/observation-integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21.md` → Q1) actually answered `promote-adr` (NOT promote-slice), with explicit text: "Note: a ready brief (`land-time-reverify-and-parallel-merge-ceiling`) already cites this observation, so prefer FOLDING this rule into that brief's eventual ADR rather than spinning a standalone one. Disposition: promote-adr." That brief is now `tasked/` with the matter resolved in-line. So the task appears to have been created from a misread of the disposition (promote-task instead of promote-adr) AND duplicates an already-folded decision.

_Suggested default: dropped — superseded by `briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md` (which folds this rule into its planned ADR `land-is-rebase-reverify-advance-one-primitive-two-frontends` and into stories #5/#13). Record `reason: superseded by briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md` in the task body before routing to `tasks/cancelled/`._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

dropped — superseded by `briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md`, which cites this observation in its launch snapshot, names the same seams (`integrateLock`, `mergeRetries`, the cross-job CAS loop), and has already resolved the decision (mergeRetries floor + ref-based cross-job land-lock accelerator + GitHub Actions concurrency as optional host sugar) into its planned ADR `land-is-rebase-reverify-advance-one-primitive-two-frontends` and stories #5/#13. Record `reason: superseded by briefs/tasked/land-time-reverify-and-parallel-merge-ceiling.md` in the task body before routing to `tasks/cancelled/`. Q2 and Q3 are moot under this disposition (they only apply if the task is KEPT).

## Q2

**If instead this task is KEPT as a standalone item (rejecting the supersession above), what is its precise buildable scope: (a) author the ADR alone (`land-is-rebase-reverify-advance-one-primitive-two-frontends`, or a narrower `cas-is-the-cross-runner-queue` ADR), (b) implement the scaled-`mergeRetries` precedence-chain config NOW (flag > env > per-repo > global > default, default unchanged), (c) implement the portable ref-based cross-job land-lock NOW (`refs/dorfl/land-lock` CAS-claim with a TTL/stale-reclaim story), or (d) some combination — and how does that scope avoid colliding with the brief's slices once it produces them?**

> The observation itself frames the work as "Decision to record when the CI parallel-merge shape is designed" and "Not fixing here: a sizing/design decision for the future parallel-merge CI shape." The brief's resolved q1 also flags (b) the ref-lock as conditional on "a sound stale-lock reclaim" — if that is not cheap, ship (a) scaled now and split (b) into a follow-on. Without an explicit scope choice, the task cannot be claimed (the slicer would have to guess between an ADR-only doc slice and a code slice that introduces a new ref-lock primitive — materially different sizes and risk).

_Suggested default: If kept, narrow to (a) ADR-only — capture the durable rule ("across runners, the CAS loop IS the queue; within a runner, the in-process `integrateLock` is the optimisation; size the retry cap or add a cross-job concurrency group for the matrix width on purpose") and an explicit forward seam for (b) and (c). Defer the actual `mergeRetries` precedence-chain plumbing and the ref-lock implementation to the brief's own slices, so this task remains a documentation-only sibling that cannot collide with code slices._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**If kept and ADR-scoped (per the previous question's default), should this task's ADR be FOLDED into the brief's planned `land-is-rebase-reverify-advance-one-primitive-two-frontends` ADR (one ADR carrying the whole land-primitive doctrine plus this cross-runner-queue sub-rule), or stand alone as a smaller, focused ADR (e.g. `cas-is-the-cross-runner-merge-queue`) that the larger ADR references?**

> The brief's `## Implementation Decisions` trim-line says: "the durable WHY (the authored-context-vs-lived-context principle, the floor/ceiling gradient) goes into an ADR (working name `land-is-rebase-reverify-advance-one-primitive-two-frontends`)." The observation's rule is a NATURAL sub-section of that ADR (under the cross-job-merge serialiser discussion). A standalone ADR risks fragmenting one coherent doctrine; folding risks an oversize ADR. The answered sidecar's own preference was to FOLD: "prefer FOLDING this rule into that brief's eventual ADR rather than spinning a standalone one."

_Suggested default: Fold — make this task contribute a SECTION to the brief's `land-is-rebase-reverify-advance-one-primitive-two-frontends` ADR (the in-process-lock-is-optimisation / CAS-is-cross-runner-queue / retry-cap-sizing rule), not a separate ADR file. This matches the answered sidecar's stated preference and keeps the doctrine in one place._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
