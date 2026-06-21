<!-- agent-runner-sidecar: item=brief:staging-surface-and-apply-promote-safety type=brief slug=staging-surface-and-apply-promote-safety allAnswered=false -->

## Q1

**F1 scope: is this brief's F1 the WHOLE STEP-B rename of `folder-taxonomy-reorg-and-rename`, or a scoped slice limited to the readers F2/F3 actually touch (ledger-read, lifecycle-gather, scan, config doc-comments, `slicesLandIn`/`prdsLandIn` value space)?**

> Brief carries `needsAnswers:true` with this as Open Question #1. F1 finishes the deferred STEP-B `backlog -> pool/todo` vocabulary fix. The tasked brief `folder-taxonomy-reorg-and-rename` owns the full rename; this brief notes 'do not boil the ocean' but also 'leave no `backlog`-means-pool reader behind in the touched paths'. Decision affects whether this brief consumes the tasked brief or coexists with it.

_Suggested default: Scoped slice: only the readers F2/F3 touch, and explicitly reference the tasked brief so the remainder of STEP-B is not orphaned._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**F3b lock discipline: should `promote` TAKE the per-item `advancing` lock for its CAS window (briefly held, serialises silently with apply), or REFUSE while an `advance` lock is held (louder, simpler, human retries)?**

> Open Question #2. Promote is currently a tree-less position CAS that does not respect the item's per-item lock, so apply and promote can interleave and split-brain the item on `main`. Take-the-lock matches the two-axis lock's mutual-exclusion intent; refuse-while-held is simpler to implement and reason about. Both close the race; the choice sets the UX.

_Suggested default: Promote TAKES the per-item `advancing` lock for its CAS window (matches the two-axis lock's existing mutual-exclusion semantics, no human retry surface)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Slice ordering: must F3 (apply folder-agnostic + promote-respects-lock) land STRICTLY BEFORE F2 (surface on staging), or can they land TOGETHER in one slice — and is shipping F2 before F3 ruled out entirely?**

> Open Question #3. F2's safety depends on F3: surfacing on staging is only safe once apply x promote cannot corrupt each other. The brief asserts no slice should ship staging-surfacing on top of the unfixed concurrency hole, but does not say whether F3-before-F2 must be separate slices or can be one slice that contains both in dependency order.

_Suggested default: F3 lands before F2 — either as a strictly earlier slice, or as the earlier half of a combined slice whose tests gate F2 behind F3 being green._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**Do briefs (`briefs/proposed` -> `briefs/ready`, with `needsAnswers`) need the SAME surface-on-staging + apply-vs-promote fixes symmetrically in this brief, or are briefs explicitly out of scope for this pass?**

> Open Question #4. `prdsLandIn` governs brief staging the same way `slicesLandIn` governs task staging, and briefs also carry `needsAnswers` (this very brief does). If briefs share the bug they probably need symmetric fixes; if scoped out, the brief should say so to avoid orphaning the brief-side defect.

_Suggested default: Out of scope for this pass: tasks-only here; file a follow-up observation/brief if briefs exhibit the same surface-gating and promote-race issues._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):
