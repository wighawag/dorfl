---
item: observation:advancing-lock-orthogonal-not-a-move-revisit
type: observation
slug: advancing-lock-orthogonal-not-a-move-revisit
allAnswered: false
---

## Q1
id: q1
question: |
  Disposition: keep this observation open (gather more evidence), promote it to a PRD/slice that changes the advancing-lock shape, or close it as a documentation-only fix? The observation lays out three options: (A) keep the orthogonal-marker shape and just document the 'driver-vs-driver only; claim CAS is the human-vs-driver backstop' semantics more loudly in CONTEXT.md + the module docstring; (B) unify — make the advancing lock a lifecycle move for claimable items (slices) while keeping the marker form for un-claimable items (PRD/observation), restoring 'locked ⇒ un-takeable' for slices at the cost of two shapes; (C) subsume — narrow the advancing lock to ONLY the surface/triage/apply rungs on un-claimable items, since building already goes through the claim move and the borrow around build may be redundant. The author leans 'investigate C first', but explicitly flags this as a human design call, not auto-actable.
context: |
  From the observation: the `advancing` lock is a presence-marker file `work/advancing/<type>-<slug>.md` (CAS-created/deleted), NOT a folder move; `claim-cas.ts`/`start.ts` do not consult it, so a bare human `claim <slug>` is serialised against an in-flight advance tick by the claim CAS alone, not by the advancing lock. The lock is a driver-vs-driver mutex only (a 'no-op formality for a solo human' per its docstring). The doubt: 'locked but still in backlog' breaks the mental model set by claim/slicing locks, and a leaked marker is extra ledger surface (observed folding into PR squashes via sibling-ledger reconcile). Provenance: grilled against `src/advancing-lock.ts`, `src/claim-cas.ts`, `src/start.ts` this session; the user asked it be recorded but is 'not yet a fan'.
default: |
  keep — investigate Option C (does the advancing borrow do anything around the build rung that the claim does not already do?) before committing to a reshape; if C lands cleanly it folds the surprise away without introducing B's two-shape cost, and A becomes the fallback if C turns out to be load-bearing.
answered: false
answer: |
disposition: keep
