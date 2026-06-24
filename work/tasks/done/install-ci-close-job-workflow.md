---
title: install-ci issue-close-job workflow (capability E)
slug: install-ci-close-job-workflow
prd: runner-in-ci
blockedBy: [install-ci-core-and-github-adapter]
covers: [1, 2, 5, 9]
---

## What to build

The `install-ci` capability that emits the **issue close-job** workflow — capability E: when a PR merges to `main`, resolve which issue (if any) the merged work closes, run the existing "PRD complete?" query where a PRD is involved, and `closeIssue` when the closure condition holds. The query already exists (`prd-complete-query`, done); CI only WIRES the job that consumes it. This PRD does not re-build the query (Out-of-Scope fence).

The closure model (verified against `src/frontmatter.ts` + `prd-complete-query`): each artifact uses `issue:` XOR `prd:` (never both; if a hand-edit produces both, `prd:` wins and `issue:` is ignored — `resolveClosingIssue`). A **lone slice** carries `issue: N` and closes its own issue when its PR merges. A **PRD** carries `issue: N`; its N fanned slices carry `prd:` (NOT `issue:`) and reach the number via `slice.prd: → work/prd/<prd>.md PRD issue:`; that issue closes only when the "PRD complete?" query says ALL `prd:<slug>` slices are in `done/`. The close-job RESOLVES the issue number via that hop + `resolveClosingIssue`, then closes iff the condition holds.

End-to-end path:

- Emit ONE fixed close-job workflow from the GitHub adapter, triggered on a **merge to `main`**. Note there is no native "PR merged" event: use either `on: pull_request: {types: [closed]}` guarded by `if: github.event.pull_request.merged == true`, OR `on: push: {branches: [main]}` — pick ONE and record the choice + rationale in a `## Decisions` block. Prefer `push: [main]` for the close-job: it fires for BOTH PR-merges and direct pushes to main, and it always runs with a normal (non-fork-restricted) `GITHUB_TOKEN` that can actually close issues, whereas a `pull_request` event from a fork gets a read-only token and cannot close. The chosen trigger is part of the snapshot-asserted YAML.
- The job invokes the existing close machinery: resolve the closing issue (`resolveClosingIssue`: lone-slice `issue:` directly, or `slice.prd: → PRD issue:` for a PRD), run the "PRD complete?" query (`prd-complete-query`) for the PRD case, and call `IssueProvider.closeIssue` iff the closure condition holds. CI owns the JOB and the trigger; the query and the close action are the engine's, consumed unchanged.
- IN-PLACE in the checkout, concurrency-guarded, claim CAS as serialiser; the running CI job NEVER edits `.github/workflows/**`.
- The close job closes the issue via the `IssueProvider.closeIssue` seam (`src/issue-provider.ts` — the atomic comment-and-close already used by intake's bounce path), NOT direct `gh` calls in the core. (Any informational comment uses `IssueProvider.postIssueComment`, keyed by issue **number** — NOT the PR seam `postPRComment`.)
- Tested by emitting into `--fake` and snapshot/structurally validating the produced YAML (the trigger = PR-merged-to-main, the invoked close query); the query's own behaviour is already covered by `prd-complete-query`'s tests and is NOT re-tested here.
- **File-orthogonality:** add this capability as a NEW self-registering emitter module via the core's capability-registry seam (from `install-ci-core-and-github-adapter`) — do NOT hand-edit a shared central list/switch, so this slice and the other capability workflow slices (build-tick, advance-lifecycle, intake, close-job) stay mergeable in parallel.

**Gate (agent-buildable):** this slice BUILDS a deterministic generator, snapshot-tested under `--fake` with a stubbed close seam (no real issue touched); it does NOT itself close any issue or land a live workflow (the human runs `install-ci` and commits; US #9 forbids the CI job editing `.github/workflows/**`). The issue-closing happens in the generated artifact at runtime, not in building this slice. So no `humanOnly` (the PRD-level flag does not propagate).

## Acceptance criteria

- [ ] `install-ci` emits a single fixed close-job workflow triggered by PR-merged-to-`main`.
- [ ] The job resolves the closing issue via `resolveClosingIssue` (lone-slice `issue:` XOR `slice.prd: → PRD issue:`, `prd:` wins on conflict), invokes the EXISTING "PRD complete?" query (`prd-complete-query`) for the PRD case, and calls `closeIssue` only when the closure condition holds; it does NOT re-implement the query or the resolution (Out-of-Scope).
- [ ] The close goes through `IssueProvider.closeIssue` (no direct `gh` in the core); the issue number is reached via the `slice.prd: → PRD issue:` hop (slices carry no `issue:` field); CI owns only the job + trigger.
- [ ] The job runs IN-PLACE, carries a concurrency group, and NEVER edits `.github/workflows/**` (US #9).
- [ ] Tests generate into `--fake` and snapshot/structurally validate the YAML (trigger + invoked query), stubbing the `GitHubCIContext` seam; no live Actions run, no network; the query's own behaviour is NOT re-tested.
- [ ] **Shared-write isolation:** `--fake` writes to `.fake/`, never a real `.github/`; tests assert the real `.github/` and any real secrets store are untouched, and the stubbed close seam records calls in-memory without touching a real GitHub issue.

## Blocked by

- `install-ci-core-and-github-adapter` — the shared wizard / config / `--fake` / `GitHubCIContext` (incl. the issue/comment) seam this capability emits through. (`prd-complete-query` is already in `work/done/`, so the query the job consumes is available; it is a consumed engine piece, not a slice blocker.)

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): re-read `work/prd/runner-in-ci.md` (capability E row + Out-of-Scope fence) and CONFIRM `prd-complete-query` is in `work/done/` and still exposes the "PRD complete?" query + `closeIssue` shape this job consumes. Confirm the dependency `install-ci-core-and-github-adapter` landed the `GitHubCIContext` seam, and that `IssueProvider.closeIssue` / `postIssueComment` (`src/issue-provider.ts`) still exist with those names (verified 2026-06-14; re-verify, since `postComment` was already renamed once to `postIssueComment`/`postPRComment`). If the query's surface changed, or the core's seam differs from what this slice assumes, do NOT build on the stale premise — route to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> GOAL: emit the issue CLOSE-JOB workflow (capability E) from `install-ci`. TRIGGER: a merge to `main` — there is no native "PR merged" event, so use `push: {branches: [main]}` (preferred: fires for PR-merges AND direct pushes, always with a token that can close issues) OR `pull_request: closed` + `if: github.event.pull_request.merged == true` (fork PRs get a read-only token and cannot close — a real limitation); pick ONE, record it in a `## Decisions` block, and snapshot-assert it. On that trigger, resolve the closing issue (`resolveClosingIssue`: lone-slice `issue:` XOR `slice.prd: → PRD issue:`, `prd:` wins on conflict), run the EXISTING "PRD complete?" query (`prd-complete-query`) for the PRD case, and `closeIssue` iff the closure condition holds. CI owns ONLY the job + trigger; the query, the resolution, and the close action are the engine's, consumed unchanged (Out-of-Scope: do NOT re-build them).
>
> DOMAIN VOCABULARY: the close-job is CI's; the "PRD complete?" query already exists (`prd-complete-query`, done) and counts a PRD's `prd:<slug>` slices in `done/`. The issue number is reached by the hop `slice.prd: → work/prd/<prd>.md PRD `issue:`` (slices carry NO `issue:` field of their own — it lives only on the PRD). The close goes through `IssueProvider.closeIssue` (the atomic comment+`not planned`/complete+close seam in `src/issue-provider.ts`, already used by intake), NOT direct `gh`; any extra comment uses `postIssueComment` (by issue number), never the PR seam `postPRComment`. CI runs IN-PLACE (the container is the isolation); concurrency-guarded; the job NEVER edits `.github/workflows/**` (US #9).
>
> WHERE TO LOOK: the shared core + GitHub adapter from `install-ci-core-and-github-adapter` (wizard / config / `--fake` / `GitHubCIContext` incl. the issue/comment seam). The done slice `prd-complete-query` for the query the job invokes. The seed `docs/ci/README.md` + `src/advance-ci-template.ts` for the repo's CI-template + structural-validator style.
>
> SEAMS TO TEST AT: generate into `--fake` with a stubbed `GitHubCIContext` (the close seam records calls in-memory, no real issue touched); snapshot/structurally validate the produced YAML (PR-merge trigger + the invoked close query). No live Actions run, no network. Do NOT re-test the query (already covered by `prd-complete-query`).
>
> DONE means: the close-job workflow is emitted and snapshot/structurally validated under `--fake`, it consumes the existing query without re-implementing it, the close goes through the provider seam, and the shared-write isolation assertions pass (real `.github/` + real secrets + real issue untouched). Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform any git transitions — the runner/human owns those.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim install-ci-close-job-workflow --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-close-job-workflow <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/install-ci-close-job-workflow.md work/done/install-ci-close-job-workflow.md
```
