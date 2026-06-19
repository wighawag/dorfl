---
title: The protocol docs (WORK-CONTRACT / CLAIM-PROTOCOL, both copies) drifted from the landed lock + position-gate reality
date: 2026-06-19
status: open
relatesTo: [ledger-status-per-item-lock-refs, staging-pool-position-gate-and-trust-model, folder-taxonomy-reorg-and-rename]
---

## What was noticed

While preparing to revise `work/prd/folder-taxonomy-reorg-and-rename.md`, I read the
SOURCE-OF-TRUTH protocol docs (`skills/setup/protocol/WORK-CONTRACT.md`, mirrored
to `work/protocol/`) and found they still describe the PRE-lock-cutover world. They
drifted because the `ledger-status-per-item-lock-refs` cut-over (12 slices, all
done) and the `staging-pool-position-gate-and-trust-model` STEP-A both landed in
CODE, but the protocol prose was not updated in lockstep.

Concrete stale claims in WORK-CONTRACT.md (and the byte-identical `work/protocol/`
copy):

- **`slicing/` as a folder lock.** Section "The PRD lifecycle: `prd/ → slicing/ →
  prd-sliced/`" + the `slicing/`-absence-from-`prd/` notes describe slicing as a
  `git mv prd→slicing` folder lock raced via CAS. REALITY: slicing is now an
  `action: slice` hold on the per-item lock ref; the `slicing/` folder is retired
  (slice `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`).
- **`in-progress/` as the claimed-slice home.** Claim no longer moves the body
  (slice 9a `cutover-claim-body-stays-and-complete-sources-from-backlog`); a claimed
  item stays in the pool and "claimed" is the lock being held.
- **`needs-attention/` as a folder move.** Now the lock `state: stuck` (slice 9b);
  the reason/questions ride the lock entry, no folder move, no `main` write.
- **The `drop-bookkeeping-rebase` trailer mechanism** (the long para about
  `Agent-Runner-Bookkeeping` trailers + both rebase sites dropping them). DELETED in
  slice 9d; a continue/rebase is now a plain rebase.
- **The staging/pool split is only half-reflected.** Some sections DO mention
  `pre-backlog/` (pool = `backlog/`), but the "status = the folder" lifecycle list
  + the PRD-lifecycle section still read as the old flat five-folder state machine.

## Why it matters / disposition

The protocol docs are the contract `setup` propagates into every adopted repo, and
the vocabulary the `folder-taxonomy-reorg-and-rename` PRD builds on. Revising that
PRD in isolation while the protocol prose underneath is stale would just move the
drift around.

`folder-taxonomy-reorg-and-rename` US #17 ALREADY scopes "update WORK-CONTRACT.md,
CLAIM-PROTOCOL.md, ADR-FORMAT.md, skills and ADR path refs to the new vocabulary
and layout in the same effort." So the natural home for fixing this protocol-doc
drift is THAT PRD's reconciliation + slices (it must update BOTH protocol copies
and keep `diff -r skills/setup/protocol work/protocol` clean). Recommend: fold the
"reconcile the protocol prose to the post-lock/post-position-gate reality" work into
the taxonomy PRD revision as an explicit, EARLY concern (not only the rename, but
first the truth-up), OR — if the rename is deferred — a small standalone
"protocol-docs-reconcile" PRD/slice to truth-up the prose now, independent of the
rename. A human should decide which (the rename is `humanOnly` and judgement-heavy;
a pure truth-up is smaller and could go first).
