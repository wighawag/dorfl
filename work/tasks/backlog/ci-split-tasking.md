---
title: 'Split tasking (advance spec:, do spec:) into lock, agent and apply phases'
slug: ci-split-tasking
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-intake]
covers: [12, 13]
---

## What to build

- **lock:** take the tasking lock (`action: task`) at the arbiter's current `main`.
- **agent:** run the tasker agent and its review rounds exactly as today, and ALSO the one-round task-set review (`reviewGate`, `harnessTaskReviewGate`), which today runs inside `performIntegration` (`tasking.ts` passes `review` / `reviewGate`; with the fresh-worktree gate off, `runGate2Review` launches at the front of `performIntegration`). It is an agent, so it must run here: the apply phase's guard throws on any agent launch. Hand over `tasking-land` (candidates, PR body, the review verdict and prose, the trimmed spec body) or `tasking-surface` (candidates, reason, questions; also used when the task-set review blocks).
- **apply:** validate every candidate: path `work/tasks/backlog/<safe-slug>.md`, new-or-changed relative to `baseSha` (the fence `newOrChangedStagedTasks` applies today); its frontmatter parses; `origin` / `originTrust` are overwritten with the spec's stamp at `baseSha`; `humanOnly` / `needsAnswers` must parse as booleans (the real guard on their values is the backlog staging folder: every candidate lands staged and a human promotes it, so the apply job does not pretend to verify what the hostile review loop set). Then rebuild the commit on a fresh checkout and integrate with the spec move to `specs/tasked/` and the review turned OFF (it already ran), or save the candidates on `work/spec-<slug>`, close a stale PR in propose mode and surface; release the lock.
- **the trimmed spec body (decided 2026-09-27: carry it):** today the tasker trims the spec to its durable framing (TASKING-PROTOCOL §6) and `tasking.ts` lands that body with `git mv` plus `git add` of the tasked spec. In the split, the trimmed body travels as a bounded record field of `tasking-land`. The apply job re-parses its frontmatter and pins every gate key (`humanOnly`, `needsAnswers`, `taskedAfter`, `issue`, `origin`, `originTrust`) to its value at `baseSha`, requires the body to keep the Problem Statement, Solution and User Stories headings, and writes it as the tasked spec in the same commit as the move.
- **agent result:** the generic handling from task `ci-split-agent-result-and-reruns` applies; a tasking failure surfaces the spec, a cancel releases it.

### Design reference (carried verbatim from the spec)

#### 3. Per-path phase map

Verified against the code: every CI path is writes, then agents plus local work, then writes, with no network write between two agent launches and no write result fed back to an agent. The review loops (intake lone-task review in `intake.ts`, tasker review rounds in `tasking.ts`, Gate-2 rounds in `review-gate.ts`) change only local files or memory between rounds.

| path | lock phase (writes before) | agent phase (agents, repository code, local git) | apply phase (writes after) |
| --- | --- | --- | --- |
| intake | read issue, comments and labels; `processing` label (`intake.ts` `addLabel`); deterministic triage (a skip needs no agent); record the comment ids read | decision agent; lone-task review rounds (in memory) | ask: comment; bounce: `closeIssue` with comment; task/spec: render the document, branch `work/intake-<type>-<slug>`, `performIntegration` (PR, or merge with the CAS loop), completion comment; always: remove the label |
| build (`advance task:`, `do`) | classify; claim (`acquireItemLock`, `action: implement`); record base and kept-branch tip | continue rebase (decision 7); build agent; stop and deadline detection; gate; Gate-2 review; done-move commit; local rebase; fresh-worktree gate on the rebased tip | push branch, PR or merge (the `applyCompleteTransition` loop); review comment; WIP save with auto-continue or surface on deadline; needs-attention route; lock release |
| tasking (`advance spec:`, `do spec:`) | tasking lock (`action: task`) | tasker agent; review rounds (candidate files on disk); the one-round task-set review (`reviewGate`, today run inside `performIntegration`) | integrate the candidates with `specs/ready → specs/tasked` (review OFF: it already ran), or save candidates, `closeRequestOnBranch` and surface; lock release |
| surface | advancing lock (unified, `action: advance`) | `surface-questions` agent (or the deterministic observation short-circuit) | `persistSurfacedQuestions` on a fresh checkout; tree-less publish; lock release |
| triage | advancing lock; a note already carrying `triaged:` is a no-op, and the legacy back-fill (an engine-written `## Applied answers` record without the marker, stamped by `stampTriaged`) is deterministic, so both are `needsAgent: false` | under `observationTriage: auto` only, the triage gate agent (a duplicate or mapped note is auto-disposed); otherwise, or when the gate keeps the note, the surface path: the engine-built triage question plus the `surface-questions` agent | on a fresh checkout: `stampTriaged` (back-fill), `autoDisposition` (delete the note and its sidecar) or `persistSurfacedQuestions`; tree-less publish; lock release |
| apply, observation | advancing lock | agentic decision (outcomes `task`, `spec`, `adr`, `dispose`, `resolve`, `ask`: `APPLY_ALLOWED_OUTCOMES` in `apply-decide.ts`) | route the verdict: `task` / `spec` through `promoteObservation` (via `createItemThroughCas`), `adr` through `mintAdr`, `dispose` deletes the note, `resolve` settles and keeps it, `ask` appends the follow-up question and re-pauses; tree-less publish; lock release |
| apply, task/spec content answers | advancing lock | none (decision 11) | `applyAnsweredQuestions`; tree-less publish; lock release |
| apply, `kind: stuck` | advancing lock | none | keep, reset (`deleteRemoteWorkBranchIfPresent`) or cancel; persist; publish; release |
| apply, `kind: merge` | advancing lock | `createJob` checkout of `work/task-<slug>`; local rebase; optional `strictMergeApproval` re-stale check; fresh-worktree gate (`prepare` + `verify` run the branch's code) | merge land with the CAS loop; `applyAnsweredQuestions`; publish; release |

Orderings the implementation must preserve: the tree-less publish (`runAdvanceTickWithTreelessPublish` in `advance-drivers.ts`) happens today AFTER `performAdvance` has released the advancing lock in its `finally`; and the answered merge lands before the answer is recorded, as two separate writes to `main`.

- **Structured products:** every slug passes `slug-safety.ts`; tasking candidate paths must be `work/tasks/backlog/<safe-slug>.md` and new-or-changed relative to `baseSha` (the fence `newOrChangedStagedTasks` applies today); intake document paths are recomputed from the verdict slug and the trusted placement, and the document is re-rendered (`renderBacklogTask`, the spec renderer) in the apply job, so the `origin` / `originTrust` stamp comes from the trusted event and not from the agent job. Re-rendering is not enough on its own: `renderBacklogTask` writes `title: ${title}` unescaped today (`intake.ts`), so a title containing a line break and `---` ends the frontmatter before the stamp lines and pushes them into the body. The apply job therefore (a) rejects any title that is not a single line or contains a control character, (b) renders every agent-supplied frontmatter scalar YAML-quoted, and (c) re-parses the rendered frontmatter and asserts that `origin`, `originTrust`, `slug` and `issue` equal the trusted values before committing. The same re-parse check applies to tasking candidates: their `origin` / `originTrust` are overwritten with the spec's stamp at `baseSha`, and a candidate whose frontmatter does not parse, or carries `humanOnly` / `needsAnswers` values the tasking review loop did not set, is rejected. (The same injection exists on today's single-job path; the separate task `intake-frontmatter-title-injection-strips-origin-stamp` fixes it there first.) The intake `seen=` delta written into the marker comes from the comment ids the lock job read (a lock output), never from a re-read in the apply job (which would mark comments seen that no agent read) and never from the agent job.

Where this copied paragraph and "What to build" disagree on candidate `humanOnly` / `needsAnswers` checks, "What to build" wins: the apply job only checks that they parse as booleans, because the review loop that sets them runs in the hostile job; the staging folder is the real guard.

## Acceptance criteria

- [ ] An end-to-end tasking case in three processes: the agent phase writes nothing to the arbiter and launches the task-set review there; the apply phase launches no agent (the phase guard would throw) and lands the tasks and the spec move.
- [ ] A task-set review `block` in the agent phase is handed over as `tasking-surface` and surfaces the spec.
- [ ] Hostile cases, RED FIRST (written and run before the implementation, the failing run quoted in the report): a candidate outside `work/tasks/backlog/` (including `..` and `work/tasks/ready/`); a candidate that sets its own `originTrust`; a candidate whose frontmatter does not parse; an edit to a pre-existing staged task this run did not produce; a trimmed spec body that changes a gate key or drops a required heading.
- [ ] Failure modes: agent `failure` / timeout surfaces the spec; `cancelled` releases the tasking lock.
- [ ] Laptop tasking without `--phase` is unchanged; the acceptance gate is green.

## Blocked by

- `ci-split-intake`

Ordering note: the path splits after `ci-split-agent-result-and-reruns` all edit the shared phase driver and the apply half of `performIntegration`, so they are chained (`ci-split-landed-vs-gated-report`, then `ci-split-handoff-lfs-objects`, then `ci-split-intake`, then `ci-split-tasking`, then `ci-split-treeless-rungs`, then `ci-split-answered-merge-action`) to avoid rebase conflicts between parallel builds, not because each needs the previous one's behaviour.

## Prompt

> Split dorfl's tasking path (`tasking.ts`: the tasker, `runTaskReviewLoop`, `persistTaskingCandidates`, `surfaceTaskingBlock`, the integrate) into the three phases on the shared phase driver. The apply job never takes a bundle here: it re-commits only validated candidate files.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
