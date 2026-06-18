---
title: The durable main promotions still share the main ref and may falsely-contend (C2 / rebase-until-real candidate, deferred out of the lock substrate)
slug: durable-main-promotions-still-share-main-ref-may-falsely-contend-c2-candidate
type: observation
status: open
---

> Spotted 2026-06-18 while slicing the lock PRD `ledger-status-per-item-lock-refs`
> with the maintainer. Recorded so the deferred-but-better fix is not lost.

## What was noticed

The per-item lock substrate (PRD `ledger-status-per-item-lock-refs`) makes the LOCK
itself retry-free: per-item refs never falsely contend, so acquire/release need no
retry budget. That correctly leaves the THREE durable `main` promotions
(`backlog → done`, `prd → prd-sliced`, `backlog → dropped`) on `main`, where they
still write the SHARED `main` ref via the existing whole-ref-leased CAS.

Because two DIFFERENT items' promotions share that one `main` ref, they can STILL
falsely-contend under parallelism (the same class as the original exit-3 defect, but
at much lower volume now that claim/slice/advance no longer touch `main`). The lock
holds the ITEM, so two promotions of the SAME item cannot race; only DIFFERENT items'
promotions share the ref.

## Why it was deferred (the agreed scope call)

For the LOCK SUBSTRATE, leaving the promotions on today's bounded retry is correct
(option (b) in the slicing conversation): contention-fixing the shared `main` ref is
not the lock's job, and the lock already removes the bulk of `main`'s write traffic
(claim + all intermediates leave `main`). So none of the nine lock slices touch it.

But the maintainer and I agreed the BETTER end state is option (a): apply
**rebase-until-real-conflict (C2)** to those durable promotions, on a `rejected`
push, replay the prepared move onto the new `main` and only give up on a GENUINE
same-path conflict, so two different items' promotions stop counting as a
false-conflict budget hit. C2 is analysed in the design trail
`work/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md`
(the "### C2" section + its SCOPE box: it applies to same-path acquire/create paths,
NOT the slug-relocation family, which must keep its source-folder precondition recheck).

## Suggested disposition

A small follow-on slice (or its own tiny PRD) after the lock substrate lands: add C2
rebase-until-real to the durable `main` promotions, reusing the existing claimability
re-check as the "genuine same-path conflict" terminator (add no new conflict-detection
path), with modest jitter on the refetch to desynchronise the herd. Triage this when
the lock work is in `done/`. Not urgent: it is a magnitude-and-volume improvement on a
now-much-smaller `main` writer set, not a correctness gap.
