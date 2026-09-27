---
title: 'Route every direct push and gh write on the CI paths through a write seam (no behaviour change)'
slug: ci-split-route-direct-writes-through-seams
spec: ci-agent-job-without-write-token
blockedBy: []
covers: [4]
needsAnswers: true
---

## What to build

A pure refactor that makes every network write on the CI code paths visible at a seam, so the later phase mode can record it in the agent phase and perform it in the apply phase. Today most writes already go through `ledgerWrite`, the review provider (`ReviewProvider`), the issue provider (`IssueProvider`) or the integrator, but several push directly: the per-item lock helpers in `item-lock.ts`, `pushContinuedBranchWithStaleLeaseRetry` (called from `start.ts`, `workspace.ts` `createJob` and `isolation.ts`), `routeToNeedsAttention` when `do.ts` calls it directly for the deadline checkpoint, `deleteRemoteWorkBranchIfPresent`, `persistTaskingCandidates` in `tasking.ts`, and `pushTreelessResult` in `advance-treeless-publish.ts`.

Add seam methods (on `LedgerWriteStrategy` or a sibling seam object, whichever keeps the interface coherent) for each direct write that a CI path reaches, and route those call sites through them. The default strategy does exactly what the code does today. Human-only verbs (`requeue --reconcile`, `requeueItemLock`), `gc --remote-branches` and `install-ci`'s own `gh api` calls stay as they are (they never run in an agent job), but the task records that in code comments at those sites.

After this task a grep for `'push'` and for `gh` write argument lists outside the seam implementations finds only the documented exempt sites.

### Design reference (carried verbatim from the spec)

#### 5. Write sites and the seams they must go through

Every network write in `packages/dorfl/src` outside tests, from `grep -n "'push'"` and the `gh` argument lists. "Seam" means the call already goes through `ledgerWrite`, the review provider, the issue provider or the integrator; "direct" means it bypasses them today and must be routed through a seam (new seam methods are fine) so the phase recorder sees it.

| site | what it writes | today | CI phase |
| --- | --- | --- | --- |
| `ledger-write.ts` `currentLedgerWrite.applyTransition` | nonce-stamped CAS push of a prepared transition commit to `main` | the seam | apply (`createItemThroughCas`, used by `promoteObservation` and `mintAdr`) |
| `item-lock.ts` `acquireItemLock` | create-only lock ref | direct | lock |
| `item-lock.ts` `releaseLockEntry`, `leasedDeleteLockRef` | leased lock ref delete | direct | apply (lease on the lock job's `lockSha`) |
| `item-lock.ts` `amendHeldEntry` | lock entry amend | direct | apply, where a CI path still uses it |
| `item-lock.ts` `requeueItemLock` | lock amend | direct | human verb only, not a CI path |
| `integrator.ts` `mergePushOnce`, `pushBranch`, `deleteMergedHeadBranch` | merge push to `main`, branch push, merged-head delete | seam (`applyCompleteTransition`) | apply |
| `continue-branch.ts` `pushProposeBranchWithStaleLeaseRetry` | propose branch push | inside the integrator seam | apply |
| `continue-branch.ts` `pushContinuedBranchWithStaleLeaseRetry` | kept branch rebase push | direct, from `start.ts` (in-place continue), `workspace.ts` `createJob` (merge action, remote), `isolation.ts` | apply (decision 7) |
| `needs-attention.ts` `routeToNeedsAttention` | WIP commit and work branch push | seam when called through `applyNeedsAttentionTransition`; direct from `do.ts` (deadline checkpoint save) | apply |
| `needs-attention.ts` `deleteRemoteWorkBranchIfPresent` | remote work branch delete | direct (`apply-stuck-action.ts` reset, `returnToBacklog`) | apply |
| `needs-attention.ts` `attemptReconcile` | reconciled kept branch push | direct | human verb (`requeue --reconcile`), not a CI path |
| `tasking.ts` `persistTaskingCandidates` | `work/spec-<slug>` branch push | direct | apply |
| `advance-treeless-publish.ts` `pushTreelessResult` | `HEAD:main` push of a tree-less commit | direct, from the drivers | apply |
| `reap-branches.ts` `sweepRemoteMergedBranches` | merged branch delete | direct | `gc --remote-branches` in a no-agent job, unchanged |
| `github.ts` `GitHubProvider`: `pr create`, `pr edit` (two sites), `pr reopen`, `pr close`, `pr comment` | PR writes | review provider seam | apply |
| `issue-provider.ts` `GitHubIssueProvider`: `issue comment`, `issue close`, `issue edit --add-label/--remove-label` (two sites), `label create` | issue writes | issue provider seam | lock (label add, label create), apply (comment, close, label remove) |
| `integration-core.ts` callers of `postPRComment` / `postPRCommentOnBranch` | Gate-2 review comment | review provider seam | apply |
| `tasking.ts` caller of `closeRequestOnBranch` | close a stale spec PR on a bounce | review provider seam | apply |
| `close-job.ts` `closeIssue` | close landed issues | issue provider seam | `close-merged-issues`, no agent, unchanged |
| `install-ci-github.ts` `gh api` writes | secrets, rulesets, branch protection | its own wrapper | human-run `install-ci`, out of scope |

`gh pr view`, `gh pr list` (`merge-question-surfacer.ts`), `gh issue view` and `gh label list` are reads.

Correction to the idea note: it estimated about 40 push sites. The count is 17 `push` invocations in 8 files, plus 11 `gh` write argument lists in the 2 provider adapters (and `install-ci-github.ts`, out of scope).

## Acceptance criteria

- [ ] Every write site in the reference table marked "direct" and "CI phase: lock/apply" is reached only through a seam method; the exempt sites carry a comment saying why they are exempt.
- [ ] A test enumerates the non-test sources and fails if a `'push'` argument or a `gh` write verb (`pr create|edit|reopen|close|comment`, `issue comment|close|edit`, `label create`) appears outside the seam implementations and the documented exempt files, so a new direct write cannot appear unnoticed.
- [ ] The whole existing test suite passes unchanged (the refactor changes no behaviour); `pnpm -r build && pnpm -r test && pnpm format:check` is green.
- [ ] Tests cover the new seam methods through a stub strategy (a call routed through the seam is observed by the stub).

## Blocked by

- None. Can start immediately.

## Prompt

> Refactor dorfl (`packages/dorfl/src`) so that every network write a CI code path can reach goes through a write seam, with no behaviour change. The reference table in this task lists every site, what it writes, whether it already goes through a seam, and in which CI phase it will run later. Route the "direct" ones through new seam methods; leave the exempt ones and say why in a comment. Add the guard test that fails on a new direct write outside the seams. This is the foundation the phase mode (task `ci-split-phase-mode-and-guards`) builds on.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **A separate `refWrite` seam rather than more methods on `LedgerWriteStrategy`.** `ledgerWrite` is about `work/` ledger transitions (claim, complete, needs-attention); lock-ref and branch pushes are a different kind of write. A separate module (`ref-write.ts`) also avoids adding to the existing import cycle between `ledger-write.ts` and `needs-attention.ts`. The alternative was adding eight methods to `LedgerWriteStrategy`. This touches the later phase-mode task: its recorder must replace `refWrite` as well as `ledgerWrite`. The glossary entry records it.
- **Methods are named for what is being written, not for the git command,** and several simply call the existing helper (for example `pushContinuedBranch` calls `pushContinuedBranchWithStaleLeaseRetry`). This lets the recorder capture "push the continued branch against tip X" rather than a raw argument list. The alternative was one generic push method. The lock-ref methods are the exception: there the git push itself moved into the seam, because the lock helpers run in both the lock and apply phases.
- **Tests swap methods with `vi.spyOn(refWrite, ...)`, with no setter function.** `refWrite` is a copy of `currentRefWrite`, following how `ledgerWrite` and `ledgerRead` are stubbed today. The alternative was a strategy setter; that is left for the phase-mode task if it needs one.
- **`requeueItemLock` stays direct, as the task says,** even though its leased delete is identical to `deleteLockRef`. Its comment says it has no CI path, and in fact no production caller at all.
- **`returnToBacklog` keeps calling `deleteRemoteWorkBranchIfPresent` directly,** because it is only reached through `ledgerWrite.applyReturnToBacklogTransition`, which is already a seam. The guard's caller list allows `needs-attention.ts` for this reason.
- **The guard checks more `gh` commands than the task lists:** `pr merge`, `issue create|reopen|delete`, `label edit|delete`, `secret`, `variable`, `release`, `workflow run|enable|disable` and `gh api -X POST|PATCH|PUT|DELETE`. This way `install-ci`'s writes, and the future `gh workflow run` dispatch from ADR decision 1, show up as named allowlist entries instead of going unseen. The alternative was checking only the task's list.
