---
title: 'Correct the land-invariant drift, document the split for consumers and write the changeset'
slug: ci-split-docs-drift-and-rollout
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-generate-workflows, ci-split-warn-single-job-workflows, release-workflow-restores-no-cache]
covers: [20, 22]
needsAnswers: false
---

## What to build

- Decision 2 drift, every place that still says a lost CAS re-runs the gate: `WORK-CONTRACT.md` (the "Land = rebase + re-verify + advance" paragraph) and `CLAIM-PROTOCOL.md` (the step 7a LAND paragraph), each edited in `skills/setup/protocol/` and mirrored byte-identically into `work/protocol/`; `docs/ci/README.md` (the merge-mode queue paragraph that says losers re-rebase and re-gate); the comments in `packages/dorfl/src/config.ts` and `repo-config.ts` ("a lost CAS costs only a re-rebase + re-gate retry"). (The workflow template comments are task `ci-split-generate-workflows`.) The new wording for both protocol docs: a lost CAS does not re-run the gate, and the apply phase reports every land whose tree differs from the gated tree. Edit `skills/setup/protocol/` and mirror byte-identically into `work/protocol/`; update ADR `land-primitive-rebase-reverify-advance` to match; fix the stale inline comment in `performAdvance` (`advance.ts`) that says the `work/advancing/` marker is kept.
- `docs/ci/README.md`: the three-job shape and why; one run per item and the slot cap; protected paths and building workflow-editing tasks locally; a project-setup hook must not restore an Actions cache (it runs in the agent job, and another item's agent could have poisoned it); self-hosted runners must be ephemeral; the upgrade path.
- A `minor` changeset: what changed and why (the leak routes the env scrub could not close), the cost (two extra jobs per item, one Actions run per item, the dispatch job), the new pinned actions, the protected-path rejection and what a workflow-editing task now does, that in merge mode most lands are re-rebased after the gate (and how to see it), the old-workflow warning, and "re-run `dorfl install-ci` after upgrading".

### Design reference (carried verbatim from the spec)

#### 13. Upgrade path and changeset

- `dorfl install-ci` regenerates `intake.yml` and `advance-lifecycle.yml`, adds `dorfl-item.yml`, and updates the composite setup action (roles). Existing SHA pins are kept as today. The seed template `docs/ci/advance-loop.yml.template` (parameterised by `advance-lifecycle-template.ts`) and `docs/ci/README.md` change with it, and so do the structural validators (`validateAdvanceCiTemplate` and the intake/lifecycle template tests).
- The setup action pins `dorfl@<version>`, so regenerated workflows always run a dorfl that understands `--phase`. An old workflow with a new dorfl keeps working unchanged and gets the warning of decision 9.
- `DORFL_GH_TOKEN`: no consumer action needed; the generated workflows now route it to lock and apply only.
- dorfl's own `.github/workflows` are regenerated in the same change (as `40a7f5fc` did for the pins), and the guard test also runs over the checked-in files so this repository cannot drift.
- Changeset: `minor` (a new CLI option, a new workflow file, a changed job shape, and consumer action required). It states what changed and why (the three leak routes the env scrub could not close), the cost (two extra jobs per item), the new actions and their pins, the protected-path rejection (and what a workflow-editing task now does), that in merge mode most lands will now be re-rebased after the gate ran (decision 2) and how to see it in the run output, and "re-run `dorfl install-ci` after upgrading".

#### 14. Drift found while verifying the idea note

- `WORK-CONTRACT.md` and the `advance-lifecycle` template comment say a lost CAS re-arms the gate; the code does not (decision 2).
- An inline comment in `performAdvance` (`advance.ts`, the lock step) still says the `work/advancing/<entry>.md` marker CAS is kept for all rungs; `advancing-lock.ts` says the marker is gone (the comment is stale; the code agrees with `advancing-lock.ts`).
- `renderBacklogTask` (and the spec renderer) in `intake.ts` write agent-supplied titles into frontmatter unescaped, which lets an intake agent strip the `originTrust` stamp today (task `ci-split-apply-rejects-hostile-bundle`; separate task `intake-frontmatter-title-injection-strips-origin-stamp`).
- The idea note's "roughly 40 push sites" is 17 (task `ci-split-route-direct-writes-through-seams`).

2. **A lost CAS in the apply job.** The merge-mode retry loop in `performIntegration` re-runs only `rebaseOntoMainWithReconcile` and the push, never the gate (verified). Decided: keep the code's behaviour, and correct the drift in the same change: `WORK-CONTRACT.md` ("Land = rebase + re-verify + advance", in `skills/setup/protocol/` and mirrored to `work/protocol/`), the ADR `land-primitive-rebase-reverify-advance`, and the `advance-lifecycle` template comment ("re-rebase + re-gate + retry"). Re-running the agent phase on a lost race is recorded as a follow-up idea. Stated plainly, because the split changes the numbers: today the fresh gate runs seconds before the first push, so a lost race is rare; after the split the agent job's rebase and gate happen minutes before the apply job's first push (artifact upload, queueing, setup), so with parallel item runs in merge mode `main` will usually have moved, the first push will usually be non-fast-forward, and the landed tree will usually be a re-rebase the gate never saw. The "gated on the rebased tip" property goes from nearly always true to often false in merge mode. Propose mode is unaffected (a human merges the PR, and the repository's own required checks run on it). To keep this visible, the apply phase compares the landed tip's tree with the gated tip's tree and reports "landed without re-gate after N lost races" in the run output and in the landed commit's trailer; task `ci-split-landed-vs-gated-report` implements it and the changeset says the same.

> FORWARD-POINTER (conductor): document what LANDED, not the spec sketch, where they differ. (1) The writer setup is a SIBLING action, `.github/actions/dorfl-setup-writer`, not a `role:` input on `dorfl-setup` (see `ci-split-generate-workflows` Decisions); `dorfl-setup` stays the agent role. (2) The landed-vs-gated report is the `Landed-Without-Regate: landed without re-gate after N lost race(s)` trailer plus a run-output line, emitted ONLY by the CI apply phase (laptop lands are unchanged; `ci-split-landed-vs-gated-report`). (3) `advance-lifecycle.yml`'s `push:` trigger is now limited to `branches: [main]`; say so in the upgrade notes (older generated workflows fire it on any branch touching `work/questions/**`, and re-running `install-ci` fixes it). (4) `verify` is exempt from the old-workflow warning and the workflow guard (it runs repository code but launches no agent). (5) Intake keeps the built-in token identity (no `DORFL_GH_TOKEN` passed). Edit protocol docs in `skills/setup/protocol/` and mirror byte-identically into `work/protocol/` (`work/protocol/VERSION` legitimately exists only there).

## Acceptance criteria

- [ ] `WORK-CONTRACT.md` and ADR `land-primitive-rebase-reverify-advance` state that a lost CAS does not re-run the gate and that the apply phase reports it; `diff -r skills/setup/protocol work/protocol` is clean apart from files that legitimately live in one place.
- [ ] `docs/ci/README.md` covers every point listed above, including the no-cache rule for project-setup hooks (this task and `release-workflow-restores-no-cache` both edit that file, hence the blocker).
- [ ] The stale `performAdvance` comment about the `work/advancing/` marker is corrected.
- [ ] The `minor` changeset exists and covers every point above; the acceptance gate is green.
- [ ] A grep for `re-arms the gate`, `re-gate + retry`, `re-gates + retries`, `re-rebase + re-gate` and `re-rebase and re-gate` over `skills/setup/protocol`, `work/protocol`, `docs/ci` and `packages/dorfl/src` (excluding tests) finds nothing that describes the merge-mode CAS loop.

## Blocked by

- `ci-split-generate-workflows`
- `ci-split-warn-single-job-workflows`
- `release-workflow-restores-no-cache`

## Prompt

> Finish the rollout of the CI split: the documentation and protocol drift and the changeset. This repository's workflows were already regenerated by task `ci-split-generate-workflows`.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Fixed README sections the task did not list.** The task asked for new sections plus the queue-paragraph fix. Leaving the old matrix descriptions and "the advance and intake jobs push, so they always keep the token" would have contradicted the new sections in the same file. So I made minimal edits to the "One-step adoption" step 2 and 3 list, the modes table (renamed "The two CI modes"), "Matrix enumeration scope" (now "Enumeration scope"), the `persist-credentials` note, the triggers and the "Relationship" bullet. The alternative was leaving them stale. This touches only `docs/ci/README.md`.
- **Removed `cache: pnpm` from the README's example hook.** The example is what consumers copy into `dorfl-setup`, which is the agent job, so it had to follow the new no-cache rule; it now uses `package-manager-cache: false`. This is documentation only; the generator is unchanged.
- **Wrote the "ephemeral self-hosted runners" rationale myself.** The spec and ADR state the rule nowhere; only the generated `dorfl-item.yml` header does ("each job needs a FRESH machine"). I expanded that into a README section: files and processes an agent leaves behind would survive into a later job that holds a write token. The alternative was a one-line rule with no reason given.
- **Amended the accepted ADR in place and added a dated addendum.** I rewrote the wrong sentences and marked each with a pointer to the addendum, rather than superseding the ADR, following the addendum convention in `terminal-state-reconciled-by-claim-not-by-read-commands.md`. The ADR's principle still stands; only the description of the CAS loop was wrong.
- **Did not bump `work/protocol/VERSION`.** Earlier protocol-doc changes (for example `ce627225`) did not bump it either, and the task does not ask for it. This touches the protocol-sync bookkeeping only.
- **Wrote one umbrella `minor` changeset.** Each `ci-split-*` task already added its own `patch` changeset. This one adds the rollout summary and upgrade instructions and carries the `minor` bump the spec asks for. The alternative, changing an existing patch changeset to minor, would have mixed the upgrade notes with one sub-task's detail.
