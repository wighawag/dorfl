---
title: review-gate non-blocking nits for 'advancing-lock-borrow' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advancing-lock-borrow
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advancing-lock-borrow' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: release deliberately OMITS the slicing lock's `stale`/exit-4 outcome — advancing release has exit codes 0/1/2/3 only, vs slicing's 0/1/2/3/4. The slice asked to mirror slicing's 'acquire/release shape and exit codes'. Is dropping exit-4 acceptable?
  (The agent documented the rationale: the advancing borrow does NOT hold the item's content (the item never moves), so there is no held-body that can go stale under the lock — the slicing lock's content-identity stale check + `lockedBlob` snapshot machinery has no analogue here. This is a correct and well-reasoned divergence, not an oversight: a concurrent edit to the locked item is the future apply rung's concern, not the lock's. The borrow's only job is mutual exclusion. Sound, but it is a deliberate departure from the literal 'same exit codes' criterion, so worth a human nod.)
- Ratify: acquire/release detach HEAD (`checkout --detach <arbiter>/main`) before `branch -D <lockBranch>`, which the mirrored `slicing-lock.ts` acquire does NOT do. Is this divergence intended?
  (The agent's comment explains it: 'DETACH first so the throwaway branch can always be deleted across retries (HEAD may still be ON it).' This is a retry-safety improvement over the slicing lock (where a second acquire attempt could fail to delete a branch HEAD still points at). It is strictly safer and harmless; flagging only because it is an unspecified deviation from the code it was told to mirror — arguably the slicing lock should adopt the same guard, but that is out of scope here.)
- Ratify: `createItemThroughCas` publishes under `kind: 'advancing'` rather than introducing a new transition kind (e.g. 'create'), even though creation is NOT a lock/borrow (the doc itself notes 'it is NOT a lock'). Is overloading the `advancing` kind for the create CAS acceptable?
  (The seam strategy is kind-agnostic, so the kind is only a self-documenting label + (here) implicitly the branch-name convention. Reusing `advancing` keeps the union small and is harmless mechanically. The mild incoherence is purely cosmetic (a non-lock operation tagged with a lock kind in commit/seam plumbing). Cheap to rename later (`create/<path>` branch is already distinct); flagging for the human to decide whether the kind label should reflect 'create' for clarity, or whether a single `advancing` kind covering the whole advance phase is the intended grouping.)
- Ratify the new user-visible artifacts this slice introduces without the slice spelling them out: (a) the presence-marker body format (`--- entry / by ---` frontmatter + advisory prose), and (b) the new branch namespaces `advancing-release/<entry>` and `create/<slugified-path>`.
  (The marker body is advisory ('the lock IS the file') and includes a helpful note that a leftover marker means a tick died mid-borrow — reasonable and self-documenting. The branch names extend the existing `slicing-release/<slug>` convention coherently. None collides with an existing ref. These are the kind of in-scope defaults a human should see recorded; all look correct and easily reversible.)
