<!-- dorfl-sidecar: item=observation:advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22 type=observation slug=advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation — promote it to a slice (and at what scope), keep it as a tracked signal, or drop it?**

> The note documents a real, reproduced structural defect: the in-place scan path (`src/scan.ts` `scanRepoPaths`, ~L535) defaults `heldSlugs = new Set()` and `gatherLifecycleInPlace` is called with no held-slug filter (~L566), so the CI `advance-lifecycle` propose matrix enumerates items whose per-item lock is HELD (stuck/active). Those legs then always lose the claim CAS (`src/claim-cas.ts:127-132`) and exit 2, redding CI every scheduled tick for as long as any item is stuck — which is the NORMAL state after a Gate-2 review block (`review: true`). The mirror-side scan branch (~L418) already subtracts via `heldSliceSlugs`, so the fix is to mirror that wiring onto the in-place path (likely async or pre-fetched into the CLI `scan` action). Three observed slugs (`c2-rebase-until-real-on-durable-main-promotions`, `per-machine-config-override-layer`, `prompt-guidance-testfirst-config-and-prompt-seam`) all had bodies already in `work/tasks/done/` while their lock refs remained held. The note also proposes a belt-and-suspenders leg-side benign-skip that overlaps with the sibling observation `advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`.

_Suggested default: promote-slice — subtract-at-enumerate is the root-cause fix and is small/well-scoped; whether to also fold in the leg-side benign-skip (shared with the sibling observation) is a sub-decision for the slicer to record in the task body._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**If promoted, should this be ONE slice (subtract-at-enumerate only), ONE slice that ALSO folds in the leg-side benign-skip shared with the sibling observation `advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21`, or TWO slices (enumerate-side here, leg-side jointly with the sibling)?**

> The note's 'To weigh' paragraph explicitly defers this: subtract-at-enumerate (root cause) vs benign-skip-at-leg (covers the enumerate→fan-out race window where an item becomes held between snapshot and leg) vs both. The leg-side change has shape-overlap with the sibling observation's proposal for the already-done race, so combining them could be natural or could conflate two distinct bugs.

_Suggested default: Two slices: one for subtract-at-enumerate here (root cause), and a separate joint slice covering the leg-side benign-skip with the sibling observation — keeps each PR's scope tight and the matrix-vs-leg responsibilities clean._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
