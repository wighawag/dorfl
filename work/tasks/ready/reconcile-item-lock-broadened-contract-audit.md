## Context

This task is the promote-slice follow-up from the review-gate observation
`review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20` (Gate 2
approved `reaper-no-lock-outcome-benign-not-lost`, 2026-06-20; answers applied
2026-06-22).

During that slice, `reconcileItemLockAgainstMain` in
`packages/dorfl/src/item-lock.ts` gained new behaviour on the leased-delete
rejection arm (around lines ~1038–1046, the `remoteEmpty` branch):

1. It now performs an extra `git ls-remote <arbiter> <ref>` round-trip on
   EVERY leased-delete rejection (not just reaper-driven ones).
2. When the remote ref is empty, it `update-ref -d`s the local stale tracking
   ref — i.e. it MUTATES local refs as a side-effect of a function whose name
   suggests a read-style reconcile.
3. As a consequence, a rejected leased delete that used to surface as
   `error` may now surface as `no-lock` for ALL callers of
   `reconcileItemLockAgainstMain`, including non-reaper recovery paths.

The review's q2 disposition was explicitly `promote-slice` (option ii):
DOCUMENT the broadened contract and AUDIT non-reaper callers for the
`error` -> `no-lock` shape change. A full rename/split of the function
(option i) was rejected as over-engineering. The observation's terminal
routing was `delete`, but CONTINGENT on this follow-up slice existing so the
q2 content is not lost — hence this task.

This is NOT churn: the broadened shared behaviour is live in production code
today and non-reaper callers have not been audited.

## Scope

1. Document the broadened contract of `reconcileItemLockAgainstMain` on the
   function itself (JSDoc), covering:
   - the extra `git ls-remote` round-trip on leased-delete rejection,
   - the local `update-ref -d` side-effect when the remote ref is empty,
   - the outcome-shape change: a rejected leased delete where the remote ref
     is empty now returns `no-lock` instead of `error`,
   - that this applies to ALL callers, not just the reaper.
2. Enumerate every call site of `reconcileItemLockAgainstMain` in
   `packages/dorfl/` (reaper AND recovery AND anything else — grep for the
   symbol).
3. For each non-reaper caller, audit whether the `error` -> `no-lock` shape
   change is:
   (a) already correct under the new contract (document why), or
   (b) a latent bug (the caller was relying on `error` to trigger some
       recovery / surfacing behaviour that `no-lock` now bypasses).
4. If (b) for any caller, fix that caller (adjust its handling so the
   post-broadening semantics are what that caller actually wants) and add a
   targeted regression test pinning the corrected behaviour at that caller's
   boundary.
5. If all callers are (a), record the audit result briefly in a `## Decisions`
   block in the done record (caller X: OK because …; caller Y: OK because …)
   so the audit is discoverable from the work artifacts, not just this task's
   body.

## Non-goals

- Do NOT rename or split `reconcileItemLockAgainstMain` into a
  reaper-internal helper (option i was explicitly rejected).
- Do NOT expose a TOCTOU seam inside `reconcileItemLockAgainstMain` purely
  to enable an end-to-end test of the real-race `else` branch after the
  `remoteEmpty` check (q3 was `keep` — the predicate-boundary regression
  guard in `gc-reap-stale-locks.test.ts` is the accepted trade-off).
- Do NOT touch the reaper exit-code contract JSDoc on
  `reapReportNeedsAttention` (q1 ratified the JSDoc as-is).

## Acceptance criteria

1. `reconcileItemLockAgainstMain`'s JSDoc in `packages/dorfl/src/item-lock.ts`
   documents the four points listed under Scope #1.
2. The done record for this task contains a `## Decisions` block enumerating
   every call site of `reconcileItemLockAgainstMain` and stating, per site,
   whether the `error` -> `no-lock` shape change is intended (with a
   one-line why) or was fixed (with a pointer to the fix + test).
3. If any caller was fixed under Scope #4, a targeted regression test pins
   the corrected behaviour at that caller's boundary and passes under
   `pnpm -r test`.
4. `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Follow-up bookkeeping

Once this task lands (moved to `work/tasks/done/`), the originating
observation `review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20`
can be deleted per its q4 disposition — the q2 contingency will then be
satisfied by this task's done record.

## Prompt

> Build the task 'reconcile-item-lock-broadened-contract-audit', described above.
