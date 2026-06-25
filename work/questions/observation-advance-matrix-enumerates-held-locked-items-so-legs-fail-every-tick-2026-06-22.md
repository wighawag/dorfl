<!-- dorfl-sidecar: item=observation:advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22 type=observation slug=advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal? It is an untriaged observation (status: spotted, needsAnswers: true) reporting a real, code-confirmed CI-correctness bug: the in-place scan path never subtracts held-locked slugs, so stuck/active-locked items stay in the propose matrix and their legs fail the claim CAS every tick. Should it be minted into a task (and if so, scoped to which fix), folded into the sibling observation's task, recorded as an ADR, kept as a standing note, or dropped?**

> Verified against current code (packages/dorfl/src):
> - scan.ts: scanRepoPaths (L505-562) defaults heldSlugs = new Set() (L517) and passes it to scoreItems; its in-place gatherLifecycleInPlace call (L549) takes no held filter. The held subtraction is wired only on the MIRROR branch (heldTaskSlugs at L400), but CI runs in-place.
> - All in-place callers pass new Set(): do-autopick.ts:115, advance-drivers.ts:178, cwd-section.ts:140 — so no in-place pool subtracts held locks.
> - claim-cas.ts:142 emits 'already claimed ... per-item lock is held' and the leg exits 2, reddening CI every scheduled tick while any item is stuck (the NORMAL post-Gate-2-review state).
> The note proposes a scoping fork: (a) subtract-at-enumerate (root cause: thread heldSliceSlugs onto scanRepoPaths -> scoreItems AND gatherLifecycleInPlace, likely needing an async variant since lock-ref reads are async); (b) benign-skip-at-leg (treat a STUCK-held item as exit 0, the same shape the sibling observation 'advance-leg-on-stale-snapshot-exits-2' proposes); or (c) BOTH (defence in depth, also covering the enumerate->fan-out race window). The sibling observation (advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21) is already triaged 'keep' with needsAnswers: false. No existing task in work/tasks/ addresses held-slug subtraction.

_Suggested default: Mint a task for the root-cause enumerate-side fix (thread held-lock subtraction onto the in-place scan path so the propose matrix never enumerates a held item), and note the benign-skip-at-leg behaviour as a coordinated belt-and-suspenders option shared with the sibling observation's task rather than duplicating it. The diagnosis is concrete and the fix is small and well-scoped; the human decides whether to also fold in the leg-side skip now or defer it to the sibling._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
