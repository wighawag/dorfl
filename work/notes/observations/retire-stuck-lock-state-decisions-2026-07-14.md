---
date: 2026-07-14
task: retire-stuck-lock-state
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
needsAnswers: true
---

# `retire-stuck-lock-state` — in-scope decisions worth surfacing

Recorded from the CONTRACT step of expand→migrate→contract. Not load-bearing
enough to STOP for; recorded here so a reviewer can ratify or reverse.

## D1. `LockState` collapses to a single-value union, not a removed field

Chose `type LockState = 'active'` (retained the `state` field, single admitted
value) instead of dropping the axis entirely. Rationale: the serialised lock
blob stays byte-shape-compatible with pre-cutover binaries (`state: active` in
the frontmatter), and downstream readers keep a stable render surface
(`entry.state === 'active'`). A legacy blob whose serialised `state:` is
anything other than `active` (e.g. a lingering `stuck` ref written by an older
binary) is COERCED to `'active'` on parse, so no reader ever sees a second
live state; the migration/recovery verbs clear the lingering ref via
`main`-authoritative reconciliation. Alternative considered: drop the field
entirely — rejected because it would break the serialised shape and force a
one-shot migration of every existing lock blob, which is out of scope for the
contract step.

## D2. Orphaned `reason` and `questions` fields on `LockEntry` are DELETED, not deprecated

The `reason` and `questions` fields only ever populated a `stuck` entry (per
the retired `reason iff stuck` invariant). With `stuck` gone the fields are
dead weight, and the surfaced bounce sidecar on `main` is now the sole home
for that prose (spec Solution paragraph 1). Chose to REMOVE them from the
`LockEntry` interface + the serialiser + the parser. A legacy blob's
`## Reason` / `## Questions` sections in the body are ignored on parse (no
error, no resurfacing). Alternative considered: keep the fields optional and
just never populate them — rejected because it would leave dead surface area
in the public type, inviting future callers to reintroduce the retired
concept.

## D3. `resumeItemLock` is REPURPOSED, not deleted, to converge crash-window orphans

`resumeItemLock` used to be the `stuck → active` amend. With `stuck` gone
that transition is impossible, but the ordered bounce (surface-FIRST /
release-SECOND) still leaves a crash-window orphan on the arbiter when the
release step never runs — an `active` lock over a surfaced-on-`main` item
(`needsAnswers:true` + sidecar). The verb is repurposed to handle exactly
that case (clear the ref via the shared leased delete, `main`-authoritative),
and returns `not-held` on the "healthy active hold, nothing to resume" path
(replacing the retired `wrong-state`). Alternative considered: delete the
verb entirely — rejected because the crash-window orphan is a real recovery
case the ADR names as a live invariant.

## D4. `requeueItemLock` drops its `wrong-state` guard

Pre-cutover, `requeue` was the guarded give-up from `stuck` only (returning
`wrong-state` on an `active` entry so an aborting in-flight caller went
through `release` instead). Post-cutover there is no `stuck` state to
distinguish, so `requeue` releases any held entry (the CAS-lease still
protects against concurrent same-item mutations). This is the correct
one-mechanism collapse: `release` and `requeue` become the two names for the
same "clear the lock ref" operation, differing only in the caller's intent.
Alternative considered: fold `requeue` into `release` — rejected because the
CLI verb is a stable user-facing name a sibling task
(`ledger-status-per-item-lock-refs` spec reconciliation) explicitly needs to
keep.

## D5. `markStuckItemLock` is retained as a compatibility SHIM (no-op)

Deleting the export would have broken ~17 test files (~30 call sites) plus
any downstream repo pinning the SDK export. Retained the function as a
documented no-op shim that returns `transitioned` on a held entry (leaving
the state at `active`) and `not-held` otherwise. This is the cheapest way to
keep the test surface compilable while making it structurally impossible for
any live path to produce a `stuck` state. Reviewers who prefer a hard break
can delete the shim in a follow-up (the tests using it are already
`.toBe('active')` post-migration, not `.toBe('stuck')`).

## D6. `ReconcileOutcome` and `ReapOutcome` collapse

The two `stuck`-flavoured verdicts (`kept-stuck`, `cleared-stuck-terminal`;
`reaped-stuck-terminal`) are removed. The `cleared-stale` verdict now covers
BOTH orphan classes it used to name separately: terminal-on-main + active
(stranded) AND non-terminal + surfaced-on-main + active (crash-window
orphan). The reap sweep still reports one verdict per class through the
entry list; only the top-level counters simplify. This is a public API
change that touches the JSON output of `gc --ledger [--reap-stale-locks]`;
downstream consumers keying off the retired verdict names will see them
disappear.

## D7. `startFromNeedsAttention` is preserved (as a legacy no-op) rather than deleted

The `needs-attention/` folder probe in `folderOnArbiterMain` stays (no live
path writes to it, but a legacy body might exist). The dispatch path was
simplified: it no longer reads the retired `stuck` reason/questions off the
lock, it no longer amends the lock (the shim `applyResolveNeedsAttentionTransition`
is a recorded no-op), and it just onboards onto the kept work branch. This
is the minimum-surgery path; a follow-up could delete both the probe and the
branch when the folder is confirmed dead in the wild.
