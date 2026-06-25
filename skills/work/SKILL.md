---
name: work
disable-model-invocation: true
description: "Router over this repo's work/-contract skills: ask which skill or flow fits your situation. The index you reach for when you can't remember which of setup / to-prd / to-task / drive-tasks / orchestrate / triage-observations / review / promote / surface-questions / answer-questions / capture-signal to use."
---

# Work (the router)

The other workflow skills are **user-invoked** (`disable-model-invocation: true`), so the agent will not surface them for you on its own. _You_ are the index. This skill is that index: it names the work/-contract skills and the flow between them, so you don't have to remember them all.

A **flow** is a path through the skills. Most work travels one **main flow**; the disciplines are cross-cutting and get composed _by file-path load_ from inside whichever skill is running (never by model auto-invocation). That file-path composition is how a user-invoked skill composes another user-invoked one here.

## The main flow: idea to built

1. **`setup`** (onboard / adopt the contract): onboard ANY repo onto the `work/` contract (scaffold an empty one OR migrate a populated one — auto-detected depth). Run once per repo, before the rest of the flow. Composes `to-prd` / `to-task` to convert existing material. **NOTE the boundary with `from-idea`:** `setup` is the bare "put this repo on the contract" act with no specific idea in hand; if you are starting **from a raw idea** you want captured as a prd, reach for the **`from-idea`** on-ramp instead (it RUNS `setup` for you, then `to-prd`). Empty-vs-populated is NOT the discriminator (setup handles both) — the discriminator is whether you are holding an idea to prd.
2. **`to-prd`**: turn the current conversation plus codebase understanding into a prd file in `work/prds/ready/`. The LAUNCH snapshot, not maintained.
3. **`to-task`**: task a prd (or plan/design doc) into independently-grabbable, file-based tasks (`work/tasks/`), using tracer-bullet vertical tasks.
4. **Build the ready tasks. Pick the conductor:**
   - **`drive-tasks`**: the SUPERVISED conductor. Drive a board of ready tasks to exhaustion, build each with `dorfl do task:<slug> --isolated`, review the diff yourself, merge, repeat. Requires the dorfl CLI. You are present.
   - **`orchestrate`**: the META conductor, one rung ABOVE `drive-tasks`. Survey the WHOLE tree (observations / ideas / prds / tasks / needs-attention), advance every autonomous rung, batch the genuine judgement residue to the human, fill gaps until tasks are READY, then delegate building to `drive-tasks`. Reach for this when you want "figure out what to work on AND drive it", not just "build the already-ready tasks".

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **A raw project idea, from scratch**: **`from-idea`**. The from-scratch entrance to the main flow: clarify a raw idea just enough to be prd-worthy, then sequence `setup` (onboard the `work/` contract) and `to-prd` (synthesize the idea into a prd in `work/prds/ready/`), landing on step 2 of the main flow ready to task. The thin orchestrator over the front door; it does NOT grill the idea (that is `grilling`) and is not itself the prd-producer (it calls `to-prd`). Pick `from-idea` when you hold an IDEA; pick bare `setup` when you just want a repo ON the contract (either works on an empty folder — the idea is the discriminator, not emptiness).
- **Observations piling up in `work/notes/observations/`**: **`triage-observations`**. Drain the inbox one note at a time, investigate each against current reality, recommend an outcome, the human decides, execute. Promotes notes into tasks/prds/ADRs (composes `to-task`) or directly deletes them (`git rm` / `dorfl drop`).

## Cross-cutting disciplines (model-invoked, so the agent may also reach for these itself)

- **`capture-signal`**: the REFLEX. The moment you NOTICE something off the current task's path (drift, a recurring failure, surprising external behaviour, an out-of-scope opportunity, a decision worth recording), record it into the right `work/` bucket before it evaporates. The INVERSE of `triage-observations`.
- **`review`**: the adversarial review discipline for any `work/`-protocol artifact (task, prd, code-vs-its-task, captured note). Emits a verdict; the caller routes it. Composed by `drive-tasks` / `orchestrate` / the review gate.
- **`surface-questions`**: GATHER the open-judgement residue for ONE item and EMIT questions; write nothing. The advance engine's surface-question rung (or the no-runner manual path). Composes `review` / `to-task` unchanged.
- **`promote`** (human-invoked): the pre-promotion checklist. Judge ONE staged item (`tasks/backlog/` / `prds/proposed/`) — review + freshness + pool-readiness — and emit promote / keep-staged / drop. Writes/moves nothing; the human or the runner's `promote` verb does the move. The staging→pool review-gate discipline.
- **`answer-questions`** (human-invoked): the read-side mirror of `surface-questions`. Walk the open `work/questions/` sidecars, DRAFT answers to the factual ones for the human to ratify (cited to evidence), DEFER the genuine-judgement ones with context + a suggested default. Proposes; never finalises — the human is the clock.

## What this system deliberately does NOT have

There is **no issue tracker and no label state-machine** — their job is done by `work/` files and folders-as-status:

- a feature spec is a **prd file** (`to-prd`), not a tracker epic; buildable units are **task files** (`to-task`), not tracker issues.
- signal triage is **`triage-observations`** over the `work/notes/observations/` inbox plus folders-as-status plus the autonomy gate, not a label workflow.
- onboarding a repo is **`setup`**, not a tracker integration.

General engineering disciplines that are NOT part of the `work/` contract — `grilling`, `domain-modeling`, `codebase-design`, `diagnosing-bugs`, `tdd`, `prototype`, `handoff`, `improve-codebase-architecture`, `resolving-merge-conflicts` — are complementary: use them alongside these skills whenever the work calls for them.

## Note for autonomous runners

`dorfl` execution does NOT load these `SKILL.md` files. It assembles its prompt from the vendored `work/protocol/` docs in-band. These skills are for the INTERACTIVE / orchestrating agent. A discipline that must reach the autonomous worker (e.g. TDD) belongs IN-BAND in the task body / CLAIM-PROTOCOL, not in a skill the CI worker can't see.
