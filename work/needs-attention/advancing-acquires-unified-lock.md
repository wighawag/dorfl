---
title: ADVANCING additionally acquires the unified lock (interim dual-write; advancing/ marker kept)
slug: advancing-acquires-unified-lock
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer, lock-entry-state-machine-and-invariants]
covers: [1, 3, 18]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write).** Symmetric to the claim
> and slicing re-scopes: removing the `work/advancing/<entry>.md`-on-`main` marker in
> isolation would break the consumers that still read the `advancing/` folder
> (`ledger-lint.ts`, `ledger-write.ts`, `cli.ts`, `advancing-lock.ts`) and the tests
> that assert it, while the folder-retirement that fixes them is the capstone #9. So
> this slice makes advancing ADDITIONALLY acquire the per-item lock (`action: advance`)
> while KEEPING today's `work/advancing/<entry>.md` marker CAS exactly as-is. The
> marker removal + the `advancing/` folder retirement are DEFERRED to
> `retire-transient-folders-and-drop-rebase` (#9).

## What to build

Make the ADVANCING lock ALSO acquire the item's unified per-item lock
(`action: advance`) at acquire time, **in addition to** today's CAS-published
`work/advancing/<entry>.md` marker on `main`. This is the additive, back-compatible
half of the advancing retarget: it introduces the lock as the cross-action exclusion
primitive WITHOUT removing the `advancing/`-on-`main` marker the rest of the runner
still consumes.

Concretely, after this slice:

- `acquireAdvancingLock` keeps CAS-publishing today's `work/advancing/<entry>.md`
  marker UNCHANGED, and ADDITIONALLY acquires the unified per-item lock
  (`action: advance`). If the lock acquire is `lost` (the item is already held for
  implement/slice/advance), the advancing acquire loses definitively (no retry) and
  does NOT publish the marker either, the two mechanisms agree on the winner.
- `releaseAdvancingLock` keeps deleting today's marker UNCHANGED, and ADDITIONALLY
  releases the unified per-item lock.
- The advance hold can reach the `stuck` state via the lock's mark-stuck transition
  (the advance-stuck cell the old marker could not represent cleanly).

This slice realises issue #3 (cross-action exclusion) ATOMICALLY through the lock:
because advance now ALSO takes the SAME per-item lock as claim and slice, an item
CANNOT be advanced while it is being implemented, nor claimed while it is being
advanced, the second acquirer loses the SAME lock CAS. There is no advisory
eligibility bar and no TOCTOU window; the exclusion IS the lock. The marker removal +
`advancing/` folder retirement are OUT OF SCOPE here and owned by #9 (see the
RE-SCOPED banner). The advance flow stays runner-mediated (the agent never touches
the lock ref), exactly as the landed advancing-lock already is.

## Acceptance criteria

- [ ] `acquireAdvancingLock` ADDITIONALLY acquires the unified per-item lock
      (`action: advance`); today's `work/advancing/<entry>.md` marker CAS is KEPT
      unchanged (interim dual-write). A lock `lost` makes the acquire lose
      definitively (no retry) and publishes NO marker in that case.
- [ ] `releaseAdvancingLock` ADDITIONALLY releases the unified per-item lock; the
      existing marker delete is unchanged.
- [ ] advance∥claim and advance∥slice on the SAME item: the second acquirer loses
      the SAME lock CAS atomically (no advisory check, no TOCTOU); tested on a
      `--bare file://` arbiter.
- [ ] An advance hold can reach the `stuck` state (the advance-stuck cell), carrying
      its reason on the lock entry.
- [ ] The acquire/release stays runner-mediated; the agent never touches the lock ref.
- [ ] Every EXISTING advancing/advance test still passes (the `advancing/` marker
      still lands on `main`); this slice does NOT remove the marker or retire the
      folder.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API).
- `lock-entry-state-machine-and-invariants` (acquire/mark-stuck/release; the
  advance-stuck cell).

## Prompt

> Make the ADVANCING lock ALSO acquire the unified per-item lock, IN ADDITION to
> today's behaviour. Today it CAS-publishes a `work/advancing/<type>-<slug>.md` marker
> onto `main` from a throwaway branch (`packages/agent-runner/src/advancing-lock.ts`,
> `acquireAdvancingLock`/`releaseAdvancingLock`, addressed via `advancingMarkerPath` /
> `listAdvancingMarkers`), read it first; it is the closest existing analogue and the
> production lock module generalises it. KEEP that marker CAS as-is. ADD: on a
> successful acquire, ALSO acquire the unified per-item lock (`action: advance`) via
> the lock module (`acquireItemLock`, keyed through `lockEntryFor`, which reuses the
> SAME `<type>-<slug>` seam `advancingMarkerPath` uses); if the lock acquire is
> `lost`, the advancing acquire loses (no retry) and publishes NO marker. On release,
> ALSO release the unified lock. PRD `work/prd/ledger-status-per-item-lock-refs.md`
> (US #1, #3, #18); ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`; state
> machine in the trail's "### The C8 lock-entry STATE MACHINE".
>
> READ the RE-SCOPED banner at the top of this slice: this is the INTERIM DUAL-WRITE
> half only. Do NOT remove the `work/advancing/<entry>.md` marker, do NOT retire the
> `advancing/` folder. Those break the `advancing/`-folder consumers (`ledger-lint.ts`,
> `ledger-write.ts`, `cli.ts`) + their tests, whose retargets are the capstone slice
> #9; they are explicitly OUT OF SCOPE here.
>
> This is the slice where issue #3 becomes ATOMIC: advance now ALSO takes the SAME
> lock as claim and slice, so advance∥claim and advance∥slice on one item are mutually
> exclusive BY CONSTRUCTION (the second acquirer loses the same lock CAS), no advisory
> eligibility bar, no TOCTOU. Prove that with a race test on a `--bare file://`
> arbiter (`test/helpers/gitRepo.ts`). Keep the acquire/release RUNNER-mediated (the
> agent never touches the lock ref). The advance hold must be able to go `stuck` via
> the lock's mark-stuck transition (the advance-stuck cell the old marker could not
> represent cleanly). Prove the EXISTING advancing tests still pass (the marker still
> lands). "Done" = `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.

## Needs attention

The slice's premise — "advancing ALSO acquires the SAME unified per-item lock, so advance∥claim and advance∥slice are mutually exclusive BY CONSTRUCTION" — is sound for concurrent contenders but COLLIDES with the existing advance tick's structure, which is NOT in the slice's scope to change.

In `packages/agent-runner/src/advance.ts`, `performAdvance` takes `acquireAdvancingLock({item})` (step 3 LOCK) and then, for the `build-slice` and `slice-prd` rungs, ORCHESTRATES the inner `performDo({arg: item})` (step 4 EXECUTE) which ITSELF takes the SAME unified per-item lock:
- build-slice: advancing lock holds unified `slice-<slug>`; inner `performDo('slice:<slug>')` → `performClaim` → `acquireItemLock({item:'slice:<slug>', action:'implement'})` loses the create-only CAS on the ref the advancing lock already holds → the build can never claim.
- slice-prd: advancing lock holds unified `prd-<slug>`; inner `performDo('prd:<slug>')` → `acquireSlicingLock` → unified `prd-<slug>` loses for the same reason.

So the advancing lock and the inner `do`'s lock are NESTED (one logical operation), not two racers, and the unified lock makes the advance tick deadlock against itself. claim/slice do no re-entrant or holder-based detection (deliberate, per ADR `ledger-status-on-per-item-lock-refs`: no auto-steal), so the inner acquire definitively returns `lost`.

Evidence: implementing the slice exactly as written (mirroring the landed `slicing-acquires-unified-lock`) makes 9 previously-green advance-tick tests fail — `test/run-uses-advance-tick.test.ts` (claimedAndDone/needsAttention drop to 0) and `test/advance-registry-set.test.ts` (multi-mirror build/slice batches, gates-off outcome-equivalence). Pure-unit advance∥claim / advance∥slice race tests and the stuck-cell test all pass; only the advance-tick orchestration path breaks. Stashing my change makes all 13 pass again.

The slicing slice (#4) avoided this only because it left the advancing lock as a plain marker (no unified hold), so the `slice-prd` wrapper did not contend with the inner slicing lock. This slice is the first to put a unified hold on the OUTER advancing wrapper.

Suggested re-scope: decide (with a human) how advance-as-driver coordinates with the unified lock before this slice can land. Likely options, each touching files outside this slice: (a) `performAdvance` should NOT take the unified lock for the `build-slice` / `slice-prd` rungs (those rungs are pure orchestration of an inner `do` that already takes the lock; the inner claim/slice is the single exclusion point), taking it ONLY for the tree-less rungs (surface/apply/triage) that have no inner `do` lock; or (b) make the inner `do` recognise a unified lock already held by the same driving operation as re-entrant (changes `claim-cas.ts` / `slicing-lock.ts`, and contradicts the no-auto-steal ADR unless scoped to a same-process driver token). Either way the decision is load-bearing and belongs in the slice/PRD, not buried in `advancing-lock.ts`. The advancing→unified-lock retarget for the marker semantics (the pure interim dual-write this slice intends) is only safe once the advance-tick nesting is addressed.
