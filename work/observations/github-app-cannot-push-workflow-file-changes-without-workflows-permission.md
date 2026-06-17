---
title: CI's GitHub App token cannot push ANY work branch that edits `.github/workflows/*` (missing `workflows` permission) — every workflow-touching slice strands its branch locally-only, regardless of gate verdict
type: observation
status: spotted
spotted: 2026-06-17
---

## What was seen

Live `agent-runner advance` (in CI) building slice `advance-lifecycle-dispatch-gate-inputs` (issue 151) on 2026-06-17. The slice's whole job is to add `workflow_dispatch` inputs to `.github/workflows/advance-lifecycle.yml` + its seed template. After Gate 2 blocked the work (a separate, legitimate correctness issue — see below), the runner tried to push the work branch and got:

```
! [remote rejected] work/slice-advance-lifecycle-dispatch-gate-inputs -> work/slice-advance-lifecycle-dispatch-gate-inputs
  (refusing to allow a GitHub App to create or update workflow `.github/workflows/advance-lifecycle.yml` without `workflows` permission)
error: failed to push some refs ... — the work is saved LOCALLY only; push the branch when online, then `requeue`.
```

So the work branch was NEVER published to `origin` (6 push attempts, all rejected). The implementation — blocked or not — exists ONLY on the CI runner's checkout. `git ls-remote --heads origin "work/slice-advance-lifecycle-dispatch-gate-inputs"` returns nothing; the slice is in `work/needs-attention/` on `origin/main` with the blocking finding recorded, but there is no recoverable branch a human can `git switch` to and finish.

## Why it matters

This is an **infrastructure-class** blocker, not a one-slice problem:

- GitHub rejects pushes from a **GitHub App installation token** that touch `.github/workflows/*` unless the App was granted the `workflows: write` permission. The agent-runner CI App evidently lacks it. So **every** slice whose diff includes a workflow file (this one, and any future `install-ci` / advance-loop / workflow-template change) will hit the same wall at push time — AFTER spending a full claim + build + review.
- The failure is **terminal + silent-ish**: the branch is stranded locally on the ephemeral CI runner. Unlike the cross-machine `complete` strands (where the branch at least reached `origin`), here there is NOTHING on the arbiter to recover from — when the CI runner is reaped, the built work is GONE. A human cannot finish it; it must be rebuilt from scratch (or built locally and pushed with a credential that has `workflows` permission).
- It compounds with the `propose` flow: the PR can't be opened because the branch can't be pushed, so the review verdict (block, here) and the work both evaporate with the runner.

## Refs

- Run: `advance` (CI) for `advance-lifecycle-dispatch-gate-inputs`, 2026-06-17. Push helper: 6 attempts, `[remote rejected] ... without workflows permission`.
- Slice (now parked, branch NOT on origin): `work/needs-attention/advance-lifecycle-dispatch-gate-inputs.md` (issue 151).
- Files the slice touches that trip the rule: `.github/workflows/advance-lifecycle.yml`, `docs/ci/advance-loop.yml.template`, `packages/agent-runner/src/advance-lifecycle-template.ts` (the emitter; the first is the tripwire).
- GitHub behaviour: an installation access token (GitHub App) needs the `workflows` permission (Actions: read/write on workflow files) to create/update files under `.github/workflows/`. A classic `GITHUB_TOKEN` from `actions/checkout` has the same restriction unless `permissions:` grants it AND the App allows it.

## Candidate dispositions (for triage — not decided here)

- **Grant the CI GitHub App / token the `workflows` permission** (App installation permission + `permissions: { contents: write, workflows: write, ... }` on the job) so workflow-touching branches can be pushed. Simplest fix; widest blast radius. Verify the App's installed permissions actually include it (granting in the workflow YAML alone is insufficient if the App was never authorised for `workflows`).
- If granting `workflows` is undesirable (security posture: a self-modifying CI App that can rewrite its own workflows is a privilege-escalation surface), then **route workflow-file slices to a human/PAT lane**: detect at claim/scan time that a slice's expected diff touches `.github/workflows/*` and either (a) refuse to build it in the App-token CI path with an actionable message ("this slice edits a workflow file; the CI App lacks `workflows` permission — build it locally / via a PAT and push"), or (b) build it but push via a separately-provided fine-grained PAT with `workflows` scope.
- At minimum, the push-failure surface should say WHY (it does name the reason) AND that the branch is **runner-local + unrecoverable once reaped**, so the human knows this is not a `requeue`-when-online case (there is no remote branch to continue from) but a rebuild-or-fix-credentials case.
- Consider a pre-claim guard (sibling to `do-fails-fast-when-acceptance-gate-statically-unrunnable`): if a slice is known to touch protected paths the CI identity cannot push, FAIL FAST before spending a build, the same fail-fast philosophy.
