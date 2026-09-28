---
title: 'Split the surface, triage and apply rungs into lock, agent and apply phases, skipping the agent job when a rung needs none'
slug: ci-split-treeless-rungs
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-tasking]
covers: [12, 13]
---

## What to build

Split the three tree-less rungs, following the code as it is (`advance.ts`):

- **triage** (`triageRung`): a note already carrying `triaged:` is a no-op; a note with the engine-written `## Applied answers` record but no marker gets the marker back-filled (`stampTriaged`); both are deterministic, so the lock job outputs `needsAgent: false` and the apply job does the back-fill. Under `observationTriage: auto` only, the triage gate agent may auto-dispose a duplicate or mapped note (`autoDisposition`, which deletes the note and its sidecar and NEVER promotes); a gate failure, or a gate that keeps the note, falls through to the surface path (the engine-built triage question plus the `surface-questions` agent). Hand over `triage`: the gate's disposition and, on fall-through, the surface questions.
- **surface** (`surfaceRung`): the `surface-questions` agent, or the deterministic short-circuit for an observation with nothing to ask (`needsAgent: false`). Hand over `surface`.
- **apply** (`applyRung`): an answered task/spec content question (`applyAnsweredQuestions`) and a `kind: stuck` answer (keep / reset / cancel through `maybeRunStuckAction`) need no agent (`needsAgent: false`); an answered observation runs the agentic decision (`applyAgenticDecision`), whose outcomes are `task`, `spec`, `adr`, `dispose`, `resolve` and `ask` (`APPLY_ALLOWED_OUTCOMES`). Hand over `apply-decision`; the apply job routes it: `task` / `spec` through `promoteObservation` (via `createItemThroughCas`), `adr` through `mintAdr`, `dispose` deletes, `resolve` settles and keeps (`triaged:`), `ask` appends the follow-up questions and re-pauses. The answered `kind: merge` action is task `ci-split-answered-merge-action`.

In every case the phase boundary is the existing injectable seam (`surfacePersist`, `applyPersist`, `stampTriaged`, `autoDisposition`, `promote`, `mintAdr`), not the push; the apply job runs the deterministic write on a fresh checkout of `main`, then the tree-less publish, then the release.

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

11. **Skipping the agent job when the rung needs none.** Decided: in the first cut. The lock job outputs `needsAgent: false` for an answered task/spec `apply` with no `kind: merge` entry, a `kind: stuck` answer, the observation surface short-circuit and an intake triage skip.

> FORWARD-POINTER (conductor): (1) RED FIRST means the hostile tests are shown failing FOR THEIR STATED REASON against a deliberately naive apply stub (one that trusts the record), as `docs/spikes/ci-split-intake/` and `docs/spikes/ci-split-tasking/` did, not merely a missing-module error; quote that run and keep the evidence reproducible. (2) Observation `advance-lifecycle-push-trigger-lands-an-unreviewed-work-branch-on-main`: `pushTreelessResult` pushes `HEAD:main` from whatever is checked out, so a checkout not based on the arbiter's `main` publishes every commit between them. In the apply phase, run the deterministic write on a fresh checkout of `<arbiter>/main` and assert, before the publish, that the commits being published are exactly the rung's own (the new commit's parent is the fetched `<arbiter>/main` tip, or it is a rebase of only that commit); add a test where the apply checkout carries an extra commit and the publish refuses. (3) Reuse the shared phase driver (`ci-phase-driver.ts`: lock outputs, ownership check, `resolveAgentResult`, leased release) rather than re-implementing it.

## Acceptance criteria

- [ ] Three-process tests, each asserting the agent phase writes nothing to the arbiter and the apply phase produces today's commits: triage marker back-fill (agent job skipped); triage auto-dispose under `auto`; triage fall-through to surface; surface with questions; surface short-circuit (agent job skipped); apply-decision for each outcome `task`, `spec`, `adr`, `dispose`, `resolve`, `ask`; a `kind: stuck` reset (agent job skipped).
- [ ] Hostile cases, RED FIRST: a verdict naming another item or a path outside the item's own files; an `apply-decision` with an outcome outside `APPLY_ALLOWED_OUTCOMES`; a `triage` disposition outside its enum; each rejected with nothing written.
- [ ] Failure modes: agent `failure` / timeout surfaces the item; `cancelled` releases the advancing lock.
- [ ] Laptop `advance` without `--phase` is unchanged; the acceptance gate is green.

## Blocked by

- `ci-split-tasking`

Ordering note: the path splits after `ci-split-agent-result-and-reruns` all edit the shared phase driver and the apply half of `performIntegration`, so they are chained (`ci-split-landed-vs-gated-report`, then `ci-split-handoff-lfs-objects`, then `ci-split-intake`, then `ci-split-tasking`, then `ci-split-treeless-rungs`, then `ci-split-answered-merge-action`) to avoid rebase conflicts between parallel builds, not because each needs the previous one's behaviour.

## Prompt

> Split the tree-less rungs in `advance.ts` (`triageRung`, `surfaceRung`, `applyRung`, `applyAgenticDecision`, `maybeRunStuckAction`) and the publish in `advance-drivers.ts` into the three phases on the shared phase driver, with the agent job skipped when the lock job says no agent is needed. Follow the code, not an older description: the triage rung never promotes; promotion only happens in the agentic apply decision.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
