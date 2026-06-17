---
title: Move transient ledger STATUS onto per-item lock refs (one lock per item; main = content + durable records)
slug: ledger-status-per-item-lock-refs
humanOnly: true
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. Originating design trail: `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` (candidates C0–C8, requirement sets, the lock-entry state machine, the C8 pressure-test). Governing decision: `docs/adr/ledger-status-on-per-item-lock-refs.md`. SIBLING PRD: `work/prd/staging-pool-position-gate-and-trust-model.md` (the position gate / trust model, orthogonal, composes here via the `todo/`-as-pool retarget and the runner-owns-transitions enforcement).

## Problem Statement

Three verified, interacting defects ride the ONE ledger primitive (`ledgerWrite.applyTransition`, a CAS push to `main` with a whole-`main`-ref `--force-with-lease`):

1. **FALSE CONTENTION.** Two writers touching DIFFERENT files still falsely contend on the shared `main` lease; under high CI parallelism the small retry budget is exhausted and legs fail with `push rejected N times (main is contended)` (exit 3).
2. **BRANCH INHERITANCE.** Lock markers / status files live in main's TREE, so a work branch cut from `main` inherits stale `work/advancing/` markers and on-branch needs-attention moves, causing rename/rename rebase conflicts; a `drop-bookkeeping-rebase` mechanism exists only to mitigate the self-conflicts the design creates.
3. **NO CROSS-ACTION EXCLUSION.** claim / slicing / advancing are independent markers/moves on distinct refs that do not read each other, so an item could be claimed-and-built WHILE it is being advanced (answered/triaged), risking loss of the advance's edit.

The cost of not fixing this is a recurring, load-bearing concurrency failure (the exit-3 CI breakage) plus a whole class of branch-rebase ledger conflicts and a maintenance burden (the drop-rebase machinery).

## Solution

Split the ledger by what each kind of state actually IS (governing ADR `ledger-status-on-per-item-lock-refs`):

- **`main` keeps the readable CONTENT tree checked out, and the ONLY moves on `main` are the DURABLE RESTING transitions:** `backlog → done`, `prd → prd-sliced`, `backlog → out-of-scope`. These are exactly the dependency-resolving / permanent records, so `blockedBy → done/` and `sliceAfter → prd-sliced/` keep resolving OFFLINE against `main`, unchanged.
- **Transient STATUS + LOCKS move to PER-ITEM lock refs.** `in-progress`, `needs-attention`, `slicing`, `advancing` collapse into ONE lock per item, keyed by item identity, on a hidden `refs/agent-runner/lock/<entry>` ref. The lock entry is a two-axis record `action: implement|slice|advance` × `state: active|stuck` (+ reason/holder/since). `in-progress` = lock held active for implement; `needs-attention` = lock held stuck.

Because the lock is PER ITEM, the only writer that can contend on item X's lock is another writer FOR X, a GENUINE conflict the loser should lose, so a create-only / leased per-item ref push is self-arbitrating with NO retry loop and NO false contention (this is the P-opt-1 mechanism the `claim-ledger-vs-protected-main` ADR recorded; the visibility objection that rejected it is void because human working-tree visibility of transient status is dropped here). The two durable `main` promotions still write the shared `main` ref, so THOSE keep a retrying/serialized CAS, the only place retry remains.

This dissolves all three defects: #1 (no shared-ref lease for locks; per-item refs never falsely contend), #2 (a branch cut from `main` inherits NO transient status, there is none in main's tree, so the drop-rebase machinery becomes unnecessary), #3 (one lock per item makes advance/slice/implement mutually exclusive BY CONSTRUCTION, atomic, not advisory). It also makes protected-`main` tractable (claim + intermediates never touch `main`).

From the user's perspective: claims/slices/advances stop failing under parallelism, kept branches stop self-conflicting on rebase, an item can never be built and advanced at once, and a human reads in-flight state via `agent-runner status` (which reads the lock refs) while backlog/done/prd/prd-sliced + content stay `ls`-able on `main`.

## User Stories

1. As a CI operator running a high-parallelism matrix, I want claim/slice/advance to never fail with `push rejected N times (main is contended)`, because per-item lock refs never falsely contend.
2. As the runner, I want each item's lock to live on its OWN ref (`refs/agent-runner/lock/<entry>`), so the only contender for item X's lock is another writer for X (a genuine conflict), and the loser is cleanly and definitively told "lost" with no retry budget.
3. As the runner, I want one lock per item shared across actions, so claiming/implementing, slicing, and advancing the same item are MUTUALLY EXCLUSIVE by construction, a second action on a held item loses the same atomic CAS.
4. As the runner, I want the lock entry to be a two-axis record (`action` × `state` + reason/holder/since), so "building" vs "slicing" vs "advancing" and "active" vs "stuck (needs-attention)" are all representable in one entry without separate folders.
5. As a maintainer, I want `in-progress`, `needs-attention`, and `slicing` to STOP being `main` folders and become lock-ref state, so a work branch cut from `main` inherits no transient status and can never hit a stale-marker rename/rename rebase conflict.
6. As a maintainer, I want the `drop-bookkeeping-rebase` module and its call sites removed once no transient status lands on a branch, so the version-fragile rebase-todo machinery is gone for good.
7. As a maintainer, I want `main`'s ONLY `work/` moves to be the durable resting transitions (`backlog → done`, `prd → prd-sliced`, `backlog → out-of-scope`), each atomic with its artifacts, so `main`'s write surface is minimal and `blockedBy`/`sliceAfter` resolve offline against `main` unchanged.
8. As a human, I want `agent-runner status`/`scan` to show what is in-flight (held/stuck locks) by reading the lock refs, since the transient status is no longer an `ls`-able folder; content + durable records stay readable on `main`.
9. As the runner completing an item, I want the order "hold lock → land the durable `main` move → release lock" to be crash-safe: a crash after the `main` move but before release leaves a `done`-on-`main` item with a stale lock, and recovery treats the `main` durable record as authoritative and clears the stale lock.
10. As the runner, I want `done` on `main` and a `stuck` lock to be able to co-exist (a rebase-conflict bounce can mark a just-completed item stuck), so the lock-ref state and the `main` record can legitimately disagree without corruption.
11. As an operator, I want the lock ref to be a HIDDEN `refs/agent-runner/*` ref (not a branch), so it does not clutter the GitHub UI, is not swept by "delete merged branches" automation, and is not fetched by a default clone.
12. As an operator, I want accidental deletion of the lock ref(s) to be RECOVERABLE, "all locks released," with the work still safe on the `work/<slug>` branches + `main`, so the blast radius is far smaller than a `--force` to `main`; an absent lock ref is treated as "no locks held."
13. As the runner, I want a held runner whose OWN lock vanished mid-build to detect it (its release finds nothing) and abort/needs-attention rather than silently clean-release.
14. As a human, I want `release-lock <item>` + a stuck-lock report in `gc --ledger` (generalising the landed `release-advancing`), so a stuck/orphaned lock is nameable and clearable; there is no liveness heartbeat and no auto-sweep (a human asserts a lock is dead).
15. As the runner, I want the claimable predicate to become "in the pool on `main` AND no lock held on the lock ref," so claim no longer MOVES the body out of `backlog/` (the body never relocates until the durable promotion) and the selection readers subtract lock-held slugs.
16. As an operator of a PROTECTED-`main` repo, I want claim + all intermediate state to never touch `main` (so an agent CAN claim), while the durable promotions reach `main` via the existing PR-merge path.
17. As a maintainer, I want the lock acquire/release to work on a bare `--bare file://` arbiter identically to a real remote (a ref is a ref), preserving the provider-agnostic kill-criterion.
18. As a maintainer, I want every lock acquire/release/mark-stuck to be RUNNER-mediated (the agent never touches the lock ref), consistent with the runner-owns-transitions enforcement (sibling PRD).
19. As a maintainer, I want the lock refs to be SELF-CLEANING and not accumulate storage over time: RELEASE DELETES the ref (it does not empty it), so the live ref set equals only the currently-held items (bounded by concurrency, tens not thousands), and a resting item has NO ref at all.
20. As a maintainer, I want each lock-entry commit to be a tiny PARENTLESS throwaway (not chained onto `main`'s history), so the moment its ref is deleted the commit is fully UNREACHABLE and normal git gc (on a `--bare` arbiter) or the host's gc (GitHub) reclaims it, leaving no permanent debris and keeping the lock ref fully decoupled from `main`'s object graph.
21. As an operator, I want the lock-ref churn (one tiny parentless object per claim/slice/advance, reclaimed on delete) to be COMPARABLE to the existing `work/<slug>` branch create/delete churn the system already produces, so this adds no new storage-growth class; the ONLY thing that can linger is a CRASH-ORPHANED lock ref, which `release-lock <item>` + the `gc --ledger` stuck-lock report already cover (no auto-sweep).

## Implementation Decisions

- **Lock substrate = per-item ref.** One ref per held item (`refs/agent-runner/lock/<entry>`, `<entry>` = the type-encoded `<type>-<slug>` identity the sidecar/advancing-lock already uses), whose existence + content IS the lock. Acquire = create-only / leased push that the arbiter rejects if it already exists; loser = definitively `lost` (no retry budget). This GENERALISES the landed advancing-lock (which already builds the lock on a throwaway branch and CAS-publishes a marker); the change is the substrate (per-item ref instead of a `work/advancing/` marker on `main`) and the unification (one lock for all three actions).
- **Ref lifecycle + storage (the deletable/accumulation question, RESOLVED).** The lock's natural lifecycle is self-cleaning: acquire CREATES the ref, release DELETES it (`git push <arbiter> :refs/agent-runner/lock/<entry>`), so the live ref set is only currently-held items. TWO design choices make this clean and non-accumulating, both load-bearing: (1) RELEASE DELETES the ref, never just empties it (an emptied-but-kept ref would persist one-per-item-ever-locked, the accumulation to avoid); (2) the lock-entry commit is a tiny PARENTLESS commit (a minimal tree/blob with NO parent, NOT chained onto `main`), so on ref-delete it is immediately UNREACHABLE and gc reclaims it. The refs themselves are ~pointer-sized (negligible even if orphaned); the only real storage question is the lock-entry OBJECTS, which become unreachable on delete and are reclaimed by normal `gc`/auto-gc on a `--bare` arbiter and by the host's gc on GitHub (same property as a deleted branch; GitHub keeps unreachable objects transiently until its gc runs, NOT unbounded growth). Net churn = one tiny parentless object per claim/slice/advance, reclaimed on release, COMPARABLE to the `work/<slug>` branch create/delete the system already does. The only lingering case is a CRASH-ORPHANED lock (covered by `release-lock` + `gc --ledger`, no auto-sweep). VERDICT: per-item refs are cheap, deletable, and do NOT accumulate over time given (1)+(2).
- **The lock-entry two-axis state machine** (full version in the idea file): six CAS transitions, acquire `(absent)→[action,active]`, mark-stuck `→[action,stuck]+reason`, resume `→[action,active]`, requeue `→(absent)`, complete `→(durable main move)→(absent)`, release `→(absent)`. Invariants: at most one entry per item (the exclusion); `reason` iff `stuck`; `main` durable records authoritative over a stale lock; `done`+`stuck` may co-exist; no auto-sweep.
- **`main` move set = the three durable promotions ONLY**, each atomic with artifacts. This COMPLETES the `branch-carries-code-not-ledger-status-main-owns-status` PRD's direction (branch = code; main owns durable status) and SUPERSEDES its on-branch needs-attention-move removal + the `drop-bookkeeping-rebase` module (now unnecessary because no transient status lands on a branch at all).
- **C2 (rebase-until-real-conflict) is NOT needed for the LOCK** (per-item refs are retry-free). It MAY still apply to the durable `main` promotions (the shared `main` ref can still falsely-contend between two different items' promotions); decide at slice time whether the promotions use rebase-until-real or a serialized promote. (The lock holds the item, so two promotions of the SAME item cannot race; only DIFFERENT items' promotions share the `main` ref.)
- **Reuse the existing seams:** the `advancingMarkerPath`/`listAdvancingMarkers` addressing seam, the lock acquire/release control flow, the `CAS-Nonce`/verify authority, and the `ledgerWrite` write seam (the per-item-ref strategy slots in behind it, the ADR `claim-ledger-vs-protected-main` seam was built for exactly this). Almost nothing is greenfield.
- **`status`/`scan` read the lock refs** for the in-flight view (a generated view replaces `ls work/in-progress/`); eligibility/selection stay offline on `main`.

## Testing Decisions

- Race tests (the heart): N writers for N DIFFERENT items all acquire with ZERO contention failures; two writers for the SAME item → exactly one wins, the loser is definitively `lost`; advance + claim on ONE item → the second loses the same lock (atomic exclusion). Extend the existing claim/CAS race tests to the per-item-ref substrate and high fan-out.
- Branch-inheritance: a work branch cut from `main` carries NO transient status; a continue/rebase is a PLAIN rebase with no drop step and no rename/rename ledger conflict (the `drop-bookkeeping-rebase` tests are removed with the module).
- Crash-safety: complete crashes between the `main` durable move and the lock release → recovery converges (the `main` record wins, the stale lock is cleared); `done`+`stuck` co-existence is handled.
- Lock-ref hygiene: deletion = "all locks released," work recoverable on the `work/<slug>` branches; absent ref = no locks; a runner whose own lock vanished aborts (does not clean-release).
- Provider-agnostic: all of the above on a `--bare file://` arbiter (the house pattern), no network.
- Acceptance gate: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Out of Scope

- The "Set 1" alternative (keep status on `main`, fix only the CAS via rebase-until-real + fold the advancing marker into the branch-carries drop-set). It is the fallback IF working-tree visibility of transient status is later deemed mandatory; recorded in the idea file, not built here. This PRD commits to the Set-2 / per-item-ref substrate.
- The staging/pool POSITION gate + the trust/placement model + the `humanOnly` de-overloading, owned by the SIBLING PRD `staging-pool-position-gate-and-trust-model.md`. They compose (this PRD's "pool" is that PRD's `todo/`/`prd-ready/`), but are orthogonal: this PRD is the lock substrate, that one is the eligibility gate.
- Moving the durable `→done`/`→prd-sliced` moves off `main` (rejected: they are the referenceable records and their `main` atomicity with artifacts is the point).
- Changing `blockedBy`/`sliceAfter` semantics (they resolve against `done/`/`prd-sliced/` on `main`, unchanged).

## Further Notes

- Relationship to existing PRDs: this SUPERSEDES the `branch-carries-code-not-ledger-status-main-owns-status` PRD's mechanism (its drop-rebase removal + on-branch-move removal are subsumed by "no transient status on `main` at all") and RETIRES the decided co-located `<slug>.lock.md` relocation (taxonomy PRD US #10–14) as a concurrency fix, the lock is no longer a `main`-tree file. Record those dispositions when slicing.
- This is a load-bearing concurrency primitive: a wrong move corrupts the claim/lock invariants the whole runner depends on. `humanOnly: true` is set because the SLICING needs human judgement on sequencing (C2-for-promotions decision, the drop-rebase removal, the crash-recovery ordering, the migration from five folders to the lock-ref). Individual slices may be agent-buildable once cut.
- An ADR already records the durable why (`ledger-status-on-per-item-lock-refs`); slices should reference it rather than re-argue it.
