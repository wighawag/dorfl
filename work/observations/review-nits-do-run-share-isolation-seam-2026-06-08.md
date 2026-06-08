---
title: review-gate non-blocking nits for 'do-run-share-isolation-seam' (Gate 2 approve)
date: 2026-06-08
status: open
slug: do-run-share-isolation-seam
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'do-run-share-isolation-seam' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- RATIFY: in-place `do` for an item already in-progress / done / absent now returns outcome `lost` (exit 2) instead of the prior `refused`/`usage-error` (exit 1). Is this exit-code/outcome change the intended contract for the autonomous in-place worker? It is NOT recorded in a `## Decisions` block.
  (OLD (commit 2392562 do.ts): `performDo` called `performStart` without `--resume`; an in-progress folder → `startFromInProgress` threw `StartRefusal` → outcome 'refused', exit 1; done/absent → 'usage-error', exit 1. NEW (src/do.ts ~line 507): `performClaim` is called directly; for any non-backlog item the CAS `attempt` returns `{kind:'lost'}` → outcome 'lost', exit 2. This contradicts the slice's acceptance criterion 'preserved byte-for-byte: ... refused (in-progress without --resume, ... done/absent)'. It is, however, consistent with the re-scoped autonomous claim-first framing and with `do --remote`/`run`. A pre-existing tolerant test (test/do.test.ts:202 `expect(['lost','refused']).toContain(result.outcome)`) absorbed it; the new test (test/do.test.ts:918) pins `lost`/exit-2.)
- RATIFY: the §10 continue-rebase-conflict surfacing for in-place `do` now uses the default `pushBranch:true` (it pushes `work/<slug>`), whereas the old in-place path (`performStart.routeContinueConflict`) used `pushBranch:false` (SURFACE-ONLY). Confirm pushing the aborted kept work branch here is intended.
  (src/do.ts ~line 544 calls `ledgerWrite.applyNeedsAttentionTransition({cwd: tree.dir, slug, reason, arbiter: tree.arbiterRemote, env, note})` with no `pushBranch`, so it defaults to true. This is SAFE because `inPlaceStrategy.prepare()` switches HEAD onto `work/<slug>` before the rebase `--abort` (continue-branch.ts), so HEAD IS on `work/<slug>` at the kept tip — matching run.ts/do --remote, NOT performStart's temp-branch case (start.ts `routeContinueConflict` explicitly used pushBranch:false because HEAD there was a throwaway temp branch off main). The pushed tip equals what is already on the arbiter (rebase aborted), so it is a no-op-equivalent re-push; test/do.test.ts ~line 905 verifies `arbiter/work/alpha` is still present and the agent never ran.)
