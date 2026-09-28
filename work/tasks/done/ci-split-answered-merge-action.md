---
title: 'Split the answered merge action into lock, agent and apply phases'
slug: ci-split-answered-merge-action
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-treeless-rungs]
covers: [10, 12]
needsAnswers: false
---

## What to build

The answered `kind: merge` action runs no agent but runs repository code (`prepare` and `verify` on branch code an earlier agent wrote), so it belongs in the agent job:

- **lock:** take the advancing lock (unified, `action: advance`) at the arbiter's current `main`; output `baseSha`, `lockSha`, and `continueTip` (the arbiter's current `work/task-<slug>` tip).
- **agent:** check out `work/task-<slug>` (the `createJob` path), rebase it LOCALLY (decision 7: no push here), run the optional `strictMergeApproval` re-stale check, run the fresh-worktree gate on the rebased tip; hand over `integrate` (answered merge) with the rebased tip as the bundle, `merge-restale`, or `needs-attention` on a red gate or a rebase conflict.
- **apply:** validate the bundle; push the rebased `work/task-<slug>` with `--force-with-lease` against `continueTip` (a stale lease fails the apply cleanly); land it with the unchanged CAS loop in merge mode; then record the answer (`applyAnsweredQuestions`), publish, release. For `merge-restale`, append the follow-up question and re-pause.

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

7. **The continue-branch rebase push.** Decided: the agent job rebases the kept `work/task-<slug>` locally; the apply job pushes it with `--force-with-lease` against the tip the lock job observed (`continueTip`). The lock job does no rebase. This applies to the build path (`start.ts` in-place continue) and to the answered merge action (`workspace.ts` `createJob`).

> FORWARD-POINTER (conductor, from the Gate-3 reviews of #418, #419 and #422): (1) `ci-split-treeless-rungs` made the tree-less lock phase REFUSE an answered `kind: merge` entry before any write ("that is task `ci-split-answered-merge-action`"); replace that refusal with this path's lock phase, and keep the refusal's test only if it still describes a real case. (2) The answered merge lands through the same `landIntegration` CAS loop in merge mode, and the agent job gated the rebased tip, so pass `gatedTip` (the validated bundle tip) exactly as `ci-phase-build.ts`'s apply does (task `ci-split-landed-vs-gated-report`): a land after a lost race must carry the `Landed-Without-Regate` trailer; add that case to the forced non-fast-forward test. (3) Per `ci-split-apply-rejects-hostile-bundle`'s Decisions, the answered-merge `integrate` keeps the trusted mode (the human's answer is the checkpoint); do not route it through the untrusted-origin forced propose. (4) Reuse the shared driver (`ci-phase-driver.ts`, `resolveAgentResult`, `leaseLockReleases`) and the LFS ordered push from `applyOwned`, and the publish-scope check (`checkTreelessPublishScope`) before the tree-less publish of the recorded answer. (5) Any hostile test you add is shown failing for its stated reason against a naive stub, not merely a missing-module error.

## Acceptance criteria

- [ ] Three-process tests: answered merge lands (including one forced non-fast-forward); a stale `continueTip` lease fails without writing; red gate routes to needs-attention; `merge-restale` re-pauses; the agent phase writes nothing to the arbiter.
- [ ] Failure modes: agent `failure` / timeout surfaces the item; `cancelled` releases the lock.
- [ ] Laptop behaviour without `--phase` is unchanged; the acceptance gate is green.
- [ ] New LFS objects on the rebased branch are pushed before its ref, through the same ordered push as the build path (task `ci-split-handoff-lfs-objects`).

## Blocked by

- `ci-split-treeless-rungs`

Ordering note: the path splits after `ci-split-agent-result-and-reruns` all edit the shared phase driver and the apply half of `performIntegration`, so they are chained (`ci-split-landed-vs-gated-report`, then `ci-split-handoff-lfs-objects`, then `ci-split-intake`, then `ci-split-tasking`, then `ci-split-treeless-rungs`, then `ci-split-answered-merge-action`) to avoid rebase conflicts between parallel builds, not because each needs the previous one's behaviour.

## Prompt

> Split the answered merge action (`apply-merge-action.ts`, `maybeRunMergeAction` in `advance.ts`) into the three phases on the shared phase driver.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Agent need for a `merge` answer is refined against the arbiter.** `treelessAgentNeed` returns `needsAgent: true` for `merge` (false for `hold`/`drop`). The CI phases then set it to false when the kept branch is missing or already on `main`, which the laptop reports as `already-integrated`. The lock phase publishes `continueTip` only in the agent case, and the apply phase treats "apply rung with `continueTip` set" as the trusted sign of an answered-merge run. Why: a handoff cannot express "nothing to land", and the lock outputs must be trusted. Alternative: always run the agent job and have it report "already integrated", but no intent exists for that. Touches: `advance.ts` `treelessAgentNeed` (used only by CI) and the lock and apply phases.
- **A stale `continueTip` lease writes nothing and keeps the lock held** (outcome `stale-lease`; the message points to `dorfl release-lock task:<slug>`). Why: this mirrors the build path and satisfies "fails without writing". Alternative: release the lock, but that is a write. Touches the apply outcome set; `land-failed` is also new.
- **A rebase conflict in CI goes to needs-attention.** On the laptop it only refuses with `merge-refused` and leaves the sidecar as is; the task explicitly asks for needs-attention in CI. A red gate uses the build path's `applyNeedsAttentionTransition` (branch push, then surface and release); with no bundle it uses `applyTreelessNeedsAttentionTransition`. Touches only CI behaviour.
- **The answer is recorded on a fresh checkout of the post-land `main`**, where the task now sits in `done/`. It reuses the same rung body with a replayed merge action (`landed`), and skips the need check because the land already happened. The laptop records it on the pre-land checkout and relies on the publish rebase. The two writes to `main` stay in the same order.
- **`landIntegration`'s source is the task's folder at `baseSha`** (`taskSourceAtBase`, as in the build path), so a re-rebase after a lost race keeps the reconcile arms. The laptop recovery tail uses a hard-coded `tasks-ready` and never runs the compare-and-swap loop.
- **The CLI passes `workspacesDir`, `prepare`, `verify` and `strictMergeApproval` into the advance context for `--phase` only.** Why: the in-place laptop tick must stay unchanged, and today it refuses an answered merge because `workspacesDir` is missing. Touches `cli.ts` `advance`.
- **The agent half fetches the kept commits' LFS objects** (`git lfs fetch <origin> <kept commits>`, best effort). Why: without them the apply job rejects the handoff. Alternative: fetch nothing and let such items surface. Touches only `apply-merge-action.ts`.
