---
title: review-gate non-blocking nits for 'lock-entry-state-machine-and-invariants' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: lock-entry-state-machine-and-invariants
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'lock-entry-state-machine-and-invariants' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Should the three new public functions (markStuckItemLock, resumeItemLock, requeueItemLock) and their types (TransitionOutcome, TransitionResult, MarkStuckOptions, ResumeOptions) be re-exported from packages/agent-runner/src/index.ts, matching the sibling lock primitives?
  (index.ts re-exports acquireItemLock/releaseItemLock/readItemLock/listItemLocks/LockEntry/AcquireResult/etc., but the new state-machine symbols are absent. Tests pass because they import from '../src/item-lock.js' directly, and no in-src caller imports the lock module yet, so this does not block the dependent slices. But it leaves the package's external API surface inconsistent with the established pattern - a human reviewer would expect the new transitions on the public surface.)
- Ratify the unspecified-but-reasonable outcome vocabulary the agent introduced: TransitionOutcome = transitioned | not-held | wrong-state | lost | error. The slice said only 'definitive winner/loser outcome (no retry loop)'; the agent designed the specific outcome set, including the new 'wrong-state' and 'not-held' refusals.
  (These are new error/refusal surfaces (an in-scope decision the slice did not specify verbatim). They map sensibly onto the state machine's preconditions (absent => not-held; held-but-wrong-state => wrong-state; race => lost), and the design trail uses 'exit-2 lost' language. No '## Decisions' block was recorded in the PR, so this is surfaced here for ratification. It looks correct; flagging only because it is a load-bearing public contract that dependent slices (claim/slice/advance/needs-attention) will branch on.)
- Ratify the cross-transition split the agent chose: requeue is GUARDED to fire only from 'stuck' (an active entry gets wrong-state with the message 'use release to abort an active hold'), while release aborts an active hold. The design trail lists requeue as [stuck]->(absent) and release as [active]->(absent), but does not explicitly say requeue must REFUSE an active entry.
  (The agent decided requeue rejects active rather than being a general remove-the-entry verb, making release the only path to abort an active hold. This is a defensible reading of the trail (it keeps the two verbs semantically distinct) and is tested, but it is a behavioural choice affecting how the future release-lock verb and the needs-attention/requeue callers must route - worth an explicit ratify since it was not spelled out and was not recorded in a Decisions block.)
- Ratify resume's optional holder reassignment: resumeItemLock accepts an optional `holder` and, when provided, rewrites the entry's holder on the way back to active (defaulting to the existing holder otherwise). Was a holder handoff on resume intended at this layer?
  (The slice/trail describe resume as [stuck]->[active] keeping the same action; the trail mentions 'keep the same action/holder or reassign', so reassignment is anticipated, but the exact API (an optional holder param that silently overwrites) is an agent-made interface decision a human picking up a stuck item via a future continue/resume verb will depend on. Low risk, easily reversible; surfaced because no Decisions block recorded it.)
- The PR description carries no '## Decisions' block at all, despite the slice prompt's explicit instruction to 'Record non-obvious in-scope decisions per the slice template'. Should the human add one (or accept the three decisions enumerated in the findings above) before this lands?
  (Findings 2-4 are exactly the kind of non-obvious in-scope choices (new refusal vocabulary, the requeue/release split, resume holder handoff) the template's Decisions block exists to capture for ratification. The build is green and the choices look correct, so this is not a block - but the missing record means a future reader cannot tell decided-and-ratified from incidental.)
