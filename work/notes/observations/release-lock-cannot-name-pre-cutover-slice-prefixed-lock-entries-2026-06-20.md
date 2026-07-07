---
title: release-lock (and the reaper) cannot NAME a pre-vocabulary-cutover lock entry (slice-<slug> / prd-<slug>) because the CLI maps task:<slug> to task-<slug> — such orphans are un-releasable through the verb, needing a raw ref-delete
type: observation
status: spotted
spotted: 2026-06-20
slug: release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries
needsAnswers: true
---

## What was seen

An orphaned lock `refs/dorfl/lock/slice-claim-cas-spinner` (a pre-cutover entry
using the retired `slice-` prefix) could not be cleared by the prescribed recovery verb:

```
$ dorfl release-lock task:claim-cas-spinner
No lock to release for 'task-claim-cas-spinner' (refs/dorfl/lock/task-claim-cas-spinner
is already absent on origin — "all locks released", recoverable).
```

`release-lock task:claim-cas-spinner` resolves the item to entry `task-claim-cas-spinner`
and finds it absent (no-op exit 0), while the ACTUAL orphan is `slice-claim-cas-spinner`.
There is no item-form that produces a `slice-`-prefixed entry anymore (the `slice:`
namespace was retired in the vocabulary cutover), so the lock is UN-NAMEABLE through
`release-lock`. It had to be removed by a raw
`git push origin --delete refs/dorfl/lock/slice-claim-cas-spinner`.

## Root cause

`release-lock <item>` (and the reaper, and `gc --ledger`'s report) key off the CURRENT
namespace mapping: `task:<slug>` -> `task-<slug>`, `brief:<slug>` -> `brief-<slug>`,
`obs:<slug>` -> `observation-<slug>`. Locks minted BEFORE the slice->task / prd->brief
vocabulary cutover carry the OLD entry names (`slice-<slug>`, `prd-<slug>`). The cutover
renamed the item NAMESPACES and the CLI's entry-derivation, but did NOT migrate or make
addressable the lock REFS that were already on arbiters at cutover time. So any lock that
was held across the cutover is orphaned beyond the reach of the recovery verb that exists
precisely to clear orphans.

## Why it matters

The whole trust model is "a human clears an orphaned lock by NAMING it via release-lock;
the tool never guesses liveness." A pre-cutover orphan defeats that: the human cannot
name it (no item-form maps to the old entry), and the reaper's report/sweep also keys by
the new mapping. The only recourse is raw git plumbing against a hidden ref namespace \u2014
exactly the manual git the protocol tells operators not to do. This affects every
arbiter that had a `slice-`/`prd-` lock held when the cutover landed.

## Suggested fix shape (decide when slicing)

One or more of:
- A one-time MIGRATION: rename any `refs/dorfl/lock/slice-<slug>` ->
  `refs/dorfl/lock/task-<slug>` and `prd-<slug>` -> `brief-<slug>` on the arbiter
  (and mirrors), so old locks become addressable by the current verbs. Could be folded
  into `gc --ledger` or a dedicated one-shot.
- A raw-entry ESCAPE HATCH on `release-lock` (e.g. `release-lock --entry slice-foo`) so a
  human can name a lock by its literal entry name regardless of the current namespace
  mapping \u2014 the un-guessable-liveness trust model is preserved (the human still asserts
  it), it just stops assuming the entry name is derivable from a current item-form.
- At minimum: make `gc --ledger`'s REPORT list the literal entry names it finds (it does
  show `slice-claim-cas-spinner` in the reap output), and document that a pre-cutover
  entry is cleared via a raw ref-delete until a migration exists.

## Refs

- `packages/dorfl/src/cli.ts` \u2014 `release-lock <item>` (the `task:`/`brief:`/`obs:`
  -> entry mapping) and the `gc --ledger --reap-stale-locks` block.
- `packages/dorfl/src/item-lock.ts` \u2014 `lockEntryFor` / `itemLockRef` (the
  item-form -> entry derivation).
- `packages/dorfl/src/slug-namespace.ts` \u2014 the post-cutover namespace resolver.
- The incident: orphaned `slice-claim-cas-spinner` lock (held 2026-06-19, across the
  cutover), cleared by raw ref-delete 2026-06-20.
- Sibling: `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever` (why the reaper
  did not clear it either).

## Applied answers 2026-06-22

### q1: Triage this observation: does the un-nameable pre-cutover lock entry (release-lock + reaper both key off the current `task-`/`brief-`/`observation-` mapping and so cannot address residual `slice-<slug>` / `prd-<slug>` lock refs left over from the vocabulary cutover) become a slice, an ADR, get kept as a watch-item, dropped, or flagged needs-attention? The note proposes three non-exclusive fix shapes — pick whichever the disposition implies: (a) one-time MIGRATION renaming `refs/dorfl/lock/slice-<slug>` -> `task-<slug>` and `prd-<slug>` -> `brief-<slug>` on arbiter + mirrors (possibly folded into `gc --ledger`); (b) raw-entry ESCAPE HATCH on `release-lock` (e.g. `release-lock --entry slice-foo`) so a human can name a literal entry regardless of current mapping — preserves the un-guessable-liveness trust model; (c) at minimum, make `gc --ledger`'s REPORT surface the literal entry names and DOCUMENT the raw ref-delete workaround until a migration exists.

promote-slice, shipping the escape-hatch (b) + report-literal-names (c) together; leave the migration (a) as a follow-up only if more pre-cutover orphans surface. Verified: `release-lock` resolves through the namespaced mapping (task/brief/observation only), so it cannot name a residual `slice-*`/`prd-*` lock entry, and there is no `--entry` escape hatch today; the only current recourse is raw `git push --delete` (the plumbing the protocol tells operators to avoid). (b) `release-lock --entry <literal>` deletes the literal ref via the same leased delete, preserving the human-asserts-liveness model; (c) print literal entry names in `gc --ledger` + document the workaround. Cross-ref the reaper orphan sidecar (same orphan, two angles). Disposition: promote-slice.
