---
title: Transient ledger STATUS lives on per-item lock refs, not in main's tree
status: proposed
created: 2026-06-17
supersedes:
superseded_by:
---

# ADR: transient ledger STATUS lives on per-item lock refs; main holds content + durable resting records only

> **STATUS: proposed.** Records the decision and its why for a future build. Not yet accepted; the
> design trail and full edge-case analysis live in
> `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` and the prd
> `work/prds/ready/ledger-status-per-item-lock-refs.md`. This ADR pins the load-bearing WHY so it is not
> re-litigated; the prd owns the HOW.

## Decision

The git ledger is split by what each kind of state actually is:

- **`main` holds CONTENT + all DURABLE RESTING records.** The readable `work/` content tree
  (tasks/todo, prds/ready, observations, findings, ideas) stays checked out on `main`, and the
  ONLY moves ever made on `main` are the durable resting transitions: `todo → done`,
  `prds/ready → prds/tasked`, and `todo → dropped` (the generic "won't-proceed" terminal that
  GENERALISES the previous `out-of-scope/`; the specific REASON — superseded /
  out-of-scope / duplicate / abandoned — lives in the item body as `reason:`). These are
  exactly the dependency-resolving / permanent records (`blockedBy → done/`,
  `taskedAfter → prds/tasked/`, the durable "won't-proceed").
- **Transient STATUS + LOCKS live on PER-ITEM lock refs**, NOT in main's tree. `in-progress`,
  `needs-attention`, `tasking`, and `advancing` collapse into ONE lock per item, keyed by item
  identity, on a hidden `refs/agent-runner/lock/<entry>` ref (or a single `refs/agent-runner/locks`
  ref namespace). The lock's existence/content IS the transient state; a two-axis entry records
  `action: implement|task|advance` × `state: active|stuck` (+ reason). `in-progress` = lock held
  active for implement; `needs-attention` = lock held stuck.

This is deliberately available ONLY because human working-tree visibility of transient status is
DROPPED as a requirement: humans use `agent-runner status`/`scan` (a generated view that reads the
lock refs) rather than `ls work/in-progress/`. Content and durable records stay `ls`-able on `main`.

## Why

1. **It dissolves three verified defects at once.** (a) FALSE CONTENTION: the contended-`main`-CAS
   exit-3 failure under high CI parallelism is gone, lock writers no longer touch `main`, and
   per-item refs mean the only writer that can contend on item X's lock is another writer for X (a
   GENUINE conflict the loser should lose), so there is NO false contention and NO retry budget to
   exhaust. (b) BRANCH-INHERITANCE: a work branch cut from `main` inherits no transient status
   (there is none in main's tree), so the stale-marker / rename-conflict class and the
   `drop-bookkeeping-rebase` machinery become unnecessary. (c) CROSS-ACTION EXCLUSION: one lock per
   item makes advance/task/implement mutually exclusive BY CONSTRUCTION (atomic, not advisory), a
   second action on a held item loses the same CAS.
2. **Per-item refs make the lock retry-free.** This is the P-opt-1 mechanism the `claim-ledger-vs-
   protected-main` ADR recorded but rejected ("abandons file-visibility"). With visibility dropped
   that objection is void, and a create-only / leased per-item ref push is self-arbitrating: winner
   creates it, loser is rejected = definitively lost. No loop, no budget, no rebase-until-real for
   the lock. (The two durable `main` promotions still write the shared `main` ref, so they keep a
   retrying-CAS / serialized-promote, that is the only place retry remains.)
3. **It keeps content checked out and dependency resolution offline.** Unlike moving the whole `work/`
   tree off `main` (rejected: it strips tasks/prds/observations from a normal `git clone`), content
   and durable records stay on `main`, so `blockedBy`/`taskedAfter` resolve offline against `main`
   exactly as today, zero change to eligibility.
4. **It incidentally makes protected-`main` TRACTABLE** (the contradiction the `claim-ledger-vs-
   protected-main` ADR opened with): claim + all intermediate state leave `main`, so an agent can
   claim on a protected `main`. The durable promotions still reach `main` and, on a protected repo,
   route through the existing PR-merge path.

## Considered and rejected

- **Keep status on `main`, fix only the CAS (rebase-until-real-conflict + fold the advancing marker
  into the branch-carries drop-set).** Valid, and the right answer IF working-tree visibility of
  transient status is KEPT (the "Set 1" path). Rejected HERE only because visibility was dropped,
  which unlocks the strictly cleaner substrate split above. (If visibility is later deemed
  mandatory, that Set-1 path is the fallback; see the idea file.)
- **A single dedicated ledger ref holding a status TREE.** Rejected vs per-item refs: a tree on one
  ref still falsely-contends between different items (the whole-ref lease), reintroducing the retry
  budget. Per-item refs remove it.
- **Whole `work/` tree (content AND status) on the ledger ref, main = code only.** Rejected: it
  removes CONTENT from the checked-out repo (agents/humans would have to `git show` their own
  work-input). Content must stay on `main`.

## Consequences

- The five status folders on `main` reduce to durable records only (`done`, `dropped`, the
  resting pools tasks/todo) for tasks, and (`prds/proposed`, `prds/ready`, `prds/tasked`) for prds. The
  transient three (`in-progress`, `needs-attention`, `tasking`) become lock-ref state.
- A NEW cross-substrate reconciliation appears for the durable promotions: complete is "hold lock →
  land done-move on `main` → release lock"; a crash between the main-move and the release leaves a
  done item with a stale lock, recovery treats the `main` durable record as authoritative and clears
  the stale lock. `done` + a stuck lock can legitimately co-exist.
- `status`/`scan` become (partly) network-bound: the operational "what's in flight" view fetches the
  lock refs; eligibility/selection stay offline on `main`.
- The lock ref is a HIDDEN `refs/agent-runner/*` ref (not a branch): invisible in the GitHub UI and
  to a default clone. Accidental deletion = "all locks released", recoverable (work is on the
  `work/<slug>` branches + `main`), blast radius far smaller than a `--force` to `main`.
- Recovery generalises the landed advancing-lock crash-safety: `release-lock <item>` + a stuck-lock
  report in `gc --ledger`; no liveness heartbeat, no auto-sweep (a human asserts a lock is dead).
- The lock refs are SELF-CLEANING and do not accumulate storage: release DELETES the ref (not just
  empties it) and each lock-entry commit is a tiny PARENTLESS throwaway, so on release the object is
  unreachable and reclaimed by normal git gc (bare arbiter) or the host's gc (GitHub). Churn is one
  tiny object per claim/task/advance, comparable to the existing `work/<slug>` branch create/delete;
  the only lingering case is a crash-orphaned lock (covered by `release-lock`/`gc --ledger`).
