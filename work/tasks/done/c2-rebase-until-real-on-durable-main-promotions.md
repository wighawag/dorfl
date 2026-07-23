---
title: 'Apply rebase-until-real-conflict (C2) to the durable main promotions'
slug: c2-rebase-until-real-on-durable-main-promotions
blockedBy: []
covers: []
---

## What to build

The per-item-lock substrate (SPEC `ledger-status-per-item-lock-refs`) has landed: claim/slice/advance
no longer touch `main` (they ride per-item parentless lock refs), so the bulk of `main`'s write
traffic is gone. But THREE durable `main` promotions still write the SHARED `main` ref:

- `tasks/todo` to `tasks/done` (the task completion / done-move),
- `briefs/ready` to `briefs/tasked` (the slicing/sliced promotion),
- `tasks/todo` to `tasks/cancelled` and `briefs/ready` to `briefs/dropped` (the won't-proceed terminal).

Because two DIFFERENT items' promotions share that one `main` ref, they can STILL falsely-contend
under parallelism: the same class as the original exit-3 defect, but at much lower volume now. The
lock holds the ITEM, so two promotions of the SAME item cannot race; only DIFFERENT items'
promotions share the ref.

These durable promotions route through the INTEGRATION band, NOT the `applyTransition` whole-ref
leased CAS that `claim` / `advancing` / `needs-attention` use. They go through
`integration-core.ts` (`performIntegration`) and its done-move primitive
`ledgerWrite.applyCompleteTransition`, which pushes the rebased work branch to `<arbiter>/main`.
That path ALREADY has a bounded rebase-and-retry loop (the "Race-1 re-rebase-and-retry", default
cap `DEFAULT_MERGE_RETRIES = 5`): on a non-fast-forward rejection it re-runs the step-4 rebase
against the freshly-advanced `<arbiter>/main` and retries the push, giving up after the cap by
routing to needs-attention. So the give-up today is NOT immediate; it is a FIXED CAP of 5 that two
different items' concurrent promotions can exhaust under parallelism, producing a false-contention
failure even though nothing actually tree-conflicts.

Apply **rebase-until-real-conflict (C2)** to that existing bounded retry loop, for the durable
promotions: change its termination condition from a FIXED CAP to a GENUINE same-path conflict. On a
non-fast-forward rejection, refetch / re-rebase onto the new `main` and re-push as it does today, but
do NOT count a clean re-rebase against a give-up budget; only give up when the replay hits a GENUINE
conflict (the source-folder precondition recheck below). Reuse the EXISTING source-folder / one-slug
placement re-check as that terminator (add NO new conflict-detection path), and add modest jitter on
the refetch to desynchronise the herd. A large liveness ceiling still bounds the pathological
livelock tail (see the liveness note in the prompt), so exit / route-to-needs-attention on contention
becomes RARE rather than routine, not literally impossible.

### The load-bearing scope distinction (read this before building)

A durable promotion IS a slug RELOCATION (`todo` to `done`, `ready` to `tasked`, etc.), so it belongs
to the **slug-relocation family**, NOT the same-path / append family. C2's design trail
(`work/notes/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md`, the `### C2`
section and especially its **SCOPE box**) is explicit that the slug-relocation family must KEEP its
source-folder precondition recheck. That recheck is NOT something to bypass on replay: it IS the
genuine-conflict terminator.

- On a rejected push, refetch `main`, then RE-ASSERT the source precondition on the NEW `main`:
  the item must still be in its SOURCE folder (e.g. still in `tasks/todo/` for a `done` promotion).
- If it is still in the source folder, the replay is a clean false-conflict: re-rebase the prepared
  move onto the new `main` and re-push. Do NOT count this against the genuine-conflict budget; loop.
- If the item is GONE from the source folder (a concurrent legitimate same-item transition already
  moved it, so it is already terminal), that is a GENUINE non-retryable conflict: stop with the
  existing definitive outcome (route to needs-attention as today). Do NOT silently re-push, which
  would clobber the concurrent winner (a lost-update violating atomicity).

So the change is precisely: a rejected push whose source-folder recheck on the rebased `main` still
shows the item in its expected source folder LOOPS (refetch + replay, with jitter) instead of
consuming the fixed give-up cap; a rejected push whose recheck shows the item already moved loses
definitively, exactly as today. The win is a change of KIND for the common case (two different items'
concurrent promotions stop being false-contention) plus a change of MAGNITUDE in the pathological
tail (a large liveness ceiling still bounds livelock; jitter desynchronises the herd so it is not
reached under sustained parallel load).

## Acceptance criteria

- [ ] The three durable `main` promotions (`tasks/todo` to `tasks/done`, `briefs/ready` to
      `briefs/tasked`, and `tasks/todo` to `tasks/cancelled` / `briefs/ready` to `briefs/dropped`)
      retry a rejected push by refetch + re-rebase-onto-new-`main`, terminating only on a GENUINE
      conflict (the source-folder precondition recheck on the rebased `main` is the terminator); a
      clean re-rebase does NOT consume a fixed give-up cap. Two DIFFERENT items' concurrent promotions
      no longer count as false contention / no longer fail with a spurious contention route.
- [ ] The refetch uses modest jitter to desynchronise a herd (the lockstep instant refetch-then-push
      loop is NOT used).
- [ ] The slug-relocation source-folder precondition recheck is PRESERVED: a replay re-asserts the
      item is still in its source folder on the new `main`; if it is gone (already terminal), that is
      a genuine non-retryable outcome (the existing definitive result), NOT a silent re-push.
- [ ] No NEW conflict-detection path is added: the genuine-conflict terminator REUSES the existing
      source-folder / one-slug placement re-check on the rebased `main`.
- [ ] A concurrency test: N different items promoting to `done` / `tasks/cancelled` / `briefs/tasked`
      in parallel all land without a false contention failure (no spurious cap exhaustion); a genuine
      same-item / same-path clash still loses definitively (exactly one winner).
- [ ] Tests cover the new behaviour, mirroring the repo's existing CAS/race test style.
- [ ] Tests use throwaway git repos + a local `--bare file://` arbiter; nothing writes outside its
      own temp fixtures (the real home/config/remotes are UNTOUCHED).

## Blocked by

- None. Can start immediately: the lock substrate this depended on (SPEC
  `ledger-status-per-item-lock-refs`, the nine lock slices) is already in `work/tasks/done/`.

## Prompt

> Apply rebase-until-real-conflict (C2) to the THREE durable `main` promotions so two different
> items' concurrent promotions stop falsely-contending the shared `main` ref. The three promotions
> are: `tasks/todo` to `tasks/done` (done-move), `briefs/ready` to `briefs/tasked` (slicing/sliced),
> and the won't-proceed terminals `tasks/todo` to `tasks/cancelled` / `briefs/ready` to
> `briefs/dropped`.
>
> Background: the per-item-lock substrate (SPEC `ledger-status-per-item-lock-refs`) landed, so
> claim/slice/advance ride per-item parentless lock refs and no longer touch `main`. The bulk of
> `main`'s write traffic is gone. But these three DURABLE promotions still write the SHARED `main`
> ref, so two DIFFERENT items' promotions can still falsely-contend (same class as the original
> exit-3 defect, lower volume). The lock holds the ITEM, so same-item promotions cannot race; only
> DIFFERENT items' promotions share the ref. This fix (C2) was DELIBERATELY scoped OUT of the nine
> lock slices, to be triaged "when the lock work is in `done/`", and that condition is now met.
>
> IMPORTANT, the actual seam (verify first, do not trust this blindly): these durable promotions do
> NOT use the `applyTransition` whole-ref leased CAS that `claim` / `advancing` / `needs-attention`
> use. They route through the integration band, `integration-core.ts` (`performIntegration`) and its
> done-move primitive `ledgerWrite.applyCompleteTransition`, which rebases the work branch and pushes
> it to `<arbiter>/main`. That path ALREADY has a bounded re-rebase-and-retry loop (the "Race-1
> re-rebase-and-retry", default `DEFAULT_MERGE_RETRIES = 5`): on a non-fast-forward rejection it
> re-runs the step-4 rebase against the freshly-advanced `<arbiter>/main` and retries, giving up
> after the cap by routing to needs-attention. So the defect is NOT "gives up immediately on
> rejected"; it is "gives up after a FIXED CAP of 5", which two different items' concurrent promotions
> can exhaust under parallelism even though nothing tree-conflicts.
>
> The change: turn that existing bounded loop into rebase-until-real-conflict FOR THE DURABLE
> PROMOTIONS. On a non-fast-forward rejection, re-rebase onto the new `main` and re-push as today, but
> a CLEAN re-rebase must NOT count against a fixed give-up cap; only give up on a GENUINE conflict
> (the source-folder recheck below). Reuse the EXISTING source-folder / one-slug placement re-check as
> the genuine-conflict terminator (add NO new conflict-detection path). Add modest jitter on the
> refetch to desynchronise the herd. A large liveness ceiling still bounds the pathological livelock
> tail.
>
> CRITICAL SCOPE: read `work/notes/ideas/ledger-lock-evolution-per-item-ref-vs-rebase-until-real-conflict.md`,
> the `### C2` section and its SCOPE box, before changing anything. C2's same-path "loop until clean"
> applies to the same-path / append family. A durable promotion is a slug RELOCATION (todo to done),
> so it belongs to the slug-relocation family, which must KEEP its source-folder precondition recheck.
> Do NOT remove or bypass that recheck on replay; it IS the genuine-conflict terminator: refetch,
> then re-assert the item is still in its EXPECTED SOURCE FOLDER on the new `main`. If it is, the
> replay is a clean false-conflict (re-rebase + re-push, do not count against the cap, loop). If the
> item is GONE from the source folder (a concurrent legitimate same-item transition already moved it,
> so it is already terminal), that is a GENUINE non-retryable conflict: stop with the existing
> definitive outcome (route to needs-attention as today), do NOT silently re-push, which would clobber
> the concurrent winner (a lost-update violating atomicity). Over-applying C2's unbounded same-path
> replay to these relocations is the one near-fatal mistake; the SCOPE box names it explicitly.
>
> Where to look (by concept, not brittle paths, and verify against current code): the durable `main`
> promotions route through the INTEGRATION band, `packages/dorfl/src/integration-core.ts`
> (`performIntegration`) and its done-move primitive `ledgerWrite.applyCompleteTransition` in
> `packages/dorfl/src/ledger-write.ts`, with `complete.ts` as the caller for the done-move and
> the slicing/cancel paths reaching the same integration machinery. The loop to change is the
> EXISTING "Race-1" bounded re-rebase-and-retry (`DEFAULT_MERGE_RETRIES`, the `mergeRetries` input on
> the integration core); the rebase-until-real change relaxes its FIXED CAP into a
> terminate-on-genuine-conflict loop for these durable promotions. Do NOT go to `applyTransition`'s
> whole-ref leased `:main` CAS, that is the seam `claim` / `advancing` / `needs-attention` use, NOT
> these promotions. The source-folder / one-slug placement recheck already exists on the integration
> path (the arbiter ledger-placement read / one-slug-one-folder guard); reuse it as the terminator.
>
> Test seam: the existing integration / CAS race tests (the ones that inject a small `mergeRetries`
> cap to exercise the Race-1 path). Extend to high fan-out: N different items promoting to `done` /
> `tasks/cancelled` / `briefs/tasked` in parallel must ALL land with zero false contention failures; a
> genuine same-item / same-path clash still yields exactly one winner and the loser loses
> definitively. Tests MUST use throwaway git repos + a local `--bare file://` arbiter and write
> nothing outside their own temp fixtures.
>
> Liveness note from the design trail: termination is provable for the pure cases (N different items
> serialize and each lands; N same-item, losers lose definitively). The realistic mixed regime can
> livelock on a single hot ref, so the jitter on refetch is LOAD-BEARING (not belt-and-braces) and a
> large liveness ceiling still bounds the pathological tail. A contention give-up changes from a
> ROUTINE signal into a RARE livelock signal; that is the intended outcome, not literal elimination of
> any ceiling.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does
> it still match the code in `tasks/done/` (the landed lock substrate), the relevant ADRs (e.g.
> `docs/adr/claim-ledger-vs-protected-main.md`, `ledger-status-on-per-item-lock-refs`), and the
> ledger-write seam shape? If the durable promotions no longer go through the seam as described, or
> an ADR superseded an assumption here, do NOT build on the stale premise; route the task to
> needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention
> signal"). The folder names in particular (`tasks/todo`, `tasks/done`, `briefs/ready`,
> `briefs/tasked`, `tasks/cancelled`, `briefs/dropped`) should be confirmed against the current
> WORK-CONTRACT before wiring the source-folder rechecks.
>
> RECORD non-obvious in-scope decisions you make while building (the jitter bound, the liveness
> ceiling value, any per-transition asymmetry in how the source-folder recheck is keyed). If a choice
> meets the ADR gate (hard to reverse + surprising without context + a real trade-off, see
> `ADR-FORMAT.md`), write the durable WHY as an ADR in `docs/adr/`; otherwise note it briefly in the
> done record / PR description. An un-recorded in-scope decision is a review FINDING, not a silent
> default.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim c2-rebase-until-real-on-durable-main-promotions --arbiter <remote>   # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/c2-rebase-until-real-on-durable-main-promotions <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/c2-rebase-until-real-on-durable-main-promotions.md work/tasks/done/c2-rebase-until-real-on-durable-main-promotions.md
```
