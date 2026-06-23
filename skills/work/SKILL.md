---
name: work
disable-model-invocation: true
description: "Router over this repo's work/-contract skills: ask which skill or flow fits your situation. The index you reach for when you can't remember which of setup / to-brief / to-task / drive-tasks / orchestrate / triage-observations / review / promote / surface-questions / answer-questions / capture-signal to use."
---

# Work (the router)

The other workflow skills are **user-invoked** (`disable-model-invocation: true`), so the agent can no longer surface them for you. _You_ are the index now. This skill is that index: it names the work/-contract skills and the flow between them, so you don't have to remember them all.

A **flow** is a path through the skills. Most work travels one **main flow**; the disciplines are cross-cutting and get composed _by file-path load_ from inside whichever skill is running (never by model auto-invocation). That file-path composition is how a user-invoked skill can compose another user-invoked one here, unlike Matt's slash-composed skills.

## The main flow: idea to built

1. **`setup`**: onboard ANY repo onto the `work/` contract (scaffold or migrate). Run once per repo, before the rest of the flow. Composes `to-brief` / `to-task` to convert existing material.
2. **`to-brief`**: turn the current conversation plus codebase understanding into a brief file in `work/briefs/ready/`. The LAUNCH snapshot, not maintained.
3. **`to-task`**: task a brief (or plan/design doc) into independently-grabbable, file-based tasks (`work/tasks/`), using tracer-bullet vertical tasks.
4. **Build the ready tasks. Pick the conductor:**
   - **`drive-tasks`**: the SUPERVISED conductor. Drive a board of ready tasks to exhaustion, build each with `agent-runner do task:<slug> --isolated`, review the diff yourself, merge, repeat. Requires the agent-runner CLI. You are present.
   - **`orchestrate`**: the META conductor, one rung ABOVE `drive-tasks`. Survey the WHOLE tree (observations / ideas / briefs / tasks / needs-attention), advance every autonomous rung, batch the genuine judgement residue to the human, fill gaps until tasks are READY, then delegate building to `drive-tasks`. Reach for this when you want "figure out what to work on AND drive it", not just "build the already-ready tasks".

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Observations piling up in `work/notes/observations/`**: **`triage-observations`**. Drain the inbox one note at a time, investigate each against current reality, recommend a disposition, the human decides, execute. Promotes notes into tasks/briefs/ADRs (composes `to-task`) or deletes them.

## Cross-cutting disciplines (model-invoked, so the agent may also reach for these itself)

- **`capture-signal`**: the REFLEX. The moment you NOTICE something off the current task's path (drift, a recurring failure, surprising external behaviour, an out-of-scope opportunity, a decision worth recording), record it into the right `work/` bucket before it evaporates. The INVERSE of `triage-observations`.
- **`review`**: the adversarial review discipline for any `work/`-protocol artifact (task, brief, code-vs-its-task, captured note). Emits a verdict; the caller routes it. Composed by `drive-tasks` / `orchestrate` / the review gate.
- **`surface-questions`**: GATHER the open-judgement residue for ONE item and EMIT questions; write nothing. The advance engine's surface-question rung (or the no-runner manual path). Composes `review` / `to-task` unchanged.
- **`promote`** (human-invoked): the pre-promotion checklist. Judge ONE staged item (`tasks/backlog/` / `briefs/proposed/`) — review + freshness + pool-readiness — and emit promote / keep-staged / drop. Writes/moves nothing; the human or the runner's `promote` verb does the move. The staging→pool review-gate discipline.
- **`answer-questions`** (human-invoked): the read-side mirror of `surface-questions`. Walk the open `work/questions/` sidecars, DRAFT answers to the factual ones for the human to ratify (cited to evidence), DEFER the genuine-judgement ones with context + a suggested default. Proposes; never finalises — the human is the clock.

## What this repo deliberately does NOT have

Matt Pocock's tracker-coupled skills have no place here. Their JOB is done by file-based equivalents, not disregarded:

- **`to-prd` becomes `to-brief`**, **`to-issues` becomes `to-task`** (write `work/` files instead of tracker issues).
- **`triage` (label state-machine) becomes `triage-observations`** plus folders-as-status plus the autonomy gate.
- **`setup-matt-pocock-skills` becomes `setup`.**

Matt's NON-tracker disciplines (`grilling`, `domain-modeling`, `codebase-design`, `diagnosing-bugs`, `tdd`, `prototype`, `handoff`, `improve-codebase-architecture`, `resolving-merge-conflicts`) are NOT superseded. Use them upstream, verbatim, alongside these.

## Note for autonomous runners

`agent-runner` execution does NOT load these `SKILL.md` files. It assembles its prompt from the vendored `work/protocol/` docs in-band. These skills are for the INTERACTIVE / orchestrating agent. A discipline that must reach the autonomous worker (e.g. TDD) belongs IN-BAND in the task body / CLAIM-PROTOCOL, not in a skill the CI worker can't see.
