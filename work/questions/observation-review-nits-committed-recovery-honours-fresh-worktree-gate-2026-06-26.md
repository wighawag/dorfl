<!-- dorfl-sidecar: item=observation:review-nits-committed-recovery-honours-fresh-worktree-gate-2026-06-26 type=observation slug=review-nits-committed-recovery-honours-fresh-worktree-gate-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation (the two Gate-2 non-blocking nits on committed-recovery-honours-fresh-worktree-gate)? Promote one/both to task(s), fold into a follow-up, keep as durable note, or delete?**

> Observation logs two nits from an APPROVED Gate-2 review of task 'committed-recovery-honours-fresh-worktree-gate' (task now under work/tasks/done/). Both nits are still factually present in packages/dorfl/src/integration-core.ts today (call sites at ~L1266 build path vs ~L1819 recovery-tail path; divergent reason strings at ~L1321-1324 vs ~L1851-1855). Signal is real but explicitly non-blocking.

_Suggested default: Keep as durable note (no task); both are intentional divergences and cosmetic string drift with no correctness impact._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Small cleanup task for the cosmetic string alignment (Q3), and ratify the design divergence (Q2) in-place. Both nits are non-blocking; only the reason-string verb-swap (Q3) is worth a code touch. Then delete this observation.

## Q2

**Should the recovery-tail invocation of runFreshWorktreeGate thread the build path's review callback, or is the current omission (no Gate-2 review semantics on answered-merge land) the right permanent design?**

> integration-core.ts L1819 calls runFreshWorktreeGate with prepare/verify/env/note only; L1266 (build path) additionally passes review: when input.review is set. The task said to mirror the build path's freshWorktreeGate && !skipVerify && !lifecycle branch, so this is a deliberate divergence that deserves ratification.

_Suggested default: Keep as-is: answered-merge / committed-recovery land intentionally has no Gate-2 review semantics today; document the divergence in a code comment rather than adding the callback._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Keep as-is: answered-merge / committed-recovery land intentionally has no Gate-2 review semantics (the recovery tail is re-verifying an already-reviewed, already-committed result). Document the divergence in a one-line code comment at the recovery-tail runFreshWorktreeGate call site rather than threading the review callback.

## Q3

**Should the recovery-path user-visible reason strings be aligned with the build-path strings, or is the '... during committed-recovery; ... not integrating ...' phrasing kept deliberately distinct so needs-attention messages tell the operator which path failed?**

> Recovery (L1851-1855) says '... on the rebased tip during committed-recovery; routed ...' / '... not integrating ...'. Build path (L1321-1324) says '... on the rebased tip; routed ...' / '... not completing ...'. The extra phrase is informative but the verb swap (integrating vs completing) is unmotivated drift.

_Suggested default: Keep the 'during committed-recovery' distinguisher (useful signal) but change 'not integrating' → 'not completing' to match the build path's verb._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Keep the `during committed-recovery` distinguisher (useful operator signal for which path failed) but change `not integrating` -> `not completing` to match the build-path verb (the verb swap was unmotivated drift). Small string fix, bundle with Q1's cleanup task.
