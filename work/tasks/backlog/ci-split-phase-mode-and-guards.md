---
title: 'CI-only --phase lock|agent|apply mode with phase guards, recording seams and a read token passed per command'
slug: ci-split-phase-mode-and-guards
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-route-direct-writes-through-seams]
covers: [15, 18, 19]
---

## What to build

Introduce the phase mode every CI path will use, without splitting any path yet:

- A hidden, CI-only `--phase lock|agent|apply` option on `intake`, `advance` and `do`. It requires `GITHUB_ACTIONS=true` (or an explicit test override). Absent means today's single-process behaviour, byte for byte.
- A `Phase` value threaded through the run context next to `env` and `note`.
- **Phase guards:** in the lock and apply phases, `agentLaunchEnv` (the chokepoint in `harness.ts` every autonomous launch goes through), every harness launch, `runVerify` and `prepare` throw. In the agent phase, the write seams are replaced by RECORDING implementations: the first post-agent write call captures its intent and halts the pipeline with a sentinel the phase driver catches, and any write seam call that is not recorded throws. The recording machinery and the halting sentinel are built here and unit-tested with a toy pipeline; the per-path splits (build, intake, tasking, tree-less rungs, merge action) are their own tasks.
- **The exported `AGENT_SPAWNING_VERBS` set** (new; nothing by that name exists today) listing every CLI verb that can launch an agent or run repository code, plus a unit test that every CLI verb is classified as agent-spawning or not, so a new verb cannot escape.
- **A read token passed per command** for dorfl's own git fetches in the agent phase on private repositories: through `GIT_CONFIG_COUNT` / `http.extraheader` on the child git process only, which `scrubAgentEnv` in `agent-env.ts` already removes from any agent's environment. Never persisted in `.git/config`.

### Design reference (carried verbatim from the spec)

#### 4. The phase mode inside dorfl

- A CI-only `--phase lock|agent|apply` option on the agent-spawning verbs CI uses (`intake`, `advance`; `do` for parity). Absent means today's single process. `--phase` requires `GITHUB_ACTIONS=true` (or an explicit test override), so it cannot change laptop behaviour by accident.
- A `Phase` value is threaded through the run context next to `env` and `note`.
- **Record at the seams, resume at the boundary.** In the agent phase the write seams are replaced by recording implementations: `ledgerWrite` (a recording `LedgerWriteStrategy`), the review provider (`ReviewProvider`), the issue provider (`IssueProvider`; reads pass through with the read token), the integrator (reached through `applyCompleteTransition`), and the new seams task `ci-split-route-direct-writes-through-seams` introduces. The first post-agent write call captures its intent and halts the pipeline with a sentinel the phase driver catches. Nothing after the first write runs in the agent phase, which removes every dependency on a write result (PR URL, `mergeNonFastForward`, `publishedHead`, CAS rejection) by construction.
- The captured intent plus the pipeline's in-memory products (agent summary, review prose, questions, verdicts, reasons) form the handoff record. Replay is not blind: for every intent kind the spec of the task defines which fields the apply job recomputes from trusted inputs, which it takes from the record as bounded text, and which it derives from the validated bundle. Each intent kind names the tail function the apply phase resumes at.
- This forces a refactor of the long pipelines into a pre-boundary half and a post-boundary half: `performIntegration`'s `runRebaseToIntegrateTail` splits into "rebase and fresh gate" (agent) and "land loop and review comment" (apply); intake's `dispatchTask` / `dispatchSpec` split before `switchToWorkBranch`; tasking splits before its integrate or surface; the tree-less rungs split at their existing injectable persist seams (`surfacePersist`, `applyPersist`, the triage persist), which is earlier than the push on purpose (task `ci-split-handoff-artifact-format`).
- **Phase guards (defence in depth, independent of the workflow shape):**
  - in the lock and apply phases, `agentLaunchEnv` (the chokepoint every autonomous launch already goes through) throws, and so do `runVerify`, `prepare` and every harness launch;
  - in the agent phase, a write seam call that is not recorded throws (an unrouted write is a bug the tests catch), and the job token cannot write anyway;
  - in the apply phase, dorfl reads the artifact only from the directory passed on the command line, only the expected file names, and never executes anything from it.
- The lock phase writes its trusted facts to `$GITHUB_OUTPUT` through a small serializer that emits only shas, enums, booleans, bounded integers (the agent timeout) and dorfl-derived names (no free text from issues or items).

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

#### 10. Tokens per job

| job | `GITHUB_TOKEN` scope | persisted credential | other secrets |
| --- | --- | --- | --- |
| lock | `contents`, `issues`, `pull-requests`: write | allowed (no agent) | `DORFL_GH_TOKEN` if set |
| agent | `contents: read`, `issues: read` | `persist-credentials: false` | provider API key(s) only |
| apply | `contents`, `issues`, `pull-requests`: write; `actions`, `checks`: read | allowed (no agent) | `DORFL_GH_TOKEN` if set |

In the agent job, dorfl's own git fetches (the final rebase onto `<arbiter>/main`, the kept branch, the merge action's clone) use the read token through per-command `GIT_CONFIG_COUNT` / `http.extraheader`, which `scrubAgentEnv` already removes from the agent's environment. The agent can still read that token from `/proc`; it only reads. On a public repository the token is still needed for `gh issue view` rate limits. No `id-token` permission anywhere in the agent job.

#### 11. What does not change

- Laptop `do`, `advance`, `advance -n`, `intake`, `complete`, `start` / `work-on`, and the `run` daemon: no `--phase`, today's single-process behaviour.
- The `agent-env.ts` scrub stays; it now mainly protects the read token.
- `close-job`, `verify`, `reap-merged-branches` and `deploy-gh-pages` run no agent and keep their shape; `close-job` and `reap-merged-branches` switch to the writer setup role (task `ci-split-generate-workflows` (job shape)), and the workflow-level `permissions: {}` convention reaches all generated files.
- The ledger, lock and question protocols (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`) are unchanged in substance; only the land-invariant wording changes (decision 2).

Testing requirement carried from the spec (phase guard): In the lock and apply phases, `agentLaunchEnv`, every harness launch, `runVerify` and `prepare` throw; in the agent phase, an unrecorded write seam call throws.

## Acceptance criteria

- [ ] `--phase` is rejected outside GitHub Actions (without the test override) with a clear usage error, and without `--phase` every existing test passes unchanged.
- [ ] Phase-guard tests: in the lock and apply phases, `agentLaunchEnv`, a harness launch, `runVerify` and `prepare` each throw a named error; in the agent phase, a seam call that the recorder does not know throws, and a recorded one halts the toy pipeline with the captured intent.
- [ ] `AGENT_SPAWNING_VERBS` is exported, and a test fails if a CLI command is in neither the agent-spawning set nor the explicit non-agent set.
- [ ] A test shows the read token reaches the child git process through `GIT_CONFIG_*` and is absent from `.git/config` and from the environment an agent would be launched with.
- [ ] Tests cover the new behaviour; the acceptance gate is green.

## Blocked by

- `ci-split-route-direct-writes-through-seams`

## Prompt

> Add the CI-only phase mode to dorfl: the hidden `--phase lock|agent|apply` flag, the `Phase` context, the phase guards at the existing chokepoints (`agentLaunchEnv` in `harness.ts`, the harness launch, `runVerify`, `prepare`), the recording write seams with a halting sentinel, the `AGENT_SPAWNING_VERBS` set with its classification test, and the per-command read token. Do not split any real pipeline here; later tasks do that on top of this. Read the reference sections: the phase mode, the per-path phase map (so the recorder's shape fits every path), the tokens per job, and what must not change.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
