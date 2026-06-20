---
title: release-lock (and the reaper) cannot NAME a pre-vocabulary-cutover lock entry (slice-<slug> / prd-<slug>) because the CLI maps task:<slug> to task-<slug> — such orphans are un-releasable through the verb, needing a raw ref-delete
type: observation
status: spotted
spotted: 2026-06-20
slug: release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries
needsAnswers: true
---

## What was seen

An orphaned lock `refs/agent-runner/lock/slice-claim-cas-spinner` (a pre-cutover entry
using the retired `slice-` prefix) could not be cleared by the prescribed recovery verb:

```
$ agent-runner release-lock task:claim-cas-spinner
No lock to release for 'task-claim-cas-spinner' (refs/agent-runner/lock/task-claim-cas-spinner
is already absent on origin — "all locks released", recoverable).
```

`release-lock task:claim-cas-spinner` resolves the item to entry `task-claim-cas-spinner`
and finds it absent (no-op exit 0), while the ACTUAL orphan is `slice-claim-cas-spinner`.
There is no item-form that produces a `slice-`-prefixed entry anymore (the `slice:`
namespace was retired in the vocabulary cutover), so the lock is UN-NAMEABLE through
`release-lock`. It had to be removed by a raw
`git push origin --delete refs/agent-runner/lock/slice-claim-cas-spinner`.

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
- A one-time MIGRATION: rename any `refs/agent-runner/lock/slice-<slug>` ->
  `refs/agent-runner/lock/task-<slug>` and `prd-<slug>` -> `brief-<slug>` on the arbiter
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

- `packages/agent-runner/src/cli.ts` \u2014 `release-lock <item>` (the `task:`/`brief:`/`obs:`
  -> entry mapping) and the `gc --ledger --reap-stale-locks` block.
- `packages/agent-runner/src/item-lock.ts` \u2014 `lockEntryFor` / `itemLockRef` (the
  item-form -> entry derivation).
- `packages/agent-runner/src/slug-namespace.ts` \u2014 the post-cutover namespace resolver.
- The incident: orphaned `slice-claim-cas-spinner` lock (held 2026-06-19, across the
  cutover), cleared by raw ref-delete 2026-06-20.
- Sibling: `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever` (why the reaper
  did not clear it either).
