---
title: 'The CI handoff artifact: layout, typed intent record, size limits, safe extraction and naming'
slug: ci-split-handoff-artifact-format
spec: ci-agent-job-without-write-token
blockedBy: []
covers: [8]
---

## What to build

Build the module that writes and reads the handoff the agent job uploads and the apply job downloads, as a pure, well-tested unit with no pipeline wiring:

- the directory layout (`handoff.json`, optional `work.bundle`, optional `lfs/<oid>`), and nothing else;
- `handoff.json` schema v1 with the closed union of intent kinds from the reference table (15 kinds), each with its allowed fields and their bounds, and a validator that rejects unknown schema versions, unknown kinds and unknown fields;
- the bundle writer (`git bundle create work.bundle <work-branch> ^<baseSha>`, exactly one ref);
- the size limits (set in code, never read from the artifact);
- safe extraction on the reading side: read only the expected file names from a directory under `$RUNNER_TEMP`, reject symlinks and any unexpected entry;
- the artifact name derivation (`handoffName`) from the item and `github.run_attempt`, sanitised to artifact-name rules;
- a serializer for the lock job's `$GITHUB_OUTPUT` facts that emits only shas, enums, booleans, bounded integers (the agent timeout) and dorfl-derived names.

The bundle's CONTENT validation (history, protected paths) is task `ci-split-apply-rejects-hostile-bundle`; LFS objects are task `ci-split-handoff-lfs-objects`.

### Design reference (carried verbatim from the spec)

#### 6. The handoff

One artifact per item run, named from `needs.lock.outputs.handoffName` (derived by dorfl in the lock job from the item and `github.run_attempt`, sanitised to artifact-name rules since an item id contains `:`; the attempt number keeps a "Re-run all jobs" from colliding with attempt 1's artifact, because artifacts belong to the run, not the attempt), uploaded with `retention-days: 1` (artifacts of a public repository are downloadable by any signed-in user, so they must hold nothing that is not going to be public anyway), containing only:

- `handoff.json`: `{schema: 1, item, intent, products}`. `intent` is a closed union with one kind per boundary, listed in the table below. `products` holds the bounded free text: PR body from the agent summary, Gate-2 review prose, needs-attention reason and questions, verdict fields, candidate task file contents. There is no MAC: the run boundary binds the artifact to the item (decision 1).
- `work.bundle`, for code-carrying intents only (`integrate`, and `needs-attention` / `deadline-checkpoint` / `stop` / `agent-failed` when there is WIP): `git bundle create work.bundle <work-branch> ^<baseSha>`, exactly one ref.
- `lfs/<oid>`: every object referenced by an LFS pointer blob added or changed in the bundle's new commits, copied from the agent job's `.git/lfs/objects/`. Every such oid must be present, including one the agent copied from elsewhere in the repository (the agent job's checkout fetched it), so the apply job never has to ask the LFS server what exists.

LFS in the agent job: the checkout uses `lfs: true` (read token), and the setup runs `git lfs install --local` so a commit of an LFS-tracked path stores a pointer and the object under `.git/lfs/objects/`, as on a laptop. dorfl's handoff writer finds the pointers by scanning the blobs of the new commits (a blob that parses as a pointer counts, whatever `.gitattributes` says), not by trusting `git lfs ls-files`. Accepted consequence: a legitimate text file that happens to parse as a pointer (a test fixture, say) is treated as one, and its object must be present or the handoff is rejected.

**The intent kinds.** For every kind: what the apply job recomputes from trusted inputs (lock outputs, workflow inputs, the tree at `baseSha`, the arbiter, the event), what it takes from the record (bounded text or enums, validated), what it takes from the validated bundle, and the tail function it resumes at. A field not listed is not read from the artifact at all.

| intent | recomputed from trusted inputs | taken from the record | from the bundle | apply resumes at |
| --- | --- | --- | --- | --- |
| `integrate` (build) | item, work branch name, arbiter, integration mode (workflow flag, then the untrusted-origin rule on the task at `baseSha`), `deleteMergedHead` | PR title (single line, at most 72 characters), PR body, Gate-2 review prose | work branch tip (done-move included) | the land half of `runRebaseToIntegrateTail` (the `applyCompleteTransition` loop), then the review comment, then the lock release |
| `integrate` (answered merge) | item, branch, mode `merge`, the answered `kind: merge` entry read from `main` | none | rebased tip of `work/task-<slug>` | the same land loop, then `applyAnsweredQuestions`, the tree-less publish and the release |
| `merge-restale` | item, the answered entry | none | none | the `strictMergeApproval` follow-up question and re-pause, publish, release |
| `needs-attention` | item, branch, sidecar path | reason, questions | WIP tip, if any | the write half of `routeToNeedsAttention` (branch push) and the surface (sidecar, `needsAnswers: true`), then the release |
| `deadline-checkpoint` | item, branch, `maxAutoCheckpoints` from config at `baseSha` | none | WIP tip; the checkpoint count is recounted from the new commits | the write half of `routeDeadlineCheckpoint`: branch push, then auto-continue release or surface |
| `stop` | item, branch | reason, stop kind (enum) | WIP tip, if any | the write half of `saveAgentStop` |
| `agent-failed` | item, branch | failure detail | WIP tip, if any | the write half of `saveAgentFailure` |
| `tasking-land` | spec slug, the spec move to `specs/tasked/`, candidate folder (`work/tasks/backlog/`), mode, the origin stamp and gate keys of the spec at `baseSha` | candidate task files keyed by safe slug, PR body, the task-set review verdict and prose, the trimmed spec body (task `ci-split-tasking`) | none | the tasking integrate with the review OFF (it ran in the agent phase), then the release |
| `tasking-surface` | spec slug, branch `work/spec-<slug>`, mode | candidate task files, reason, questions | none | `persistTaskingCandidates` (commit rebuilt in the apply job), `closeRequestOnBranch` in propose mode, `surfaceTaskingBlock` |
| `surface` | item, item path at `baseSha`, sidecar path, engine-built base questions | the agent's questions | none | `persistSurfacedQuestions`, publish, release |
| `triage` | item, the resolved `observationTriage` gate, the engine-built triage question, the note at `baseSha` | the gate's disposition (enum: keep, duplicate, map) with its target slug and reason, and the surface agent's questions when the rung fell through to surface | none | `autoDisposition` or `persistSurfacedQuestions`, publish, release (the marker back-fill needs no agent and runs in apply directly) |
| `apply-decision` | item, the answered sidecar read from `main` | the decision verdict: outcome (enum `task`, `spec`, `adr`, `dispose`, `resolve`, `ask`), the minted title, body and slug for `task` / `spec` / `adr`, the reason, and the follow-up questions for `ask` | none | the verdict router (`promoteObservation` via `createItemThroughCas`, `mintAdr`, delete, settle and keep, or append and re-pause), publish, release |
| `intake-ask` | issue number, marker, seen comment ids (lock output) | question text | none | `dispatchComment`, label removal |
| `intake-bounce` | issue number, marker, seen comment ids | bounce text | none | `closeIssue` with the comment, label removal |
| `intake-task`, `intake-spec` | issue number, placement, origin-trust stamp, document mode, seen comment ids, the slug (derived from the verdict, then checked by `slug-safety.ts`) | title (single line), body, and for a spec the two gate booleans the prompt judged | none | render the document, `switchToWorkBranch`, `performIntegration`, completion comment, label removal |

There are 15 kinds: `integrate` has two rows (build and answered merge) and `intake-task` / `intake-spec` share one. The answered merge action's re-stale outcome (`strictMergeApproval`) needs its own kind, `merge-restale`. The implementing tasks may merge or split kinds, but every kind must keep all four columns filled.

Deliberately NOT handed over as a bundle: intake documents, tasking candidates and tree-less rung results. For those the apply job re-renders and re-commits from the structured products on a fresh checkout of `main`, exactly as dorfl does today after the agent returns. Reason: on those paths dorfl stages only dorfl-chosen paths today (`tasking.ts` `git add -- <paths>`, `intake.ts` `git add -- <relPath>`, the persist helpers write one sidecar or body), so accepting a bundle would silently widen what the agent can land. The build path commits with `git add -A` today, so a bundle does not widen it (the new `.github/` rule narrows it).

- **Size limits** (set in code, never read from the artifact): artifact 200 MB; bundle 100 MB; one blob 20 MB; LFS objects 500 MB in total; `handoff.json` 2 MB; PR title 72 characters (the existing `PR_TITLE_MAX`); PR body and each comment 60,000 characters (under GitHub's 65,536); each reason or question 10,000 characters.
- **Artifact extraction:** download into an empty directory under `$RUNNER_TEMP`, read only the expected file names, reject symlinks and any other entry. `actions/download-artifact` must be at least 4.1.3, the release that fixed arbitrary file write during extraction (CVE-2024-42471).

## Acceptance criteria

- [ ] Round-trip tests for every intent kind (write, then read and validate).
- [ ] Rejection tests: unknown schema, unknown kind, unknown field, an intent kind the trusted rung cannot produce, every over-limit text field, an over-limit `handoff.json`, a symlink or an unexpected file in the artifact directory, a bundle with more than one ref.
- [ ] `handoffName` is deterministic, differs between run attempts, and is valid for every legal item id (including ids containing `:`).
- [ ] The lock-output serializer refuses free text (a test passes an issue title and expects a refusal).
- [ ] Tests cover the new behaviour; the acceptance gate is green.

## Blocked by

- None. Can start immediately.

## Prompt

> Implement the handoff artifact format as a standalone module in `packages/dorfl/src`, following the reference section exactly (layout, the 15-kind intent table with its trusted / record / bundle / resume columns, size limits, naming). The trusted-vs-record split in the table is the security contract: the record carries only the fields listed in its "taken from the record" column. No pipeline wiring here.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
