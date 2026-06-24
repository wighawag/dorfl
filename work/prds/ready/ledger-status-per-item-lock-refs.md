---
title: Move transient ledger STATUS onto per-item lock refs (one lock per item; main = content + durable records)
slug: ledger-status-per-item-lock-refs
humanOnly: true
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. Originating design trail: `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` (candidates C0–C8, requirement sets, the lock-entry state machine, the C8 pressure-test). Governing decision: `docs/adr/ledger-status-on-per-item-lock-refs.md`. SIBLING PRD: `work/prd/staging-pool-position-gate-and-trust-model.md` (the position gate / trust model, orthogonal, composes here via the eligible-pool retarget and the runner-owns-transitions enforcement).
>
> **VOCABULARY CORRECTION (2026-06-18, drift reconciled before slicing).** This PRD and its ADR were written in the position gate's END-STATE vocabulary (`todo/` = pool, `prd-ready/` = auto-slice pool, `out-of-scope/` = terminal). What ACTUALLY landed (the position gate's STEP-A migration, verified in `work/done/` + the code) is the INVERTED staging form: `backlog/` STAYS the eligible pool and a new `pre-backlog/` is the pre-pool (staging); `prd/` STAYS the auto-slice pool and a new `pre-prd/` is staging; and the durable terminal is the GENERIC `dropped/` (which generalised `out-of-scope/`). The eventual `backlog → todo` / `pre-backlog → backlog` / `prd → prd-ready` rename is the SEPARATE, deferred `work/prd/folder-taxonomy-reorg-and-rename.md` (STEP B), which depends on THIS lock work landing first. So the slices below are cut against the LANDED names: **the pool a claim reads is `backlog/`**, **the durable terminal a complete/drop writes is `dropped/`**. When the STEP-B rename lands it only changes WHICH on-`main` folder noun is read as "the pool" (`backlog → todo`); the lock mechanism is untouched. Where this PRD's older prose still says `todo`/`out-of-scope`, read it as `backlog`/`dropped` per this note.

## Problem Statement

Three verified, interacting defects ride the ONE ledger primitive (`ledgerWrite.applyTransition`, a CAS push to `main` with a whole-`main`-ref `--force-with-lease`):

1. **FALSE CONTENTION.** Two writers touching DIFFERENT files still falsely contend on the shared `main` lease; under high CI parallelism the small retry budget is exhausted and legs fail with `push rejected N times (main is contended)` (exit 3).
2. **BRANCH INHERITANCE.** Lock markers / status files live in main's TREE, so a work branch cut from `main` inherits stale `work/advancing/` markers and on-branch needs-attention moves, causing rename/rename rebase conflicts; a `drop-bookkeeping-rebase` mechanism exists only to mitigate the self-conflicts the design creates.
3. **NO CROSS-ACTION EXCLUSION.** claim / slicing / advancing are independent markers/moves on distinct refs that do not read each other, so an item could be claimed-and-built WHILE it is being advanced (answered/triaged), risking loss of the advance's edit.

The cost of not fixing this is a recurring, load-bearing concurrency failure (the exit-3 CI breakage) plus a whole class of branch-rebase ledger conflicts and a maintenance burden (the drop-rebase machinery).

## Solution

Split the ledger by what each kind of state actually IS (governing ADR `ledger-status-on-per-item-lock-refs`):

- **`main` keeps the readable CONTENT tree checked out, and the ONLY moves on `main` are the DURABLE RESTING transitions:** `backlog → done`, `prd → prd-sliced`, `backlog → dropped` (the generic "won't-proceed" terminal that generalised `out-of-scope/`; reason in the body). These are exactly the dependency-resolving / permanent records, so `blockedBy → done/` and `sliceAfter → prd-sliced/` keep resolving OFFLINE against `main`, unchanged.
- **Transient STATUS + LOCKS move to PER-ITEM lock refs.** `in-progress`, `needs-attention`, `slicing`, `advancing` collapse into ONE lock per item, keyed by item identity, on a hidden `refs/dorfl/lock/<entry>` ref. The lock entry is a two-axis record `action: implement|slice|advance` × `state: active|stuck` (+ reason/holder/since). `in-progress` = lock held active for implement; `needs-attention` = lock held stuck.

Because the lock is PER ITEM, the only writer that can contend on item X's lock is another writer FOR X, a GENUINE conflict the loser should lose, so a create-only / leased per-item ref push is self-arbitrating with NO retry loop and NO false contention (this is the P-opt-1 mechanism the `claim-ledger-vs-protected-main` ADR recorded; the visibility objection that rejected it is void because human working-tree visibility of transient status is dropped here). The two durable `main` promotions still write the shared `main` ref, so THOSE keep a retrying/serialized CAS, the only place retry remains.

This dissolves all three defects: #1 (no shared-ref lease for locks; per-item refs never falsely contend), #2 (a branch cut from `main` inherits NO transient status, there is none in main's tree, so the drop-rebase machinery becomes unnecessary), #3 (one lock per item makes advance/slice/implement mutually exclusive BY CONSTRUCTION, atomic, not advisory). It also makes protected-`main` tractable (claim + intermediates never touch `main`).

From the user's perspective: claims/slices/advances stop failing under parallelism, kept branches stop self-conflicting on rebase, an item can never be built and advanced at once, and a human reads in-flight state via `dorfl status` (which reads the lock refs) while backlog/done/prd/prd-sliced + content stay `ls`-able on `main`.

## User Stories

1. As a CI operator running a high-parallelism matrix, I want claim/slice/advance to never fail with `push rejected N times (main is contended)`, because per-item lock refs never falsely contend.
2. As the runner, I want each item's lock to live on its OWN ref (`refs/dorfl/lock/<entry>`), so the only contender for item X's lock is another writer for X (a genuine conflict), and the loser is cleanly and definitively told "lost" with no retry budget.
3. As the runner, I want one lock per item shared across actions, so claiming/implementing, slicing, and advancing the same item are MUTUALLY EXCLUSIVE by construction, a second action on a held item loses the same atomic CAS.
4. As the runner, I want the lock entry to be a two-axis record (`action` × `state` + reason/holder/since), so "building" vs "slicing" vs "advancing" and "active" vs "stuck (needs-attention)" are all representable in one entry without separate folders.
5. As a maintainer, I want `in-progress`, `needs-attention`, and `slicing` to STOP being `main` folders and become lock-ref state, so a work branch cut from `main` inherits no transient status and can never hit a stale-marker rename/rename rebase conflict.
6. As a maintainer, I want the `drop-bookkeeping-rebase` module and its call sites removed once no transient status lands on a branch, so the version-fragile rebase-todo machinery is gone for good.
7. As a maintainer, I want `main`'s ONLY `work/` moves to be the durable resting transitions (`backlog → done`, `prd → prd-sliced`, `backlog → dropped`), each atomic with its artifacts, so `main`'s write surface is minimal and `blockedBy`/`sliceAfter` resolve offline against `main` unchanged.
8. As a human, I want `dorfl status`/`scan` to show what is in-flight (held/stuck locks) by reading the lock refs, since the transient status is no longer an `ls`-able folder; content + durable records stay readable on `main`.
9. As the runner completing an item, I want the order "hold lock → land the durable `main` move → release lock" to be crash-safe: a crash after the `main` move but before release leaves a `done`-on-`main` item with a stale lock, and recovery treats the `main` durable record as authoritative and clears the stale lock.
10. As the runner, I want `done` on `main` and a `stuck` lock to be able to co-exist (a rebase-conflict bounce can mark a just-completed item stuck), so the lock-ref state and the `main` record can legitimately disagree without corruption.
11. As an operator, I want the lock ref to be a HIDDEN `refs/dorfl/*` ref (not a branch), so it does not clutter the GitHub UI, is not swept by "delete merged branches" automation, and is not fetched by a default clone.
12. As an operator, I want accidental deletion of the lock ref(s) to be RECOVERABLE, "all locks released," with the work still safe on the `work/<slug>` branches + `main`, so the blast radius is far smaller than a `--force` to `main`; an absent lock ref is treated as "no locks held."
13. As the runner, I want a held runner whose OWN lock vanished mid-build to detect it (its release finds nothing) and abort/needs-attention rather than silently clean-release.
14. As a human, I want `release-lock <item>` + a stuck-lock report in `gc --ledger` (generalising the landed `release-advancing`), so a stuck/orphaned lock is nameable and clearable; there is no liveness heartbeat and no auto-sweep (a human asserts a lock is dead).
15. As the runner, I want the claimable predicate to become "in the pool on `main` (today `backlog/`) AND no lock held on the lock ref," so claim no longer MOVES the body out of `backlog/` (the body never relocates until the durable promotion) and the selection readers subtract lock-held slugs. (When the deferred STEP-B rename lands, "the pool" becomes `todo/`; only the folder noun changes, not the predicate's shape.)
16. As an operator of a PROTECTED-`main` repo, I want claim + all intermediate state to never touch `main` (so an agent CAN claim), while the durable promotions reach `main` via the existing PR-merge path.
17. As a maintainer, I want the lock acquire/release to work on a bare `--bare file://` arbiter identically to a real remote (a ref is a ref), preserving the provider-agnostic kill-criterion.
18. As a maintainer, I want every lock acquire/release/mark-stuck to be RUNNER-mediated (the agent never touches the lock ref), consistent with the runner-owns-transitions enforcement (sibling PRD).
19. As a maintainer, I want the lock refs to be SELF-CLEANING and not accumulate storage over time: RELEASE DELETES the ref (it does not empty it), so the live ref set equals only the currently-held items (bounded by concurrency, tens not thousands), and a resting item has NO ref at all.
20. As a maintainer, I want each lock-entry commit to be a tiny PARENTLESS throwaway (not chained onto `main`'s history), so the moment its ref is deleted the commit is fully UNREACHABLE and normal git gc (on a `--bare` arbiter) or the host's gc (GitHub) reclaims it, leaving no permanent debris and keeping the lock ref fully decoupled from `main`'s object graph.
21. As an operator, I want the lock-ref churn (one tiny parentless object per claim/slice/advance, reclaimed on delete) to be COMPARABLE to the existing `work/<slug>` branch create/delete churn the system already produces, so this adds no new storage-growth class; the ONLY thing that can linger is a CRASH-ORPHANED lock ref, which `release-lock <item>` + the `gc --ledger` stuck-lock report already cover (no auto-sweep).

## Implementation & Testing Decisions

> SLICED (2026-06-18), the implementation and testing detail that used to live here now lives in the `work/backlog/` slices (each carries its own acceptance criteria, seams, and self-contained prompt), and the durable rationale (the per-item-ref substrate, the self-cleaning/parentless-commit storage argument, the two-axis state machine + invariants, the `main`-holds-durable-records cleave line) lives in `docs/adr/ledger-status-on-per-item-lock-refs.md` + the design trail `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` (the C8 section + the lock-entry state machine in full). This PRD is trimmed to its durable framing (Problem / Solution / User Stories / Out of Scope) so the stale-prone detail is not maintained in two places.
>
> The slices, in build order (all `humanOnly: true`, a DECIDED review-gate so a human reviews each build in turn via the `drive-backlog` skill, NOT inherited from this PRD's `humanOnly`):
>
> 1. `unified-item-lock-module-from-tracer`: lift the green tracer (`item-lock-ref.ts`) into the production lock module; no caller retargeted (the smallest independent tracer).
> 2. `lock-entry-state-machine-and-invariants`: the six CAS transitions + invariants (≤1 entry/item; `reason` iff `stuck`; `done`+`stuck` co-exist).
> 3. `claim-acquires-unified-lock-no-body-move`: claim acquires the lock; body stays in `backlog/`; claimable = "in `backlog/` on `main` AND no lock held".
> 4. `slicing-acquires-unified-lock`: slicing becomes an `action:slice` hold; `prd → prd-sliced` stays the durable `main` move; keep the stale-edit check.
> 5. `advancing-acquires-unified-lock`: advancing becomes an `action:advance` hold on the same ref; issue #3 exclusion is atomic here.
> 6. `needs-attention-as-stuck-lock-state`: needs-attention is the `stuck` lock state; `status`/`scan` read the lock refs.
> 7. `complete-lock-then-durable-main-move-crash-safe`: hold → durable `main` move → release; `main` record authoritative over a stale lock.
> 8. `release-lock-verb-and-gc-stuck-report`: `release-lock <item>` + a stuck-lock report in `gc --ledger`; absent ref = no locks; vanished-own-lock aborts.
> 9. `retire-transient-folders-and-drop-rebase`: the capstone, retire the transient folders, delete `drop-bookkeeping-rebase`, prove a plain rebase.
>
> SEQUENCING NOTE (2026-06-18): the FIRST drive surfaced that #3/#4/#5 as originally scoped were unbuildable in isolation, each REMOVED a transient `main` artifact (the `in-progress/` body move, the `slicing/`/`advancing/` markers) whose folder CONSUMERS were retargeted only in the capstone #9, declared BEHIND them, so #3's own `pnpm -r test` gate could never be green. Resolution (conductor + human, Option A): #3/#4/#5/#6 were RE-SCOPED to INTERIM DUAL-WRITE (also acquire/mark the unified lock but KEEP the legacy `main` artifact so every existing consumer + test stays green), and #9 was EXPANDED to own the full cut-over (stop the legacy writes, retarget every consumer onto the lock/`backlog/`, retire the four transient folders). This is why #3-#6 carry RE-SCOPED banners and #9 a SCOPE-EXPANDED one; the PRD end-state is unchanged, only the green-sequencing to reach it. (All nine landed; the dual-write is fully cut over.)
>
> Acceptance gate for every slice: `pnpm -r build && pnpm -r test && pnpm format:check`, on throwaway repos + a `--bare file://` arbiter (the house pattern in `test/helpers/gitRepo.ts`).
>
> NOTE on C2 (rebase-until-real-conflict): it is NOT needed for the lock (per-item refs are retry-free) and is deliberately NOT sliced into the lock mechanism. The durable `main` promotions still share the `main` ref and CAN falsely-contend between two DIFFERENT items, left on today's bounded retry for now; the better fix (C2 on the promotions) is captured as `work/observations/durable-main-promotions-still-share-main-ref-may-falsely-contend-c2-candidate.md` for later triage. The vocabulary correction (pool = `backlog/`, terminal = `dropped/`) is in the launch-snapshot banner at the top.

## Out of Scope

- The "Set 1" alternative (keep status on `main`, fix only the CAS via rebase-until-real + fold the advancing marker into the branch-carries drop-set). It is the fallback IF working-tree visibility of transient status is later deemed mandatory; recorded in the idea file, not built here. This PRD commits to the Set-2 / per-item-ref substrate.
- The staging/pool POSITION gate + the trust/placement model + the `humanOnly` de-overloading, owned by the SIBLING PRD `staging-pool-position-gate-and-trust-model.md` (sliced; 4/5 slices in `done/`, the `dropped/` terminal among them). They compose (this PRD's "pool" is that PRD's eligible pool, today `backlog/`, eventually `todo/`), but are orthogonal: this PRD is the lock substrate, that one is the eligibility gate. The eventual `backlog → todo` rename is the deferred `folder-taxonomy-reorg-and-rename` PRD (STEP B), NOT this work; keep current folder names here.
- Moving the durable `→done`/`→prd-sliced` moves off `main` (rejected: they are the referenceable records and their `main` atomicity with artifacts is the point).
- Changing `blockedBy`/`sliceAfter` semantics (they resolve against `done/`/`prd-sliced/` on `main`, unchanged).

## Further Notes

- Relationship to existing PRDs: this SUPERSEDES the `branch-carries-code-not-ledger-status-main-owns-status` PRD's mechanism (its drop-rebase removal + on-branch-move removal are subsumed by "no transient status on `main` at all") and RETIRES the decided co-located `<slug>.lock.md` relocation (taxonomy PRD US #10–14) as a concurrency fix, the lock is no longer a `main`-tree file. Record those dispositions when slicing.
- This is a load-bearing concurrency primitive: a wrong move corrupts the claim/lock invariants the whole runner depends on. `humanOnly: true` is set because the SLICING needs human judgement on sequencing (C2-for-promotions decision, the drop-rebase removal, the crash-recovery ordering, the migration from five folders to the lock-ref). Individual slices may be agent-buildable once cut.
- An ADR already records the durable why (`ledger-status-on-per-item-lock-refs`); slices should reference it rather than re-argue it.
