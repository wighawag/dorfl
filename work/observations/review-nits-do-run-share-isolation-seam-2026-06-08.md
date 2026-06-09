---
title: review-gate non-blocking nits for 'do-run-share-isolation-seam' (Gate 2 approve)
date: 2026-06-08
status: open
slug: do-run-share-isolation-seam
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'do-run-share-isolation-seam' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- RATIFY: in-place `do` for an item already in-progress / done / absent now returns outcome `lost` (exit 2) instead of the prior `refused`/`usage-error` (exit 1). Is this exit-code/outcome change the intended contract for the autonomous in-place worker? It is NOT recorded in a `## Decisions` block. (OLD (commit 2392562 do.ts): `performDo` called `performStart` without `--resume`; an in-progress folder → `startFromInProgress` threw `StartRefusal` → outcome 'refused', exit 1; done/absent → 'usage-error', exit 1. NEW (src/do.ts ~line 507): `performClaim` is called directly; for any non-backlog item the CAS `attempt` returns `{kind:'lost'}` → outcome 'lost', exit 2. This contradicts the slice's acceptance criterion 'preserved byte-for-byte: ... refused (in-progress without --resume, ... done/absent)'. It is, however, consistent with the re-scoped autonomous claim-first framing and with `do --remote`/`run`. A pre-existing tolerant test (test/do.test.ts:202 `expect(['lost','refused']).toContain(result.outcome)`) absorbed it; the new test (test/do.test.ts:918) pins `lost`/exit-2.)
- RATIFY: the §10 continue-rebase-conflict surfacing for in-place `do` now uses the default `pushBranch:true` (it pushes `work/<slug>`), whereas the old in-place path (`performStart.routeContinueConflict`) used `pushBranch:false` (SURFACE-ONLY). Confirm pushing the aborted kept work branch here is intended. (src/do.ts ~line 544 calls `ledgerWrite.applyNeedsAttentionTransition({cwd: tree.dir, slug, reason, arbiter: tree.arbiterRemote, env, note})` with no `pushBranch`, so it defaults to true. This is SAFE because `inPlaceStrategy.prepare()` switches HEAD onto `work/<slug>` before the rebase `--abort` (continue-branch.ts), so HEAD IS on `work/<slug>` at the kept tip — matching run.ts/do --remote, NOT performStart's temp-branch case (start.ts `routeContinueConflict` explicitly used pushBranch:false because HEAD there was a throwaway temp branch off main). The pushed tip equals what is already on the arbiter (rebase aborted), so it is a no-op-equivalent re-push; test/do.test.ts ~line 905 verifies `arbiter/work/alpha` is still present and the agent never ran.)

## Decisions (RATIFIED 2026-06-08 by the maintainer)

Both RATIFY asks above are CONFIRMED as the intended contract for the autonomous in-place worker:

1. **`lost` / exit-2 for a non-backlog in-place `do`** (in-progress / done / absent) is the INTENDED contract — it deliberately supersedes the old `refused`/`usage-error` / exit-1 framing, unifying in-place `do` with `do --remote` / `run` (claim-first). The slice's old byte-for-byte acceptance criterion is OVERRIDDEN by this decision (the re-scope was correct). The new test (`test/do.test.ts:918`) pinning `lost`/exit-2 is the contract of record.
2. **Pushing the kept `work/<slug>` branch on the §10 continue-rebase-conflict surfacing** (`pushBranch:true` default) is INTENDED and SAFE — HEAD is on `work/<slug>` at the kept tip (a no-op-equivalent re-push), matching `run`/`do --remote`. This is the correct autonomous behaviour (recovery rides the pushed branch).

FOLLOW-ON (separate, already captured): the `lost`-on-in-progress MESSAGE dropped a resume hint — a message-only fix tracked by `work/observations/do-lost-on-in-progress-drops-resume-hint.md` (now promoted to a slice). That is orthogonal to this ratification (no behaviour/exit-code change).

Disposition: RATIFIED — the contract is settled and recorded here. This note may be deleted once the maintainer is satisfied the decision is durable (it is now in code + tests + this block).
