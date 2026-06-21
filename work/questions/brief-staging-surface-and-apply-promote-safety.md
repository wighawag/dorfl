<!-- agent-runner-sidecar: item=brief:staging-surface-and-apply-promote-safety type=brief slug=staging-surface-and-apply-promote-safety allAnswered=false -->

## Q1

**F1 scope: is this brief's F1 the WHOLE STEP-B rename of `folder-taxonomy-reorg-and-rename`, or a scoped slice limited to the readers F2/F3 actually touch (ledger-read, lifecycle-gather, scan, config doc-comments, `slicesLandIn`/`prdsLandIn` value space)?**

> Brief carries `needsAnswers:true` with this as Open Question #1. F1 finishes the deferred STEP-B `backlog -> pool/todo` vocabulary fix. The tasked brief `folder-taxonomy-reorg-and-rename` owns the full rename; this brief notes 'do not boil the ocean' but also 'leave no `backlog`-means-pool reader behind in the touched paths'. Decision affects whether this brief consumes the tasked brief or coexists with it.

_Suggested default: Scoped slice: only the readers F2/F3 touch, and explicitly reference the tasked brief so the remainder of STEP-B is not orphaned._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Scoped slice. F1 here fixes ONLY the `backlog`-means-pool readers that F2/F3 actually touch (ledger-read, lifecycle-gather, scan, the `config.ts` doc-comments + the `slicesLandIn`/`prdsLandIn` value space where `'backlog'` still means "pool"), renaming the pool noun to `todo` and keeping `tasks/backlog` = staging. Do NOT pull the whole STEP-B mechanical rename in here. Reference the tasked brief `folder-taxonomy-reorg-and-rename` so the remainder is not orphaned, AND update that brief to record that this brief consumed its surface-pool-reader slice, so the two cannot silently overlap or re-do each other's work.

## Q2

**F3b lock discipline: should `promote` TAKE the per-item `advancing` lock for its CAS window (briefly held, serialises silently with apply), or REFUSE while an `advance` lock is held (louder, simpler, human retries)?**

> Open Question #2. Promote is currently a tree-less position CAS that does not respect the item's per-item lock, so apply and promote can interleave and split-brain the item on `main`. Take-the-lock matches the two-axis lock's mutual-exclusion intent; refuse-while-held is simpler to implement and reason about. Both close the race; the choice sets the UX.

_Suggested default: Promote TAKES the per-item `advancing` lock for its CAS window (matches the two-axis lock's existing mutual-exclusion semantics, no human retry surface)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Promote TAKES the per-item `advancing` lock for its CAS window. The decisive reason is architectural, not UX: the per-item two-axis lock (`ledger-status-per-item-lock-refs`) exists precisely so that implement/slice/advance on one item are mutually exclusive BY CONSTRUCTION, atomic, not advisory. "Refuse while an advance lock is held" is a check-then-act against the lock, which reintroduces exactly the check-then-act race the lock was built to eliminate, and makes promote advisory where every other transition is atomic. So take-the-lock is the only option consistent with WHY the lock exists. Promote acquires the item lock (action axis: a position/promote transition, or reuse `advance` if a distinct action value is over-engineering), does its tree-less position CAS, releases. An apply already holding the lock makes promote lose cleanly, and vice versa.

## Q3

**Slice ordering: must F3 (apply folder-agnostic + promote-respects-lock) land STRICTLY BEFORE F2 (surface on staging), or can they land TOGETHER in one slice — and is shipping F2 before F3 ruled out entirely?**

> Open Question #3. F2's safety depends on F3: surfacing on staging is only safe once apply x promote cannot corrupt each other. The brief asserts no slice should ship staging-surfacing on top of the unfixed concurrency hole, but does not say whether F3-before-F2 must be separate slices or can be one slice that contains both in dependency order.

_Suggested default: F3 lands before F2 — either as a strictly earlier slice, or as the earlier half of a combined slice whose tests gate F2 behind F3 being green._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

F3 STRICTLY BEFORE F2, as a SEPARATE slice (not the earlier half of one combined slice). Reason: F3 is a correctness fix that is valuable on its own and fixes a concurrency hole that exists TODAY, independent of F2; it should ship and be verified as its own demoable tracer-bullet slice. F2 is a behaviour change that only becomes SAFE once F3 has landed, so F2's slice declares `blockedBy: [<F3 slice>]` and its tests assert the F3 invariants are green as a precondition. Shipping F2 before F3 is ruled out entirely. Combining them into one slice is rejected because the behaviour change (F2) could mask an F3 regression, and because two independently-verifiable correctness/behaviour concerns deserve two slices. (F1 the vocabulary fix is a prefactor that lands first or alongside F3, since both touch the same readers.)

## Q4

**Do briefs (`briefs/proposed` -> `briefs/ready`, with `needsAnswers`) need the SAME surface-on-staging + apply-vs-promote fixes symmetrically in this brief, or are briefs explicitly out of scope for this pass?**

> Open Question #4. `prdsLandIn` governs brief staging the same way `slicesLandIn` governs task staging, and briefs also carry `needsAnswers` (this very brief does). If briefs share the bug they probably need symmetric fixes; if scoped out, the brief should say so to avoid orphaning the brief-side defect.

_Suggested default: Out of scope for this pass: tasks-only here; file a follow-up observation/brief if briefs exhibit the same surface-gating and promote-race issues._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Do NOT blanket-defer briefs; SPLIT by concern, because we have DIRECT evidence briefs share at least F2 (this very `needsAnswers` brief is being surfaced via the brief surface pool right now, and `prdsLandIn` mirrors `slicesLandIn` exactly).

- **F1 (vocabulary):** covers briefs inherently (the pool-noun fix touches the shared readers). In scope.
- **F2 (surface on staging):** IN SCOPE for briefs symmetrically. The surface pool already enumerates `namespace: 'brief'` legs, so `surfaceStaging` must cover the brief staging folder (`briefs/proposed/`) too, not only `tasks/backlog/`. A `needsAnswers` brief in staging should surface its questions before promotion, exactly like a task.
- **F3 (apply x promote):** the PROMOTE-respects-the-lock half covers briefs too (briefs are promoted `proposed -> ready` via the same position-CAS verb, so the lock fix must apply to the brief promote path). The APPLY-folder-agnostic half is task/brief-symmetric where briefs carry `needsAnswers` and get an apply, so include it for briefs as well; only any genuinely task-only apply specifics (if found during slicing) are scoped out, and the slicer should call them out explicitly rather than blanket-excluding briefs.

Net: briefs are in scope across F1/F2/F3; the slicer only carves out a brief-specific case if it finds one, and names it.
