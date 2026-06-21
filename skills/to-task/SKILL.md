---
name: to-task
disable-model-invocation: true
description: 'Slice a brief or plan into independently-grabbable, file-based work tasks using tracer-bullet vertical slices.'
---

# to-task

Turn a plan/brief/design doc into **tracer-bullet vertical tasks**, written as one markdown file per task into a repo's `work/tasks/backlog/` folder (the staging slot the runner promotes into the pool). This is the file-based equivalent of converting a plan into issues — the source of truth is **git markdown**, not an external issue tracker, so it stays versioned with the code and works offline.

This skill is the **producer** of `work/` items. The **runner** consumes them — `agent-runner claim`/`start`/`do`/`complete` walk a task claim → in-progress → done (driven across a backlog by the `drive-backlog` / `orchestrate` conductor skills). This skill defines the on-disk contract they share.

## When to use vs. not

- **Use** when slicing a `work/briefs/ready/*.md`, a design doc, or a plan into grabbable units for solo-with-agents (incl. parallel AFK) work.
- **Don't** use to _write_ the brief (that's a separate step — `to-brief`) or to _claim/run_ a task (that's the runner: `agent-runner claim`/`do`/`complete`, or the `drive-backlog` conductor). Don't introduce a shared index file or a status field — status is the folder (see [WORK-CONTRACT.md](work/protocol/WORK-CONTRACT.md)).

## Process

### 1. Locate / confirm the source

Work from a `work/briefs/ready/<slug>.md`, a design doc, or the conversation context. If the source is a path, read it fully. The `work/` folder lives **inside the target project repo** (versioned with its code), like the existing `tasks/` convention.

### 2. Explore the codebase (if not already)

Task titles and descriptions use the project's domain glossary. Respect ADRs / findings in the area you're touching.

**Check the brief against reality first (drift = a needs-attention signal).** A brief is a launch snapshot and may have DRIFTED from what has since landed (`tasks/done/`, ADRs, sibling tasks). Before slicing, verify its assumptions still hold. If it has drifted such that slicing it as-is would emit tasks built on a false premise, do NOT slice it: set `needsAnswers: true` on the brief with the discrepancy in its body (or fix a small certain factual error first). See WORK-CONTRACT.md “Drift is a needs-attention signal”. Never emit tasks from a stale spec.

### 3. Draft vertical tasks

Each task is a **tracer bullet** — a thin path through ALL layers end-to-end, not a horizontal slice of one layer.

- Each task delivers a narrow but COMPLETE path (schema → logic → API/UI → tests).
- A completed task is demoable/verifiable on its own.
- Prefer many thin tasks over few thick ones.
- Set the **two gate axes** ONLY where they apply (both default to OMITTED on most tasks): **`humanOnly: true`** = NEVER-for-agents BY NATURE (the NARROWED, de-overloaded DECIDED axis — secrets/release/security; survives even in the pool `work/tasks/todo/`); **`needsAnswers: true`** = unresolved questions block autonomous work (the DISCOVERED axis — list the questions in the task body). Omitted on either means "undeclared"; whether an agent may then auto-build is the _repo's_ `autoBuild` policy. Mark `blockedBy` for ordering. See [WORK-CONTRACT.md](work/protocol/WORK-CONTRACT.md) for the two-axis semantics, the predicate, and the `autoBuild` precedence.
  - **A task's `humanOnly` is decided from the nature of BUILDING THAT TASK — never inherited from the brief.** Evaluate each task on its own merits (does _building it_ genuinely need to be done by a human BY NATURE — secrets handling, release pipeline, hard security boundary, an AGENTS.md prohibition?), AS IF the brief's `humanOnly` field did not exist. (The two flags are disjoint — see §3b.)
  - **Do NOT stamp `humanOnly` to mean "a human should REVIEW this before the agent builds it"** — that is the POSITION's job, not the flag's. The runner BIRTHS tasks STAGED in `work/tasks/backlog/` (not eligible); a human promotes the approved ones into the pool `work/tasks/todo/`. Review-first is encoded by the staging position; `humanOnly` is reserved for the rare never-by-nature case. (Stamping `humanOnly` for review was the overloaded reading and is RETIRED — see WORK-CONTRACT.md "Task `humanOnly` is NARROW".)
  - **Do NOT be shy about `needsAnswers` — when genuinely unsure, FLAG, don't guess.** `needsAnswers` is cheap (a human clears it in seconds) and a confidently-underspecified task is expensive (an agent builds the wrong thing, convincingly). Empirically, defects concentrate in SLICING far more than in implementation: an ambiguous premise, an unresolved design fork, a "reuse X" where X's shape is unverified, or a seam you _assume_ exists — each is a `needsAnswers` with the open question written in the body, NOT a guess dressed as a spec. The asymmetry is the whole point: a false `needsAnswers` costs one human glance; a false confidence ships wrong-but-compiling work.
- **Prefer file-orthogonal tasks to minimise merge conflicts.** `blockedBy` encodes logical ordering, but two independent tasks that edit the SAME files will conflict when the second integrates after the first. Parallel agents make this real. So: slice along file/module boundaries where you can; and when two tasks are known to touch the same module, add a `blockedBy` to **serialize** them even if there's no strict logical dependency. The runner only rebases-or-surfaces conflicts (it never auto-resolves), so avoiding them at slice time is the cheap win.

### 3b. Brief gate vs task gate are DISJOINT + honour cross-brief `briefAfter`

- **`humanOnly` on a brief and `humanOnly` on a task are DISJOINT — they gate different verbs and DO NOT flow into each other.**
  - **Brief `humanOnly`** gates _slicing_: its ONLY effect is that an agent may not **auto-slice** that brief (even where the repo's `autoSlice` policy is on); a human must drive the decomposition. That is its entire meaning.
  - **Task `humanOnly`** gates _building_: it is decided per task from the nature of building that task (see §3), independently.
  - There is **NO inheritance, NO propagation, and NOT EVEN A HINT** from the brief flag to the task flags. A `humanOnly: true` brief can produce entirely agent-buildable tasks; an un-flagged brief can produce some `humanOnly` tasks. When setting a task's gate, ignore the brief's `humanOnly` entirely.
  - Likewise **`needsAnswers`**: on a brief it blocks auto-slicing until the questions are answered; on a task it blocks auto-building. Set a task's `needsAnswers` only when _that task_ has unresolved questions (list them in its body) — not because the brief had open questions (a brief with open questions should be resolved BEFORE slicing, not slice-inherited).
  - (A brief's body may still _describe_ which areas are judgement-heavy — use that as ordinary domain input when reasoning about a task's own build-nature, the same as any other brief prose; it is not a flag-setting shortcut.)
- **`briefAfter` (cross-brief order).** If this brief has `briefAfter: [other-brief]`, those briefs must already be SLICED (their tasks exist) before you slice this one — so this brief's tasks can reference the real slugs of those briefs' tasks in `blockedBy`. (The auto-slicer enforces this; a human may slice anyway but must then know the blocker slugs.) If a needed blocker brief is not yet sliced, slice it first or record the dependency and stop.

### 4. Quiz the user — OR (no human present) do a confidence check

**If a human is present** (the normal interactive path): present the breakdown as a numbered list — Title, the two gate axes, Blocked-by, and (if the source has them) which user stories it covers. Ask: granularity right? dependencies right? merge/split any? gates correct? Iterate until approved.

**If NO human is present** (an agent auto-slicing in CI): step 4 is replaced by a **confidence check**, because there is no one to quiz. Do NOT emit guessed tasks. The source brief should already be clear (the auto-slicer only runs on a brief that is not `humanOnly` and not `needsAnswers`). If, while slicing, ANY of {granularity, dependency order, a gate, a seam} is genuinely unresolved by the brief/ADR, do not guess: either set `needsAnswers: true` (with the open questions in the body) on the specific uncertain task, or — if the whole decomposition is unclear — stop and route the brief to needs-attention with the questions, rather than emitting a wrongly-cut task. Only emit tasks you would have gotten the human to approve.

### 5. Write the task files

For each approved task, write `work/tasks/backlog/<slug>.md` using [task-template.md](work/protocol/task-template.md). Create `work/` and `work/tasks/backlog/` lazily if absent. One file per task. Use a content-derived slug, never a counter. Fill `blockedBy` with the slugs of blocking tasks, and set the **required `brief`** field to the slug of the source `work/briefs/ready/<slug>.md` (so `covers` story numbers are unambiguous — see [WORK-CONTRACT.md](work/protocol/WORK-CONTRACT.md)).

### 6. Trim the brief to its durable framing (one-time)

The brief is a launch snapshot (see the `to-brief` skill). Now that the work is sliced, the brief's **technical detail is redundant** (it lives in the tasks) and is the part that would otherwise go stale. Do a ONE-TIME trim:

- The tasks now own _what to build_ (Implementation/Testing detail) — remove those sections from the brief.
- Any **durable rationale** worth keeping (the _why_ of a decision) is RELOCATED to an ADR (`docs/adr/<slug>.md`), not deleted.
- The brief settles to its durable framing: Problem / Solution / User Stories / Out of Scope (+ its launch-snapshot banner). Leave a one-line pointer that detail moved to tasks/ADRs.
- **Move the brief to `work/briefs/tasked/`** to record that it has been sliced: `git mv work/briefs/ready/<slug>.md work/briefs/tasked/<slug>.md` (residence in `work/briefs/tasked/` IS tasked-ness — the build-machine `tasks/done/` analogue for briefs, the sole signal). Do NOT add a `sliced:` frontmatter marker: that marker was removed from the protocol; the folder is the source of truth. (On the agent/runner path `do brief:<slug>` performs this move itself as part of its runner-owned integration commit; this manual step is for the human-driven, no-lock slicing path.)

This is a hand-off transition, not ongoing maintenance — after this single trim the brief is stable because the stale-prone part was relocated, not because it is kept in sync. (Nothing is lost: detail → tasks; rationale → ADR.)

**Git protocol:** do NOT commit/push — leave the work for the user to inspect. The one exception is the brief `briefs/ready/ → briefs/tasked/` relocation above, which is a `git mv` (so it is staged as a rename); leave every other new/edited file unstaged. Report the exact paths written (and the trimmed + relocated brief).

## The on-disk contract

The full `work/` layout, slug rules, and frontmatter are in [WORK-CONTRACT.md](work/protocol/WORK-CONTRACT.md). The claim/lifecycle protocol these files are designed to support (consumed by the runner — `agent-runner claim`/`do`/`complete`) is in [CLAIM-PROTOCOL.md](work/protocol/CLAIM-PROTOCOL.md) — read it so the files you emit are claim-ready, but this skill does not itself claim or run tasks.
