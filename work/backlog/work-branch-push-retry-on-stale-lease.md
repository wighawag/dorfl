---
title: the continued-branch push retries on a stale --force-with-lease ("stale info") by re-fetching the work branch + re-rebasing, instead of failing the run with green work stranded in the job worktree
slug: work-branch-push-retry-on-stale-lease
blockedBy: []
---

## What to build

When the requeue-continue path pushes the rebased `work/<slug>` branch to the arbiter with `--force-with-lease` and the push is REJECTED for a stale lease ("stale info"), **re-fetch the work branch ref, re-rebase onto current main, and retry the push** (bounded) instead of letting the whole run fail. Today (`materialiseAndOnboard` in `workspace.ts`) the continue path does a single `git push origin <branch>:<branch> --force-with-lease=<branch>`; if the remote `work/<slug>` ref moved since the mirror fetch (a requeue-continue churns it), the lease's expected value is stale and the push is rejected — so a fully GREEN, committed build (tests passed, Gate-2 approved) never opens its PR and the work is stranded in the job worktree.

This is the observed incident: `advance-verb-resolver` built green (1467 tests, approved, commit `64b9501`) but the push failed with `--force-with-lease` "stale info"; the origin tip stayed the stale pre-requeue `f75ff55`, no PR opened, and the green work sat only in `/home/wighawag/.agent-runner/work/...` until recovered by hand.

### Why a retry is SAFE here (the key invariant)

The `work/<slug>` branch is **unshared** — a requeued item is claimed by exactly one job at a time (the arbiter CAS serialises per slug), so nobody else legitimately advances that branch concurrently. The lease's job is to catch a stale LOCAL view, not to defend against a rival writer. So on a stale-lease rejection the correct response is: **re-observe the actual remote tip (fetch), rebase our green work onto it, and push again** — updating the work branch to a value that descends from the freshly-observed remote. This stays within the existing guardrails: `--force-with-lease` (re-leased against the JUST-fetched ref), **NEVER bare `--force`, NEVER to main** (ADR §11), work branch ONLY.

### Precise scope

- In the continue-path push (`workspace.ts`, the `continueFromKept` branch that does the rebase-then-`--force-with-lease` push), detect a **stale-lease / "stale info" rejection** distinctly from other push failures.
- On that rejection: **re-fetch the arbiter's `work/<slug>` ref** (and `main`), **re-run the existing onboard-time rebase** of the continued branch onto current main, then **retry the push** with a lease re-computed against the freshly-fetched ref. Bound the retries (mirror the existing retry caps elsewhere, e.g. the claim/slicing-lock `retries` default of 3) and surface a clear terminal message if still failing after the cap.
- A **rebase CONFLICT during a retry** is the existing conflict path — abort (never auto-resolve), route to needs-attention with the reason (unchanged behaviour; the retry only handles the CLEAN-rebase stale-lease case).
- Do NOT broaden to `main` or to non-work refs, and do NOT switch to bare `--force`. The retry re-leases each attempt; it never blind-overwrites.
- Preserve the green-work-is-safe property throughout: the work is already committed in the worktree, so every retry path must keep it recoverable (the branch is pushed on success; on terminal failure the run still routes to needs-attention with the branch + commit intact, as today).

> Drift note: confirm the continue-path push is still the single `--force-with-lease=<branch>` in `materialiseAndOnboard` (`workspace.ts`) and that `rebaseContinuedBranchOntoMain` is still the onboard-time rebase helper. If the push/rebase shape changed, reconcile against current code — the goal is "a stale-lease rejection re-fetches + re-rebases + retries (bounded), rather than stranding green work."

## Acceptance criteria

- [ ] A continue-path `--force-with-lease` push that is rejected for a STALE LEASE triggers a re-fetch of the work branch + a re-rebase onto current main + a push retry (bounded), rather than failing the run.
- [ ] The retry stays within guardrails: `--force-with-lease` only (re-leased against the freshly-fetched ref), NEVER bare `--force`, NEVER targeting main, work branch ONLY.
- [ ] A clean re-rebase + successful retry lands the green work and lets the PR open (the incident no longer strands committed work in the job worktree).
- [ ] A rebase CONFLICT on retry takes the existing abort → needs-attention path (never auto-resolved); the retry covers only the clean-rebase stale-lease case.
- [ ] After the retry cap is exhausted, the run fails with a CLEAR message AND the green work is still recoverable (branch + commit intact, item routed to needs-attention as today).
- [ ] Tests reproduce a stale-lease rejection in a throwaway-git fixture (advance the remote work-branch ref between fetch and push) and assert the retry re-fetches, re-rebases cleanly, and the push succeeds; plus a conflict-on-retry case routing to needs-attention; plus an assertion that bare `--force`/main are never used.
- [ ] No shared/global location touched (throwaway repos only).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately.

## Prompt

> Make the requeue-continue branch push survive a stale `--force-with-lease` ("stale info") rejection by re-fetching the work branch, re-rebasing onto current main, and retrying the push (bounded) — instead of failing the whole run and stranding green, committed work in the job worktree. This is the observed `advance-verb-resolver` incident: a green build (1467 tests, Gate-2 approved, commit made) never opened its PR because the remote `work/<slug>` ref had moved since the mirror fetch, so the lease was stale and the single push was rejected.
>
> The retry is SAFE because the `work/<slug>` branch is UNSHARED (the arbiter CAS serialises the claim per slug — no rival writer), so re-observing the remote tip and rebasing our work onto it is correct. Stay within the existing guardrails: `--force-with-lease` re-leased against the freshly-fetched ref, NEVER bare `--force`, NEVER to main, work branch ONLY (ADR §11). A rebase CONFLICT on retry is the EXISTING abort → needs-attention path (never auto-resolve); the retry handles only the clean-rebase stale-lease case. Bound the retries (mirror the claim/slicing-lock `retries: 3` default) and fail with a clear message — keeping the green work recoverable — if still rejected after the cap.
>
> READ FIRST: `packages/agent-runner/src/workspace.ts` (`materialiseAndOnboard`, the `continueFromKept` branch: `rebaseContinuedBranchOntoMain` then `git push origin <branch>:<branch> --force-with-lease=<branch>`), the claim/`slicing-lock` retry-on-rejection loops for the bounded-retry pattern + exit-code conventions, and the ADR §10/§11 notes (rebase-not-merge; never `--force`, never to main). Detect the stale-lease rejection distinctly from other push failures.
>
> FIRST, check this slice against current reality (drift): confirm the continue-path push is still a single `--force-with-lease=<branch>` in `materialiseAndOnboard` and `rebaseContinuedBranchOntoMain` is still the onboard rebase. If they changed, reconcile against current code or route to `needs-attention/` with the discrepancy.
>
> TDD with vitest, house style (throwaway git repos). Reproduce the stale lease by advancing the remote work-branch ref between the fetch and the push, then assert the retry re-fetches + re-rebases cleanly + pushes successfully; add a conflict-on-retry → needs-attention case; assert bare `--force`/main are never used. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim work-branch-push-retry-on-stale-lease --arbiter origin
git fetch origin && git switch -c work/work-branch-push-retry-on-stale-lease origin/main
git mv work/in-progress/work-branch-push-retry-on-stale-lease.md work/done/work-branch-push-retry-on-stale-lease.md
```
