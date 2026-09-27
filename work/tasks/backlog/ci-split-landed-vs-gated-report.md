---
title: 'Report every merge-mode land whose tree differs from the gated tree'
slug: ci-split-landed-vs-gated-report
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-agent-result-and-reruns]
covers: [10]
---

## What to build

Decision 2 keeps the merge-mode CAS loop gate-free, and after the split the first push will usually lose a race in merge mode, so the landed tree will usually be a re-rebase the gate never saw. Make that visible: the apply phase compares the landed tip's tree with the gated tip's tree (the bundle tip) and, when they differ, reports "landed without re-gate after N lost races" in the run output and in a trailer on the landed commit (a `git interpret-trailers`-style line, like the existing `CAS-Nonce` trailer).

### Design reference (carried verbatim from the spec)

2. **A lost CAS in the apply job.** The merge-mode retry loop in `performIntegration` re-runs only `rebaseOntoMainWithReconcile` and the push, never the gate (verified). Decided: keep the code's behaviour, and correct the drift in the same change: `WORK-CONTRACT.md` ("Land = rebase + re-verify + advance", in `skills/setup/protocol/` and mirrored to `work/protocol/`), the ADR `land-primitive-rebase-reverify-advance`, and the `advance-lifecycle` template comment ("re-rebase + re-gate + retry"). Re-running the agent phase on a lost race is recorded as a follow-up idea. Stated plainly, because the split changes the numbers: today the fresh gate runs seconds before the first push, so a lost race is rare; after the split the agent job's rebase and gate happen minutes before the apply job's first push (artifact upload, queueing, setup), so with parallel item runs in merge mode `main` will usually have moved, the first push will usually be non-fast-forward, and the landed tree will usually be a re-rebase the gate never saw. The "gated on the rebased tip" property goes from nearly always true to often false in merge mode. Propose mode is unaffected (a human merges the PR, and the repository's own required checks run on it). To keep this visible, the apply phase compares the landed tip's tree with the gated tip's tree and reports "landed without re-gate after N lost races" in the run output and in the landed commit's trailer; task `ci-split-landed-vs-gated-report` implements it and the changeset says the same.

## Acceptance criteria

- [ ] A merge-mode land with one forced lost race carries the trailer and the run-output line with the right count; a land that won its first push carries neither.
- [ ] Propose mode is unaffected; the acceptance gate is green.

## Blocked by

- `ci-split-agent-result-and-reruns`

## Prompt

> Add the landed-vs-gated report to the apply phase's merge land (the CAS loop in `performIntegration`, now in the apply half). Read decision 2.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
