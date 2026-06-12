---
title: job-record-out-of-committed-tree — relocate the per-job state record (`.agent-runner-job.json`) OUT of the checked-out worktree into a sibling control path under `workspacesDir` (`work/<work-id>.json`), so a runtime control file is never inside the committed tree — eliminating the `git add -A` leak, the continue-rebase wedge, AND the `.gitignore` dependence (no user-deletable directive)
slug: job-record-out-of-committed-tree
blockedBy: []
covers: []
---

> Self-contained ROBUSTNESS slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal (discharged into this slice on authoring): `work/observations/job-worktree-artifact-agent-runner-job-json-leaks-into-commits.md` (2026-06-11).
>
> MAINTAINER FRAMING (settled 2026-06-12): a gitignore entry is NOT an acceptable durable fix — a user can delete the directive, and a runtime control file does not belong in the source tree at all. The file MECHANISM is correct (a crash-surviving, scan-discoverable per-job anchor is genuinely needed — primarily the harness PID/session liveness pointer, which is NOT derivable from git or the dir name); the LOCATION (inside the checked-out worktree) was the mistake. Fix = move it OUT of the committed tree, NOT gitignore it.

## Why the record exists (so the fix preserves the need)

`.agent-runner-job.json` is the per-job STATE record of the out-of-checkout isolation substrate (ADR §1 jobs-not-agents, §2/§4). When `do --isolated`/`--remote`/`run` materialises a job worktree at `<workspacesDir>/work/<work-id>/` (`src/workspace.ts` `createJob`, `jobWorktreePath`/`encodeWorkId`), it writes this record at the WORKTREE ROOT. It holds `slug`, `repoKey`, `branch`, `startedAt`, lifecycle `state`, needs-attention `reason`, `prUrl`, and the `harness` block (adapter + PID/session LIVENESS pointer). Consumers — which DISCOVER it by walking `<workspacesDir>/work/*` — are `gc` (`discoverJobs`, `src/gc.ts` ~L286-306, the reaper's per-job evaluation), `agent-runner jobs` (the status dashboard, `src/cli.ts` ~L2143), and recovery/`status`. NOTE most of `JobRecord` is DERIVABLE (the dir name `encodeWorkId` already encodes `repoKey`+`slug`; `branch` is `work/<slug>` / `git rev-parse`; `reason` lives in the needs-attention item body; `prUrl` via `gh pr view`) — the one genuinely-must-store field is the harness LIVENESS pointer. This slice does NOT prune the derivable fields (that is a separate optimisation); it relocates the WHOLE record out of the tree, the minimal change that fixes the leak.

## The defect (verify against current code)

The record lives INSIDE the committed worktree (`writeJobRecord`/`readJobRecord` key on `join(dir, JOB_RECORD_FILENAME)`, `src/workspace.ts` ~L321-333), so the runner's broad `git add -A` commits sweep it onto the `work/<slug>` branch:

- `src/needs-attention.ts` (the "save aborted work (wip)" / move commits) does bare `gitHard(['add', '-A'], …)` at ~L314/L339/L751 — NO `:(exclude)` for the record.
- `src/integration-core.ts` (the done-move atomic commit) does `gitHard(['add', '-A'], …)` at ~L585 — NO exclude either.

So today the ONLY thing preventing the leak is fix #1 (the `.gitignore` entry — present at this repo's `.gitignore:9`). That protects ONLY repos whose `.gitignore` carries the entry; a target repo lacking it still has the record swept into the work branch. Observed twice live: it polluted a PR diff, and (worse) a committed/uncommitted record BLOCKED the continue-rebase `git switch` ("local changes to `.agent-runner-job.json` would be overwritten by checkout"), wedging the item in-progress on the arbiter. The `:(exclude)${JOB_RECORD_FILENAME}` / `.filter(... !== JOB_RECORD_FILENAME)` guards that DO exist (`src/agent-stop.ts` ~L205/L260, `src/gc.ts` ~L371) are only in diff-EMPTINESS / reachability CHECKS, NOT in the actual staging commits above.

## What to build

Relocate the per-job record to a SIBLING of the worktree, under the same `workspacesDir/work/` control area, so it is discovered exactly as today but is PHYSICALLY OUTSIDE any git tree.

1. **Move the record path from inside the worktree to a sibling.** Today the worktree is `<workspacesDir>/work/<work-id>/` and the record is `<workspacesDir>/work/<work-id>/.agent-runner-job.json` (inside the tree). Change it to a sibling, e.g. `<workspacesDir>/work/<work-id>.json` (NEXT TO the worktree dir, not inside it) — still under `workspacesDir/work/`, so `discoverJobs` still finds it by enumerating that directory, but it is NOT in the checked-out tree, so `git add -A` can NEVER see it. Decide the exact sibling layout in a `## Decisions` block (a `<work-id>.json` sibling file, or a `<workspacesDir>/jobs/<work-id>.json` parallel dir) — prefer the one that keeps `discoverJobs`'s single-directory walk simple and cannot collide with a worktree dir name. Update `writeJobRecord`/`readJobRecord`/`updateJobRecord` (`src/workspace.ts`) and the `recordPath` returned by `createJob` (~L299-307) to the new path. (Note: `createJob().recordPath` has NO external consumer today — grep finds none — so relocating it is contained to the `workspace.ts` write/read fns + `discoverJobs`; the reader surface is small.)

2. **Update `discoverJobs` to enumerate the relocated records** (`src/gc.ts` ~L286-306): instead of "for each work-id DIR, check for `JOB_RECORD_FILENAME` INSIDE it", enumerate the sibling records (or check the sibling path per work-id), pairing each record with its worktree dir (`<work-id>.json` ↔ `<work-id>/`). Keep the existing `deriveSlug(entry)` / recordless fallback behaviour for legacy/missing records. The reaper's per-worktree predicate (clean-AND-reachable) is unchanged — it still operates on the worktree dir; only WHERE the record is read from moves.

3. **Remove the gitignore dependence; treat the record-name filters as now-INERT cleanup (CAREFULLY).** Once the record is out of the tree it can NEVER be staged or appear in `git status`/a commit diff, so:
   - Remove `.agent-runner-job.json` from this repo's `.gitignore` (it no longer lives in any tree); and STOP `setup`/scaffolding from adding that gitignore line to target repos (grep `skills/setup` + any scaffold for the entry and remove it — the protection is now STRUCTURAL, not gitignore-dependent). This is the load-bearing half of step 3.
   - The `JOB_RECORD_FILENAME` filters in `src/agent-stop.ts` (~L205 in `isNoOpBuild`, ~L260 in `hasSourceCommitsAhead`) and `src/gc.ts` (~L371 in `isWorktreeClean`) are NOT leak-defence — they are EMPTINESS / CLEANLINESS classification logic ("is this a no-op build?" / "is the worktree clean enough to reap?") that happens to NAME the record so a worktree carrying ONLY the record reads as clean/no-op. After relocation these filters become INERT (the record can no longer appear in `git status`/the diff), so they MAY be removed as cleanup — but ONLY after confirming each is inert, and you MUST keep the co-located `:(exclude)work` half (that is the `work/`-ledger exclusion, a SEPARATE concern that stays). If in doubt, LEAVE the filters: an inert filter is harmless, whereas removing one that is subtly still load-bearing would regress the no-op-build / clean-worktree predicates (the latter feeds the reaper's safety, cross-ref `isolated-config-read-main-only-fetch-and-reap-on-failure`). The REQUIRED outcome of step 3 is "no gitignore dependence", NOT "the filters are deleted."

4. **Confirm the continue-rebase wedge is gone.** With the record out of the tree, the continue path's `git switch`/rebase (`src/do.ts` `performDoRemote`, the onboard/continue path) can no longer be blocked by "local changes to `.agent-runner-job.json` would be overwritten by checkout." Add/confirm a test that a continue-from-kept-branch rebase succeeds with a job record present (it is now out-of-tree, so it is invisible to the switch). Cross-ref `work/done/continue-conflict-resurface-from-needs-attention.md`.

5. **Migration / back-compat for an in-flight old-location record.** A worktree created by an OLD binary has the record at the in-tree path. Decide (and document) the read fallback: `readJobRecord`/`discoverJobs` may check the NEW sibling path first, then the OLD in-tree path, so an in-flight job from a prior version is still discoverable/reapable. Low surface (worktrees are transient), but state the choice rather than silently orphaning a live old-location job.

## Scope

- IN: relocate the per-job record to a sibling under `workspacesDir/work/` (out of the committed tree); update `writeJobRecord`/`readJobRecord`/`updateJobRecord`/`createJob`'s `recordPath`/`discoverJobs`; remove the `.gitignore` entry + the setup-scaffold of it + the `:(exclude)`/filter guards that only defended the in-tree record; confirm the continue-rebase wedge is gone; a read-fallback for an old-location in-flight record.
- OUT: PRUNING the derivable `JobRecord` fields (a separate optimisation — this slice relocates the whole record unchanged); changing what the record CONTAINS or how liveness works; the reaper's clean-AND-reachable predicate; any change to `gc`'s `work/`-exclusion that is NOT about the job record.

## Acceptance criteria

- [ ] The per-job record is written to and read from a path OUTSIDE the checked-out worktree (a sibling under `workspacesDir/work/`, e.g. `<work-id>.json`), NOT `<work-id>/.agent-runner-job.json`. `writeJobRecord`/`readJobRecord`/`updateJobRecord` and `createJob`'s `recordPath` target the new location. Tested.
- [ ] `discoverJobs` (`gc`) and `agent-runner jobs`/`status` still discover + evaluate every job by walking `workspacesDir/work/` (record paired with its worktree dir), with the legacy `deriveSlug` fallback intact. Tested: a materialised job is discovered/reaped/listed exactly as before, with the record out of the tree.
- [ ] A runner `git add -A` commit (`needs-attention.ts` wip/move, `integration-core.ts` done-move) can NO LONGER stage the record — because it is not in the tree — REGARDLESS of any `.gitignore`. Tested: a build whose commit runs `git add -A` produces a diff with NO `.agent-runner-job.json`, in a repo with NO gitignore entry for it.
- [ ] The `.gitignore` entry for `.agent-runner-job.json` is REMOVED (here and from `setup`/scaffold) — the leak protection is now STRUCTURAL (out-of-tree), not gitignore-dependent. The record-name filters in `agent-stop.ts`/`gc.ts` are now INERT (the record cannot appear in `git status`/the diff); they MAY be removed as cleanup but only after confirming inertness, and the co-located `:(exclude)work` ledger exclusion MUST be preserved. (Leaving the inert filters is acceptable; the REQUIRED outcome is no gitignore dependence, not filter deletion. The no-op-build and clean-worktree predicates must behave identically.)
- [ ] The continue-from-kept-branch rebase succeeds with a job record present (out-of-tree ⇒ invisible to `git switch`); the prior wedge ("local changes to `.agent-runner-job.json` would be overwritten") cannot recur. Tested.
- [ ] An in-flight job whose record is at the OLD in-tree path is still discoverable/reapable via a documented read-fallback (or the migration choice is documented if fallback is declined).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. Self-contained; the reader/writer surface is small (`workspace.ts` record fns + `gc.ts` `discoverJobs` + the two exclude-guard sites).

## Prompt

> Relocate agent-runner's per-job state record (`.agent-runner-job.json`) OUT of the checked-out worktree so it is never inside the committed tree — killing the `git add -A` leak, the continue-rebase wedge, AND the `.gitignore` dependence in ONE structural change. MAINTAINER FRAMING: a gitignore entry is not an acceptable fix (a user can delete it; a runtime control file does not belong in the source tree). The file mechanism is right (a crash-surviving, scan-discoverable anchor is needed — chiefly the harness PID/session liveness pointer); the in-tree LOCATION was the mistake.
>
> THE DEFECT (verify first): `writeJobRecord`/`readJobRecord` key on `join(dir, JOB_RECORD_FILENAME)` (`src/workspace.ts` ~L321-333), so the record sits at the worktree root; the runner's broad `git add -A` commits (`src/needs-attention.ts` ~L314/L339/L751; `src/integration-core.ts` ~L585) have NO exclude and sweep it onto the work branch. Today only the `.gitignore` entry (`.gitignore:9`) prevents the leak — which fails on any target repo lacking it, and twice live it polluted a PR and WEDGED the continue-rebase `git switch`.
>
> BUILD: (1) move the record to a SIBLING under `workspacesDir/work/` (e.g. `<work-id>.json` next to `<work-id>/`, decided in a `## Decisions` block) — out of any git tree, still discoverable by walking `workspacesDir/work/`. Update `writeJobRecord`/`readJobRecord`/`updateJobRecord` + `createJob`'s `recordPath` (`src/workspace.ts`). (2) Update `discoverJobs` (`src/gc.ts` ~L286-306) to enumerate the relocated records paired with their worktree dirs, keeping the `deriveSlug` fallback. (3) REMOVE the `.gitignore` entry + its `setup`/scaffold source (the leak protection is now structural). The `JOB_RECORD_FILENAME` filters in `src/agent-stop.ts` (~L205 `isNoOpBuild`, ~L260 `hasSourceCommitsAhead`) and `src/gc.ts` (~L371 `isWorktreeClean`) are NOT leak-defence — they are no-op-build / clean-worktree CLASSIFICATION that names the record; after relocation they are INERT and MAY be removed as cleanup, but only after confirming inertness and ALWAYS keeping the co-located `:(exclude)work` ledger exclusion. If unsure, leave them (an inert filter is harmless; a wrong removal regresses the reaper-safety + no-op predicates). REQUIRED = no gitignore dependence, NOT filter deletion. (4) Confirm + test the continue-rebase no longer wedges on the record. (5) A documented read-fallback for an in-flight OLD-location record.
>
> READ FIRST: `src/workspace.ts` (`JOB_RECORD_FILENAME` ~L105, `JobRecord` ~L35-65, `createJob`/`recordPath` ~L299-307, `writeJobRecord`/`readJobRecord`/`updateJobRecord` ~L321-360, `encodeWorkId`/`jobWorktreePath` ~L85-100); `src/gc.ts` (`discoverJobs` ~L286-312, the exclude-filter ~L371); `src/agent-stop.ts` (~L205/L260 exclude guards); `src/needs-attention.ts` (~L314/L339/L751 `git add -A`) + `src/integration-core.ts` (~L585 `git add -A`) — the leak sites; `.gitignore` (~L9); `skills/setup/` (any scaffold of the gitignore line). Source signal: `work/observations/job-worktree-artifact-agent-runner-job-json-leaks-into-commits.md`. Cross-ref: `work/done/continue-conflict-resurface-from-needs-attention.md`, `work/backlog/isolated-config-read-main-only-fetch-and-reap-on-failure.md` (same worktree-hygiene cluster).
>
> SCOPE FENCE: do NOT prune the derivable JobRecord fields (relocate the whole record unchanged — pruning is a separate optimisation); do NOT change record contents or liveness; do NOT touch the reaper's clean-AND-reachable predicate or any `work/`-exclusion unrelated to the job record. "Done" = the record lives outside the worktree (a `git add -A` cannot stage it in ANY repo, no gitignore needed), `gc`/`jobs`/`status` discover it unchanged, the gitignore entry + exclude guards are gone, the continue-rebase wedge cannot recur, an old-location in-flight record is still discoverable, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim job-record-out-of-committed-tree --arbiter origin
git fetch origin && git switch -c work/job-record-out-of-committed-tree origin/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/job-record-out-of-committed-tree.md work/done/job-record-out-of-committed-tree.md
```
