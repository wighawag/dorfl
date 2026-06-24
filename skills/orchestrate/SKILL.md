---
name: orchestrate
disable-model-invocation: true
description: 'The human-in-the-loop meta-conductor: survey the whole work/ tree, advance every autonomous rung, batch the judgement residue to the human, then build the ready tasks via drive-tasks.'
---

# orchestrate

**The conductor of conductors.** `drive-tasks` builds the _ready tasks_. `orchestrate` is the layer above THAT: it looks at the **entire** `work/` tree — observations, ideas, prds, tasks, needs-attention — works out **what can advance and what is stuck on a human**, does every autonomous rung it can, and turns the human into nothing but an **answerer of well-batched questions**, looping until the backlog of ready tasks is drained.

It is a **methodology skill** (prose you follow), like `to-task` / `review` — NOT a runner command. It is **protocol-native**: it works the `work/` tree by reading the contract files directly (frontmatter + bodies), not by leaning on runner commands to tell it the state. (The one place runner commands ARE used is building — which it hands to `drive-tasks`, the skill whose job is to drive the `agent-runner` CLI.) It composes:

- **`drive-tasks`** (`skills/drive-tasks/`) — to BUILD the ready tasks (you load and FOLLOW it for the build loop; it owns the runner-CLI mechanics).
- **`review`** (`skills/review/`) — to judge any artifact (task / prd / observation / code).
- **`to-task`** (`skills/to-task/`) — to task a ready prd into tasks (the `tasks/backlog` staging slot).
- **`promote`** (`skills/promote/`) — to judge a STAGED task/prd (`tasks/backlog/` / `prds/proposed/`) against its acceptance + destination before recommending its promotion into the pool.
- **`answer-questions`** (`skills/answer-questions/`) — to walk the open `work/questions/` sidecars, DRAFT answers to the factual ones for the human to ratify, and DEFER the genuine-judgement ones into the step-3 batch.
- **`to-prd`** (`skills/to-prd/`) — when an idea/observation has matured enough to become a prd.

## When to use vs. not

- **Use** when you have a populated `work/` and want the system to do _everything it can autonomously_ and then _ask you only at the real judgement residue_ — in one interactive sitting, with full visibility and agency; to answer "what needs me?" across the whole tree; as the human-driven alternative to the autonomous `advance` loop when you want to watch and steer.
- **Don't** use it just to build already-ready tasks (that's `drive-tasks` directly), just to task one prd (`to-task`), or just to review one artifact (`review`). Don't use it as the unattended daemon (`run`/`advance`). It is **always main-session and conversational** — its defining job is the live Q&A.

## Relationship to the autonomous `advance` engine

`orchestrate` is the **interactive, human-in-the-loop** way to drain a `work/` tree: it asks its questions conversationally, in the session, and you answer live. Its autonomous, file-mediated counterpart is the `advance` capability, driven by `run`/CI with `work/questions/` sidecars the human answers whenever they like. Same lifecycle drain, different mode: reach for `orchestrate` when the human is present and wants visibility + agency; the autonomous engine is for unattended draining. They share the same rung contract.

## Core invariant

**Advance every rung you can; for everything else, ASK — never invent an answer.** Each `work/` item has autonomous rungs (triage, task, build, promote, surface-question, answer/apply) and a judgement residue (ambiguity, design forks, `needsAnswers`, stale premises). Do the autonomous part; surface the residue as batched questions; apply the answers; repeat. The human's throughput is the only limit; everything else is automatic.

## The loop

### 1. SURVEY the whole tree (one read pass)

Read across ALL buckets and build a single picture of state + what each item needs to advance ONE rung:

- **`work/notes/observations/`** — untriaged signals. Each wants: promote to a task/prd/ADR? keep as a note? delete? (a judgement rung — compose `review`).
- **`work/notes/ideas/`** — incubating. Any matured enough to become a prd (`to-prd`)? Most are left alone (no readiness to force) — note them, don't push.
- **`work/prds/ready/`** — for each prd: is it already tasked (does it RESIDE in `work/prds/tasked/`)? `humanOnly`/`needsAnswers`? `taskedAfter:` satisfied? → **taskable now**, **blocked on a dep**, or **blocked on a human answer**. (Tasked-ness is folder residence, not a `tasked:` marker.)
- **STAGING** — `work/tasks/backlog/` (review-first tasks) and `work/prds/proposed/` (review-first prds), the items awaiting human promotion into the pool. NOT built/tasked here; they are a **promotion rung** (step 2, compose `promote`). Either folder may be absent when empty per the contract — treat a missing staging folder as "nothing awaiting promotion", not an error.
- **`work/tasks/ready/`** — the task dependency graph (READY / BLOCKED / GATED), AND each ready task's **freshness** (drifted vs current `tasks/done/`+code — same check `drive-tasks` step 1 does).
- **`work/questions/`** — open question sidecars (a `<type>-<slug>.md` with an unanswered entry). Each is an item PAUSED on an answer; classify each open question factual-vs-judgement for the answer rung (step 2, compose `answer-questions`). A missing/empty `work/questions/` means "no pending questions", per the empty-folder rule — not an error.
- **needs-attention** — stuck items (their per-item lock is `state: stuck`) + the recorded reason; each wants a human decision (requeue-continue / requeue-reset / re-scope / drop). Read them via `agent-runner status`/`scan` (which read the lock refs).

Produce a short **state map**: what's ready to build, what's taskable, what's triageable, and what's parked on a human.

### 2. ADVANCE the non-build rungs (no human needed)

Do the autonomous rungs that PREPARE work — i.e. everything EXCEPT building ready tasks (building is step 4, deliberately last, so all gap-filling happens first). In leverage order (the rung that unlocks the most downstream work first):

- **Taskable prds** → task them, NAMING the choice between the two paths that meet at the same `work/tasks/*` artifact (don't default to the conversational one by reflex):
  - **`agent-runner do prd:<slug>`** — the AUTONOMOUS, unattended path (gate-gated by `autoTask` + the prd's own gates; runner-owns-git; harness/model/gate from agent-runner config, don't hardcode). PREFER this for a **ready, agent-safe prd** (`humanOnly: false`, no open `needsAnswers`, `taskedAfter:` satisfied) — and it is the path to use when the intent is to exercise the runner.
  - **`to-task`** (the skill) — the CONVERSATIONAL, human-in-the-loop, protocol-only path (no agent-runner dependency). Use it for a **`humanOnly` / unclear / not-yet-ready prd**, or whenever a conversation is wanted. (`to-task` deliberately stays runner-agnostic — it never points BACK at `do prd:`; this routing lives HERE, in the runner-aware conductor, by design.)
  - The choice is "unattended run vs conversation", decided by the prd classification you already did in step 1 (`humanOnly`/`needsAnswers`/`taskedAfter`). A `do prd:` on a prd it cannot take (e.g. `humanOnly`) correctly REFUSES on the agent path — that refusal IS the protocol routing you to `to-task`.
  - Then **review the produced tasks** (compose `review`; the tasker's own review→edit loop also runs on the `do prd:` path). Newly-produced tasks feed back into the survey (they may be READY, or carry their own questions).
- **Staged items awaiting promotion** (`tasks/backlog/`, `prds/proposed/`) → run the **promotion rung**: for each, compose `promote` (review + freshness + pool-readiness gate) and emit promote / keep-staged / drop. A clear PROMOTE is recommended to the human (you never move it yourself — the runner's `promote` verb / the human does the `git mv`); a KEEP-STAGED with a fixable gap, or a judgement-call promotion, becomes a step-3 question; a clear DROP routes to the regime terminal. Promotion is the human review-gate, so the MOVE is always the human's/runner's — you surface the verdict.
- **Clearly-dispositionable observations** → triage them (route/keep/delete) where the disposition is obvious; the ambiguous ones become questions (step 3).
- **Open question sidecars** (`work/questions/`) → run the **answer rung**: compose `answer-questions` over the pending sidecars. It DRAFTS answers to the factual ones (each cited to its evidence) for the human to RATIFY — a ratified draft is a human-authored answer you then apply — and DEFERS the genuine-judgement ones into the step-3 batch. You never invent/finalise an answer (the human is the clock); you draft for ratification and surface the rest.
- **Apply any human answers** you already have (ratified drafts from the answer rung, plus answers from earlier in the session) → flip the relevant `needsAnswers`, fill the task/prd gap, which may make new items advanceable (re-run step 1's classification for them).

(Ready tasks are NOT built here — they accumulate for step 4, after the residue is resolved.)

Commit policy (matches the producer skills): **commit your own `work/notes/observations/` notes and small load-bearing forward-notes you plant in a task body** (these are contract-native protocol edits), plus the runner-owned transitions that `do prd:` / `do` / `complete` make themselves (the tasking transition, done-moves, PR merges). Do NOT hand-author-and-commit a full prd or a fresh TASK SET — producing those is `to-prd`/`to-task`' job, and per their convention they are left UNSTAGED for human review (you surface them; the human commits). Never sweep in unrelated source. Report everything you committed in the final summary. (Tasks that get BUILT are committed/merged by `drive-tasks` via the normal PR flow.)

### 3. ASK the residue — batched, conversational, never invented

Everything that needs judgement becomes a **question**. Do NOT ask one at a time and do NOT guess: **regroup all open questions into one efficient batch** (the discipline this skill is named for), each with:

- the item + the SPECIFIC question, inline context to answer without opening files, the consequence of each option, and a **suggested default** where you have a view.
- grouped/ordered by leverage (answer-unblocks-the-most first).

Present the batch, take the human's answers, then **apply them** (back to step 2 for the now-unblocked items). Iterate steps 1–3 until the only thing left is _building ready tasks_. Questions the human defers stay parked; you proceed with the rest.

> If the human prefers to answer later / asynchronously rather than inline, offer to persist the batch as a question file under `work/questions/<date>-batch.md` (the file-mediated fallback the autonomous `advance` engine also reads). Default is conversational.

### 4. BUILD the ready tasks (follow `drive-tasks`)

Once the survey + gap-filling have produced a set of READY tasks, build them by **loading and following the `drive-tasks` skill inline** (you are already in the human's session — `drive-tasks` runs its build→review→merge loop here, asking the human when it stalls, exactly as you do). Hand it the whole ready set; it re-runs its own freshness check + dependency ordering, so you do NOT need to pre-filter or pre-order beyond what your survey established. Its build-loop mechanics (the long `do` process, the interrupt footgun, the diff-review, merge) are ITS to own — don't re-derive them here.

Any task `drive-tasks` parks in its stuck-set (a drifted task, a Gate-3 judgement call) comes back to YOUR step 3 batch — same residue, same human.

### 5. LOOP until drained, then SUMMARISE

Repeat 1→4 until no rung can advance without a human answer you don't have. Then give the meta report:

- **Advanced autonomously** — observations triaged, prds tasked, tasks built+merged (PR numbers from `drive-tasks`'s own report).
- **What's now unlocked** — new ready tasks, newly-taskable prds, capabilities landed (the whole-tree view only this skill has).
- **Parked on the human** — the questions still unanswered / deferred, and exactly what each unblocks when answered.
- **Still stuck** — needs-attention items + the decision each awaits.
- **Suggested next sitting** — the smallest set of human answers that would unblock the most work.

## Pitfalls

- **Don't invent answers.** The one unforgivable move. A confident wrong answer to a judgement question produces drifted tasks that cost far more than asking. Ask.
- **Don't over-ask either.** Resolve from the code/ADRs what is genuinely a small certain factual gap; only the real judgement residue becomes a question (same discipline `drive-tasks`/the build agents use for tasks).
- **Commit observations + forward-notes; leave authored artifacts for review.** Your `work/notes/observations/` notes and small planted forward-notes are committed as you go (contract-native) and listed in the summary; a freshly-authored prd or task SET is left UNSTAGED for the human (the producer-skill convention). Don't sweep in unrelated source changes.
- **Building mechanics live in `drive-tasks`.** When you build (step 4), the long-running `do` process, the interrupt footgun (an abort does NOT kill the spawned agent), generous timeouts, flaky-gate retries, and the Gate-3 diff review are all `drive-tasks`'s — follow that skill for them; don't re-derive them here.
- **If your OWN run is interrupted, re-orient before resuming.** This loop can run long. On resume, do a fresh step-1 survey (state lives in the `work/` files + `git`, not your memory): re-read the buckets, check what is now in-progress / needs-attention / merged, and continue from the recomputed state — never assume the pre-interrupt picture still holds.
- **Ideas are incubating.** Don't force `work/notes/ideas/` toward readiness; surface the ripe ones, leave the rest.
