<!-- dorfl-sidecar: item=observation:review-nits-test-clean-rebase-semantic-break-2026-06-26 type=observation slug=review-nits-test-clean-rebase-semantic-break-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — promote the test-fixture-choice ratification to a task (e.g. add a Decisions block / PR-description enumeration of the marker env var, JSON-line marker, and two-clone fixture), keep it parked as a durable note, or delete it as already-absorbed nits?**

> work/notes/observations/review-nits-test-clean-rebase-semantic-break-2026-06-26.md records ONE non-blocking nit from Gate 2's APPROVAL of 'test-clean-rebase-semantic-break': the agent picked three test-internal fixture choices without a Decisions block — (a) DORFL_TEST_MARKER env var pointing outside any worktree so fresh-gate worktree reaping cannot eat it, (b) verify script appends one JSON line {util, callerExists} per run, (c) two independent clones (one per work branch) so A's uncommitted edits cannot contaminate B. Cited site: packages/dorfl/test/clean-rebase-semantic-break.test.ts plus the HEAD commit message with no Decisions block. The finding is explicitly test-only with no cross-task surface, and Gate 2 already approved integration, so there is no blocker — only the question of whether the choices should be durably documented somewhere (commit/PR amendment or follow-up task) or dropped.

_Suggested default: Delete the observation: the nit is test-only, has no cross-task surface, Gate 2 already approved, and the fixture choices are self-evident in the test source — durably re-documenting them is low value. If anything is kept, a tiny follow-up task to add a Decisions block to the PR/commit description is the lightest promotion._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
