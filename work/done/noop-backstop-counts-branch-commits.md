---
title: The empty-diff no-op backstop must also count source COMMITS on the branch ahead of main, so a requeue continue-from-tip (already-green committed work) reaches its gate + PR instead of routing to needs-attention
slug: noop-backstop-counts-branch-commits
blockedBy: []
covers: []
---

## What to build

Make the runner's empty-diff no-op backstop (`isWorkBranchDiffEmpty`, `src/agent-stop.ts`) consider **source commits on the work branch ahead of `<arbiter>/main`**, not just the working tree. Today it is working-tree-only, so a **requeue continue-from-tip** — where the kept `work/<slug>` branch already carries prior, COMMITTED, green work and the agent correctly adds nothing this session — reads as a no-op and routes the slice to needs-attention BEFORE the gate/PR. That breaks the documented `requeue` (keep+continue) → re-`do` recovery loop for the common case where the kept branch is already done-and-green (it can be recovered to backlog but can never be re-driven to a PR through `do`).

End-to-end behaviour after this slice:

- A re-`do` that continues from a kept branch with prior SOURCE commits ahead of `<arbiter>/main` (and a clean working tree) is **NOT** treated as a no-op — it flows to the gate + integrate + PR, even though the current session's working tree is empty.
- A genuine fresh-build no-op (HEAD == claim commit, no source commits ahead, empty working tree) is **unchanged** — still routed to needs-attention with `emptyDiffStopReason`.
- The `work/` ledger and `.agent-runner-job.json` are filtered out of the commit-range check too (the claim commit touches `work/` only and must still read as "no source"), exactly as the working-tree check filters them today.

This closes the catch-22 that forced a manual `gh pr create` from a preserved green branch during the `slicing-coherence` keystone build (see the observation below).

## Acceptance criteria

- [ ] `isWorkBranchDiffEmpty` returns FALSE (not a no-op) when the work branch has at least one commit ahead of `<arbiter>/main` that touches a NON-`work/` path, even with a clean working tree — i.e. a continue-from-tip with prior source commits flows to the gate.
- [ ] It still returns TRUE (no-op) for a fresh build that produced nothing: HEAD at the claim commit, no source commits ahead, empty working tree.
- [ ] The `work/` ledger and `.agent-runner-job.json` are excluded from the commit-range check (a claim commit alone, which touches only `work/`, still reads as "no source change").
- [ ] Best-effort plumbing: a git failure in the commit-range check is treated as NON-empty (the safe direction — never short-circuit a genuine build), matching the working-tree check's existing failure handling.
- [ ] An integration-style test exercises the real recovery loop: a kept branch with a prior source commit ahead of a `--bare` arbiter main re-`do`s (or the shared `performDo`/`runRemotePipeline` no-op gate runs) and does NOT route to needs-attention; a from-scratch empty build still does.
- [ ] Tests mirror the repo's existing style (throwaway git repos; `GIT_CONFIG_GLOBAL` isolation), and the existing `agent-stop` / empty-diff tests still pass.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (Independent of the `slicing-coherence` chain; touches `src/agent-stop.ts` + its callers in `src/do.ts`, no overlap with the slice files.)

## Prompt

> Make the runner's empty-diff no-op backstop count SOURCE COMMITS on the work branch ahead of `<arbiter>/main`, not just the working tree, so a `requeue` continue-from-tip (a kept branch whose prior work is already committed + green) reaches its gate + PR instead of being mis-routed to needs-attention as a no-op.
>
> DOMAIN VOCABULARY: the no-op backstop is `isWorkBranchDiffEmpty` in `src/agent-stop.ts` — the DETERMINISTIC backstop for the agent STOP sentinel ("an `agent.ok` run that changed NOTHING is never a successful build"). It is shared by `performDo` and `runRemotePipeline` (see `src/do.ts`, the `isWorkBranchDiffEmpty` / `emptyDiffStopReason` call site + its doc-comment). It is currently **working-tree-only**: it runs `git status --porcelain -- . :(exclude)work` and treats an empty result as a no-op, on the documented assumption that "the work branch HEAD is still the CLAIM commit, so the agent's output sits ENTIRELY in the WORKING TREE." That assumption holds for a FRESH build but is FALSE for a `requeue` continue-from-tip: `agent-runner requeue <slug>` (default keep+continue, see `work/done/requeue-continue-and-reset.md`) leaves the `work/<slug>` branch UNTOUCHED so the next claim CONTINUES from its tip — there the prior work is a chain of COMMITTED commits ahead of main and the working tree is legitimately clean.
>
> WHERE TO LOOK (verify paths — they may have drifted): `src/agent-stop.ts` (`isWorkBranchDiffEmpty`, `emptyDiffStopReason`, the `JOB_RECORD_FILENAME` exclusion); `src/do.ts` (the shared no-op gate call site + its big doc-comment on the STOP sentinel vs the empty-diff backstop); the existing tests for this behaviour (grep for `isWorkBranchDiffEmpty` / `empty diff` / `emptyDiffStopReason` in `test/`).
>
> THE FIX (maintainer-confirmed direction): the build is a genuine no-op IFF the working tree carries no source change (today's check) AND there is no commit in `git rev-list <arbiter>/main..HEAD` that touches a non-`work/` path. The `arbiter` param is ALREADY threaded into `isWorkBranchDiffEmpty` (today unused — "accepted for call-site symmetry … and possible future strategies") — this is exactly that future use, so the SIGNATURE need not change. Implementation note: you need a fetch of the arbiter (or rely on the caller's) so `<arbiter>/main` resolves; mirror how the surrounding code refreshes the ref. Keep the `work/` + `.agent-runner-job.json` exclusions in the commit-range check too. Keep the working-tree check as the primary/first signal for the common fresh-build path; the commit-range check is the additional condition that flips a continue-from-tip out of "no-op".
>
> SEAM TO TEST AT: the `agent-stop` unit tests for the predicate itself (a branch with a source commit ahead of a `--bare` arbiter main ⇒ NOT empty; a claim-commit- only branch ⇒ empty), and ideally an integration-style assertion through the shared no-op gate that a continue-from-tip is NOT routed to needs-attention while a from-scratch empty build still is.
>
> SCOPE FENCE: do NOT change the STOP-sentinel path (`parseStopSentinel`) or the needs-attention routing/reason text beyond what the new condition requires; this is purely making the empty-diff PREDICATE branch-commit-aware. Do NOT change `requeue` itself — its contract is correct; the backstop is the side that needs to honour it.
>
> FIRST run the drift check (launch snapshot): confirm `isWorkBranchDiffEmpty` is still working-tree-only (the `git status --porcelain` check) and that `requeue` keep+continue still leaves the branch untouched for continue-from-tip. If the backstop already counts branch commits, route to `needs-attention/` with the discrepancy rather than building on a stale premise.
>
> "Done" = the no-op backstop counts source commits ahead of `<arbiter>/main` (so a requeue continue-from-tip reaches its gate + PR), the fresh-build no-op is unchanged, the `work/`/job-record exclusions hold, tests cover both directions, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

## Provenance

Promoted from `work/observations/noop-backstop-misfires-on-requeue-continue-from-tip.md` (2026-06-08), filed while conducting the `slicing-coherence` chain. The keystone slice `slice-output-through-integration` hit this exact catch-22 — a flaky-gate red → `requeue` keep+continue → re-`do` short-circuited at the no-op backstop, so the PR had to be opened manually. Delete that observation once this slice lands in `done/`.
