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
> `work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md` and the spec
> `work/specs/ready/ledger-status-per-item-lock-refs.md`. This ADR pins the load-bearing WHY so it is not
> re-litigated; the spec owns the HOW.

## Decision

The git ledger is split by what each kind of state actually is:

- **`main` holds CONTENT + all DURABLE RESTING records.** The readable `work/` content tree
  (tasks/todo, specs/ready, observations, findings, ideas) stays checked out on `main`, and the
  ONLY moves ever made on `main` are the durable resting transitions: `todo → done`,
  `specs/ready → specs/tasked`, and `todo → dropped` (the generic "won't-proceed" terminal that
  GENERALISES the previous `out-of-scope/`; the specific REASON — superseded /
  out-of-scope / duplicate / abandoned — lives in the item body as `reason:`). These are
  exactly the dependency-resolving / permanent records (`blockedBy → done/`,
  `taskedAfter → specs/tasked/`, the durable "won't-proceed").
- **Transient STATUS + LOCKS live on PER-ITEM lock refs**, NOT in main's tree. `in-progress`,
  `needs-attention`, `tasking`, and `advancing` collapse into ONE lock per item, keyed by item
  identity, on a hidden `refs/dorfl/lock/<entry>` ref (or a single `refs/dorfl/locks`
  ref namespace). The lock's existence/content IS the transient state; a two-axis entry records
  `action: implement|task|advance` × `state: active|stuck` (+ reason). `in-progress` = lock held
  active for implement; `needs-attention` = lock held stuck.

This is deliberately available ONLY because human working-tree visibility of transient status is
DROPPED as a requirement: humans use `dorfl status`/`scan` (a generated view that reads the
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
   tree off `main` (rejected: it strips tasks/specs/observations from a normal `git clone`), content
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
  resting pools tasks/todo) for tasks, and (`specs/proposed`, `specs/ready`, `specs/tasked`) for specs. The
  transient three (`in-progress`, `needs-attention`, `tasking`) become lock-ref state.
- A NEW cross-substrate reconciliation appears for the durable promotions: complete is "hold lock →
  land done-move on `main` → release lock"; a crash between the main-move and the release leaves a
  done item with a stale lock, recovery treats the `main` durable record as authoritative and clears
  the stale lock. `done` + a stuck lock can legitimately co-exist.
- `status`/`scan` become (partly) network-bound: the operational "what's in flight" view fetches the
  lock refs; eligibility/selection stay offline on `main`.
- The lock ref is a HIDDEN `refs/dorfl/*` ref (not a branch): invisible in the GitHub UI and
  to a default clone. Accidental deletion = "all locks released", recoverable (work is on the
  `work/<slug>` branches + `main`), blast radius far smaller than a `--force` to `main`.
- Recovery generalises the landed advancing-lock crash-safety: `release-lock <item>` + a stuck-lock
  report in `gc --ledger`; no liveness heartbeat, no auto-sweep (a human asserts a lock is dead).
- The lock refs are SELF-CLEANING and do not accumulate storage: release DELETES the ref (not just
  empties it) and each lock-entry commit is a tiny PARENTLESS throwaway, so on release the object is
  unreachable and reclaimed by normal git gc (bare arbiter) or the host's gc (GitHub). Churn is one
  tiny object per claim/task/advance, comparable to the existing `work/<slug>` branch create/delete;
  the only lingering case is a crash-orphaned lock (covered by `release-lock`/`gc --ledger`).

## Addendum 2026-07-10 — the `stuck-terminal` orphan class is auto-reapable (task `reaper-reap-terminal-stuck-lock-orphans`)

The original decision above admits that `done` + `stuck` can legitimately CO-EXIST during a
rebase-conflict bounce of a just-completed item (US #10) and lists the "crash-orphaned lock" as the
only lingering-storage case, covered by `release-lock` + the `gc --ledger` stuck-lock report.

In practice, once an item bounces `stuck` and THEN reaches its terminal folder on `main` by any
subsequent path — a human finish, a re-drive, a manual fixup+merge — the `stuck` lock is left
BEHIND with no in-flight work to justify it (concrete incidents: `slice-claim-cas-spinner`
2026-06-19, cleared manually via `git push origin --delete refs/dorfl/lock/…` in PR #140;
re-confirmed 2026-06-28 on a `task-apply-rung-merge-disposition`-shaped orphan). Under the pre-2026-
07-10 rule the auto-reaper (`gc --ledger --reap-stale-locks`) reaped ONLY the `cleared-stale` class
(terminal + `active`) and REFUSED to touch the `stuck` axis, so this orphan class survived every
sweep. That contradicts this ADR's own "the `main` durable record is authoritative over a stale
lock" recovery rule: a terminal-on-`main` item's held lock has no in-flight work behind it, whether
its state axis is `active` (stranded between the durable move and the release) or `stuck` (the same
crash-orphan, one bounce later).

### Contract loosening

The `stuck` axis is now SPLIT by the `main` durable record:

- `stuck` + item TERMINAL on `main` (a task at `tasks/done` / `tasks/cancelled`, a spec at
  `specs/tasked` / `specs/dropped` — per `terminalMainPaths`) — the CRASH-ORPHAN class — is
  REAPABLE by the auto-reaper. Classified as `cleared-stuck-terminal` (parallel to
  `cleared-stale`), cleared via the SAME shared leased delete `release-lock` / the recovery use,
  reported by the sweep as `reaped-stuck-terminal` so operators can see which orphan class was hit.
- `stuck` + item NON-TERMINAL on `main` — the GENUINE human-attention case (a real build failure a
  human must inspect) — REMAINS `kept-stuck` and is NEVER auto-reaped, even with the flag. This is
  the invariant the loosening MUST preserve.

The `kept-stuck` outcome name is thus re-scoped from "stuck + terminal (co-exist, human wins
attention)" to "stuck + non-terminal (genuine human attention)"; the previously-orphaning "stuck
+ terminal" case moves to its own `cleared-stuck-terminal` outcome.

### Why this is coherent with the original decision

- **Same authoritative-`main` rule.** The clear goes through the SAME `reconcileItemLockAgainstMain`
  + `leasedDeleteLockRef` path the existing `cleared-stale` reap uses; the `main` record's
  authority over an orphan lock is the ADR's own rule, now applied uniformly across both state-axis
  values.
- **Same trust model.** The reap is still OPT-IN behind `--reap-stale-locks` (a human authorising
  the sweep), still uses a LEASED delete (a concurrent change REJECTS as `lost`, never a blind
  `--force`), and still reads-then-re-classifies per item so a lock that turned stuck-non-terminal
  or in-flight between the report and the sweep is left alone.
- **The genuine human-attention case is preserved.** A `stuck` lock with NO terminal record on
  `main` is exactly the case the "no auto-sweep" clause is protecting. The sibling still refuses to
  touch it, exactly as before.

### Cross-refs

- Lock-side twin of the branch-side observation
  `gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28`: same orphan root shape
  (durable `main` record says terminal, but a narrower ancestry-only / active-only predicate can't
  see it). Fixing both aligns the reaper on the `main`-record-is-authoritative rule.
- Complementary human-recovery path: `release-lock <item>` for a current-vocabulary entry, and
  `release-lock --entry <literal>` for a lock whose entry name is NOT derivable from any current
  item-form (a pre-vocabulary-cutover `slice-<slug>` / `prd-<slug>` prefix, or a future rename) —
  the escape hatch shipped by task
  `release-lock-entry-escape-hatch-and-literal-entry-reporting` (from sibling observation
  `release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries`). `--entry` bypasses the
  namespace mapping and targets `refs/dorfl/lock/<literal>` directly via the SAME leased delete, so
  the raw `git push origin --delete refs/dorfl/lock/…` plumbing is no longer required; `gc --ledger`
  surfaces the literal entry name + the exact `--entry` invocation for such an orphan. This addendum
  closes the AUTO-recovery gap; the escape hatch remains the human path until an eventual one-time
  migration renames the pre-cutover entries.
- Distinct from the reaper `no-lock` mislabel (`reaper-no-lock-outcome-benign-not-lost`, now a
  task) — same reaper surface, different classification bug; NOT conflated here.

## Addendum 2026-07-14 — the `stuck` LOCK STATE is retired (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`)

The two-axis lock-entry state machine originally recorded above — `action: implement|task|advance` ×
**`state: active | stuck`** (+ reason iff stuck), with `needs-attention` == `state: stuck` — has been
COLLAPSED to a SINGLE state. Per spec `surface-stuck-as-questions-and-retire-stuck-lock-state`
(task `retire-stuck-lock-state`, LANDED), `LockState` is now `'active'` only. A bounced / needs-
attention item no longer parks on the lock; it is surfaced on `main` as `needsAnswers: true` +
a `stuck`-kind question sidecar (drained by the existing apply rung) and the lock is RELEASED.

### What changes

- The lock is now the **in-flight ACTIVE HOLD only** — real CAS mutual-exclusion for a running
  claim / build / task / advance. It is always released at the end of a leg (success OR bounce);
  no lock ever outlives its leg except a genuine crash-orphan.
- "Resting, needs a human" moves off the lock and onto `main`: `needsAnswers: true` on the item body
  + a sidecar (`sidecar.ts`, `kind: 'stuck'`) under `work/questions/<type>-<slug>.md`, atomically.
  Human-visible in a normal `ls` / `git clone`, drained by the existing surface→apply loop.
- The `reason iff stuck` invariant, the `mark-stuck` transition, and the `wrong-state` verdict are
  RETIRED with the state (`item-lock.ts`). `done` + `stuck` co-existence (the original US #10 case)
  no longer arises — a just-completed item that bounces on a rebase-conflict surfaces a sidecar
  and releases; the lock is not left `stuck`.
- `mark-stuck` remains as a no-op COMPATIBILITY SHIM at the lock module boundary (returns a
  wrong-state / already-released outcome) so callers not yet migrated do not throw; the shim's
  message points at the new model.
- The 2026-07-10 addendum's `cleared-stuck-terminal` / `kept-stuck` reaper split is IMPLICITLY
  MOOT going forward: with no new `stuck` locks minted, the auto-reaper's `stuck`-axis branches
  only trigger on pre-existing entries, and those are drained one-shot by the migration task
  `migrate-existing-stuck-locks-one-shot` (`stuck → surface-on-main + release`). The addendum is
  KEPT for the historical record; it is not the current mint path.

### Why (the pointer, not the re-argument)

Two mechanisms for "an item is parked" (the on-`main` `needsAnswers` sidecar for human ANSWERS,
and the hidden `state: stuck` lock for BOUNCED items) rotted `stuck`-parked items: the hidden ref
was drained by nothing, and `advance-drivers.ts` subtracted every held slug from every pool, so a
stuck item was invisible to the loop forever unless a human ran `requeue` by hand (verified live on
lifecycle run `29206312575`). Collapsing to ONE parked-item mechanism (`needsAnswers` + sidecar on
`main`) drains bounced items through the existing question loop and additionally makes a healthy
refusal (stale premise / empty diff / surfaced collision) VISIBLY DISTINCT from a real gate
failure. Full reasoning + the six resolved decisions live in the spec
`surface-stuck-as-questions-and-retire-stuck-lock-state`.

### Coherence with the original decision

- **The lock PRIMITIVE is unchanged.** Per-item refs, create-only / leased CAS,
  self-arbitrating, no retry budget, `main`-authoritative over a stale lock — all preserved. Only
  the STATE AXIS is retired; the ACTION axis (`implement | task | advance`) still discriminates
  what the hold is FOR, and cross-action exclusion is still atomic (defect #3 above).
- **`main` is still authoritative** over a crash-orphaned `active` lock — now the ONLY orphan
  class the reaper needs to handle.
- **Sequencing of the durable move + release is unchanged.** "Hold lock → land durable `main`
  move → release" (US #9); a bounce now uses the SAME ordering to surface the sidecar-on-`main`
  FIRST, release SECOND (`main`-authoritative on recovery), reusing the `runTreelessLedgerMove`
  CAS loop for the tree-less path.

### Pinning the two `stuck` meanings (do not re-muddle)

After this retirement the word `stuck` still appears in the codebase, but now with ONE meaning,
not two:

- `stuck` as a LOCK STATE — **retired**. `LockState` is `'active'` only. Any live doc or code
  reading `state: stuck` is historical.
- `stuck` as a **`SidecarKind`** (`sidecar.ts`, `SidecarKind = 'merge' | 'stuck' | 'triage' |
  'spec'`) — **kept**. It is the dispatch kind the surfaced-bounce sidecar is filed under so the
  apply rung can route it. This is a DIFFERENT axis (the sidecar's dispatch label) from the
  retired lock state; the shared English word is a documented distinction, NOT a re-mint of the
  old lock state.

### Cross-refs

- Spec: `work/specs/tasked/surface-stuck-as-questions-and-retire-stuck-lock-state.md` (the six
  resolved decisions, the atomicity/ordering rule, the migration + reconciliation tasks).
- Sibling reconciliation task: `reconcile-ledger-lock-spec-adr-stuck-retirement` (this addendum
  is its ADR deliverable; the sibling spec `ledger-status-per-item-lock-refs` + `CONTEXT.md`
  glossary are reconciled in the same pass).
- Amend-vs-supersede: **AMENDED in place** rather than superseded, because the core decision
  (transient status on per-item lock refs; `main` holds content + durable resting records) is
  UNCHANGED — only the state-axis sub-detail collapses. This follows the same pattern the
  2026-07-10 addendum used for the reaper's `stuck-terminal` orphan loosening and keeps the
  ledger-lock decision trail contiguous in one file, per `ADR-FORMAT.md` ("Status frontmatter
  useful when decisions are revisited" — the ADR stays `proposed`; the retirement is a scoped
  amend, not a new decision superseding the substrate).
