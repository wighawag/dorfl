---
name: one-shot
disable-model-invocation: true
description: 'One-shot a whole project or goal, WITH structure: take one sentence of intent all the way to landed, gated code on the work/ contract (specs, tasks, builds, reviews, ADRs), delegating every rung to a fresh subagent and running to exhaustion without a human in the loop. Same contract as dorfl, no runner CLI required.'
---

# one-shot

**One shot, but structured.** The human hands you ONE goal ("build me a link shortener with a web UI", "make the CLI resumable") and then goes away. You bootstrap the repo if it does not exist, author the specs, task them, build, gate, review and land every task, record every decision you made along the way, and keep going until the goal's done-when is satisfied or nothing can advance without the human. The output is not just code: it is a repo on the `work/` contract whose specs, done records and ADRs explain what was built and why, so the human can audit a night's work in ten minutes instead of reading every diff.

The structure is what makes the autonomy safe. A one-shot agent with no contract produces a pile of code nobody can review. This skill spends the same tokens and leaves behind: a spec per slice, a task per vertical tracer bullet, a gated commit per task, a `## Decisions` block per non-obvious choice, an ADR per load-bearing one, and a `work/questions/` sidecar per thing it refused to decide alone.

It is a **methodology skill** (prose you follow). Its execution substrate is the harness's **subagent** facility plus plain `git`. **No `dorfl` CLI is required.** If the CLI is installed, `drive-tasks` is the better build loop and `run`/`advance` the better daemon; this skill is for the CLI-free case, and for the case where you want the WHOLE pipeline (goal to landed code) driven in one unattended pass.

## When to use vs. not

- **Use** to create a project from a sentence; to drive one named goal to completion unattended; when nothing is specced yet and you want the specs, the tasks and the code in one run; when you want every rung in a fresh subagent context so the main session stays a goal tracker rather than filling up with build detail.
- **Don't** use it to build an already-ready board when `dorfl` is installed (that is `drive-tasks`), to survey and drain a populated tree with no single goal (that is `orchestrate`), or to author one spec (`to-spec`). Don't use it for work whose core is a judgement you are not authorised to make (a product direction the human has not settled, a security boundary, anything touching money, credentials or publication). Those are not slow to do autonomously, they are wrong to do autonomously.

## The autonomy contract

The human's invocation IS the mandate. Absent an explicit narrower instruction, it grants you, for the duration of this goal:

- **Authority to DECIDE** anything reversible and internal: the stack within the stated constraints, the module boundaries, naming, the test seams, the spec decomposition, the task cuts, the defaults a task left unspecified.
- **Authority to COMMIT** the protocol's own transitions and the work the subagents produce: task and spec files, `work/` folder moves, builder branches, landing commits. Never `--force`, never sweeping unrelated changes in, never a push to a remote the human has not named.
- **Authority to ANSWER** an item's own open questions. When a tasker flags `needsAnswers: true` and the question is inside the mandate, you are the answerer: decide it, write the answer into the item body, clear the flag, and record it (below). A one-shot that stalls on every `needsAnswers` is not autonomous, and a contract flag that only a human may ever clear would make the flag a deadlock rather than a gate.

**The working rule is DECIDE, RECORD, CONTINUE.** Asking is not the safe default here, it is a failure to deliver; but deciding silently is worse than either, because it is unreviewable. So every judgement you make gets written down somewhere the human will find it (see the decision journal), and then you keep moving.

**The bar for what you decide is REVERSIBILITY times BLAST RADIUS, not difficulty.** In a fresh project almost nothing is hard to reverse: there are no users, no data, no dependents, and the whole tree is one `git revert` from gone. So decide freely and record. In an established repo the same choice may be expensive, so the bar rises: a choice that changes a public interface, a persisted format, or a behaviour other items already depend on is recorded as an ADR at minimum, and parked if it genuinely cannot be un-made.

**STOP only for these** (everything else you decide):

1. **External consequence**: spending money, publishing or deploying, sending anything to a third party, touching credentials or secrets, anything a stranger would experience.
2. **Destructive reach outside the goal**: deleting or force-pushing anything you did not create, touching another repo, mutating the human's other work.
3. **A fork the goal statement genuinely does not settle** and that determines the project's identity (is this a CLI or a web app, does it store user data at all). Not "which of two libraries", which you decide.
4. **Repeated failure**: the gate will not go green after the repair budget (below), or the same review finding survives two rebuilds. Three identical failures means the TASK is wrong, not the code, and grinding further burns tokens producing convincing garbage.
5. **A false premise under the goal itself**: the thing the human asked for rests on something that is not true about the codebase or the world.

**Stopping is per-item, never per-run.** A stop parks THAT item (a `work/questions/<type>-<slug>.md` sidecar plus `needsAnswers: true` on the body) and you immediately continue with the next independent item. The run ends only when nothing can advance. Parking is cheap, blocking is not.

## The split that makes this work

| The main session (you, the conductor) | The subagents (one per rung, fresh context) |
| --- | --- |
| Holds the goal, the state map, the decision journal | Hold ONE item and one rung's worth of context |
| Owns EVERY git transition (commits, `git mv`, branches, merges) | Do **no git at all** (the in-band rule from `CLAIM-PROTOCOL.md`) |
| Runs the acceptance gate (`verify`) and arbitrates verdicts | Produce artifacts (a spec, tasks, a diff) or a verdict |
| Decides order, parallelism, repair-vs-park, when the goal is done | Decide nothing outside their brief; STOP and report instead |
| Reads REPORTS (small, structured) | Read files, code, protocol docs (large, throwaway) |

**Two golden rules, both inherited from `drive-tasks`, both non-negotiable:**

1. **The conductor never implements.** The classic failure of a capable agent told to be autonomous is to write the feature itself and hand-roll the git dance, skipping the gate, the review and the record. Autonomy here means dispatching every rung to completion without asking permission; it does NOT mean doing the rung's work. Reading code to orient, arbitrate or plant a forward-note is right and expected. Crossing from reading into implementing is the line.
2. **Context discipline is the product, not a side effect.** Each rung is a subagent so that this session can still reason about the GOAL after twenty tasks have landed. Never pull a full diff, spec or file tree into this session when a child can read it and hand back forty lines.

## Kickoff: ONE round, then go

Say all of this in one message, then start. Do not open a dialogue.

1. **State the goal back** in one paragraph with an explicit **done-when**, plus the 3 to 6 **decisions you are taking on the human's behalf** (stack, shape, scope boundary) and the **scope you are NOT doing**. This is the human's single chance to correct you cheaply, so make it concrete and short. If they are already gone, proceed on it.
2. **Derive, do not ask:** the `verify` gate from `dorfl.json` if present, else from the repo's own tooling, else (greenfield) the one you are about to create. The integration mode: local commits on `main` for a fresh project, branch plus PR only if the repo already works that way. The licensing and convention defaults from the operator's environment.
3. **Check the preconditions** and say the result in one line: the working tree is CLEAN (if not, stop, that is the one hard precondition); a subagent roster is available (check it, use only executable agents); and you are the ONLY claimer (`git ls-remote origin 'refs/dorfl/lock/*'` empty, no `dorfl run` daemon or CI `advance` leg on this arbiter). This skill does not take lock refs, because with a single conductor there is nothing to arbitrate against, so that assumption must be checked rather than assumed.

## Phase 0: bootstrap (only when the project does not exist yet)

A one-shot project run starts before the contract exists. Do this yourself, it is scaffolding, not implementation:

1. **Create the repo and commit immediately.** `git init`, the operator's default license, a README holding the goal paragraph, `.gitignore`. Commit before anything else so every later rung is a reviewable diff rather than an undifferentiated dump.
2. **Scaffold from a template if the operator's environment provides one** (a template skill, a starter repo). A house template brings conventions, tooling and a working build for free, and hand-rolling one burns a subagent for a worse result. Otherwise scaffold the minimum by hand.
3. **Make the gate REAL before the first task.** The whole loop's quality floor is `verify`, so a project whose `verify` is `true` or missing has no floor at all. Get build, test and format wired and GREEN on the empty scaffold, then commit. This is the single highest-leverage thing in a one-shot run: every later gate, review and land depends on it.
4. **Adopt the contract** (follow the `setup` skill, Phase A): copy the protocol docs from the `setup` skill's own `protocol/` folder into `work/protocol/`, scaffold the `work/` skeleton, write `CONTEXT.md` (derive the glossary from the goal statement, you know the domain nouns) and `dorfl.json` with the gate you just made real. `setup` normally hard-stops for the human to ratify the plan and the gate; your kickoff message WAS that ratification, so do not re-stop.
5. **Record the bootstrap decisions as ADRs** (`docs/adr/`, per `ADR-FORMAT.md`) for the ones meeting the gate: hard to reverse, surprising without context, a real trade-off. The stack choice, the storage model, the architectural seam. `setup`'s rule that an ADR needs a human's why is about never FABRICATING a rationale for someone else's past decision; here YOU are the decider, so you have a genuine why and writing it down is exactly right.

## The goal record: `work/notes/ideas/<goal-slug>.md`

This conversation is the live tracker, but it is not durable: it will be compacted, interrupted, or resumed tomorrow, and an unattended run is precisely the case where nobody is watching when that happens. So the goal rests on disk, in the one bucket the contract has for a proposed, pre-spec opportunity: **`work/notes/ideas/<goal-slug>.md`** (editable, leaves by deletion when built or abandoned). Write it before the first child runs. It holds the goal paragraph, the done-when, the scope boundary, the gate command, and the mandate decisions from kickoff.

**It does NOT list the specs or tasks it spawned.** A file every item touches is the shared index the contract forbids (conflict-safety rule 2), and a hand-maintained child list goes stale within the hour. Each spec this goal spawns carries a `Goal: <goal-slug>` line in its body, and state is DERIVED:

```sh
grep -rl 'Goal: <goal-slug>' work/specs/          # this goal's specs, and by folder which are tasked
grep -l 'spec: <spec-slug>' work/tasks/*/*.md     # that spec's tasks, and by folder which are done
```

That derivation, never your memory, is the state map. On any resume, re-derive before acting.

> A frontmatter `goal:` field would be nicer than a body line, but frontmatter is protocol surface: if this proves out, propose the field as a contract change, never as a field you quietly start writing.

## The loop

### 0. ORIENT (every iteration, from files, never from memory)

Derive the state map: this goal's specs by folder (`specs/proposed` staged, `specs/ready` pooled, `specs/tasked` done), their tasks by folder (`tasks/backlog`, `tasks/ready`, `tasks/done`, `tasks/cancelled`), open `work/questions/` sidecars, items carrying `needsAnswers: true`, and what changed in `git log` since your last pass. In an existing codebase, spend ONE **scout** child on recon rather than reading the tree yourself.

### 1. GOAL into SPECS

Decide the decomposition yourself, it is goal-level judgement. Then dispatch one **spec-author child per spec**, briefed to apply the `to-spec` discipline and the `work/protocol/spec-template.md` shape, each carrying its `Goal:` line. Three contract rules the decomposition must obey:

- **One confidence tier per spec.** A spec is tasked atomically, so never mix a committed slice with a gated "beyond v0" direction in one spec. Split, and order with `taskedAfter:`.
- **Exploration specs are first-class.** If you do not yet know HOW to build a slice (unproven approach, unvalidated seam, unpicked library), the honest artifact is an EXPLORATION spec whose done is confidence plus a build plan, not a build spec whose tasks would be fiction. Signal it in the slug (`explore-*`). In an autonomous run this is the correct response to uncertainty: spike it on the narrowest real case, let the ANSWER be the deliverable, then write the build spec the spike de-risked. Uncertainty is a reason to explore, not to stop.
- **Agent-authored output lands in STAGING** (`work/specs/proposed/`), never straight into a pool.

Then **review each spec** with a read-only **reviewer** child (the `REVIEW-PROTOCOL.md` lenses, ending in the destination check: does this actually serve the goal?). Fan these out in parallel, they are read-only. A block sends the findings to a fresh author child; a genuine judgement above your bar parks the spec.

### 2. SPEC into TASKS

For each spec with no open questions above your bar and its `taskedAfter:` satisfied, dispatch ONE **tasker child** briefed to read `work/protocol/TASKING-PROTOCOL.md` and apply it whole: the §2a atomic decision procedure (task every story, or SPLIT, or REFRAME as exploration, never a subset), the §3 vertical tracer-bullet shape, and the file-orthogonality rule (tasks that avoid touching the same files are what makes the parallel waves in step 4 possible, so it earns its keep here). It writes into `work/tasks/backlog/` and trims the spec. It does no git.

Then dispatch a **reviewer** child over the task SET (the whole-set lens: graph coherence, gaps, overlap, does the set compose into the spec's goal?). Then do the git the tasker is forbidden from doing: commit the emitted tasks and `git mv` the spec into `work/specs/tasked/`. That move IS tasked-ness; the folder is the only signal.

Any task the tasker flagged `needsAnswers: true`: answer it yourself if it is inside the mandate (write the answer into the body, clear the flag, record it), park it if it is not. Do not build a flagged task.

**Build from staging; do not promote in order to build.** Promotion into a pool is what makes an item claimable by anyone, so promoting just to build opens a competition window for no benefit. Build in place from `work/tasks/backlog/`. Promote only to deliberately hand work to other claimers.

### 3. CHECK FRESHNESS before every build

A ready task is not necessarily a CORRECT task. Tasks are launch snapshots, and in a fast one-shot run the tree moves under them: a sibling task landed differently, an ADR superseded an assumption, the seam it assumes got built another way. Spot-check each task's load-bearing claims against `work/tasks/done/` and the code before dispatching. If it smells stale, do not build it: re-scope it yourself if the correction is obvious and inside the mandate (recording the change), else park it. Catching drift here is a grep; missing it costs a build plus wrong-but-compiling code.

### 4. BUILD in WAVES: build, gate, repair, review, land

Order the buildable tasks into dependency LAYERS. Within a layer, tasks with disjoint file sets run in PARALLEL, each in its own worktree; tasks sharing a hot file or un-landed scaffolding stay serial. Land strictly one at a time regardless, in dependency order, re-verifying each on the moved `main`. Parallel build, serial land. When in doubt, serial: the cost of serial is wall-clock, the cost of a bad parallel wave is a tangled tree you cannot review.

**4a. Isolate.** `git worktree add ~/dev/worktrees/<repo>/work/task-<slug> -b work/task-<slug> origin/main` (the house convention is `~/dev/worktrees/<repo>/<branch>`, never a sibling of the repo). One writer per worktree, always.

**4b. Dispatch the builder.** A write-capable child (`worker`), `cwd` set to that worktree. **The brief is the `## Prompt` wrapper from `work/protocol/CLAIM-PROTOCOL.md`, VERBATIM with the slug substituted.** Do not paraphrase and do not write your own: that wrapper carries the no-git boundary, the off-path capture rule, the `=== TASK-STOP ===` escape hatch, the `## Decisions` channel and the coherence check, and a paraphrase silently drops one. Add only what the child cannot know: its cwd, the gate command, and the report shape.

**4c. Gate it yourself.** Run `verify` in the worktree when the child returns. The conductor runs the gate; a builder's self-report that tests pass is not evidence. An EMPTY diff is a failure, not a pass: nothing changed makes the gate pass vacuously.

**4d. Repair, with a budget.** Red gate, blocking review or `TASK-STOP` does not go straight to parking in an autonomous run, because a human is not coming. Dispatch a FRESH repair child with the failure output and the findings, in the same worktree. Budget: **two repair attempts**, and the second is told explicitly to consider that the TASK may be wrong rather than the code. If it is still not green, park it (4f) and move on. Never spend a third: three identical failures is a signal about the task, and grinding produces convincing garbage.

**4e. Review, then arbitrate.** A read-only **reviewer** child over the diff against the acceptance criteria (`REVIEW-PROTOCOL.md`). Then you decide: clear approve lands, clear block goes to repair, and a coin-flip inside your mandate you DECIDE and record rather than park. Verify explicitly that any forward-note or "do not rename X" constraint the task carried was honoured; that is where builders silently drift.

**4f. Land or park.** LAND is the contract's primitive and is not optional: fetch `main`, rebase the branch onto it, **re-run `verify` on the rebased tree**, then advance. A clean merge is not evidence; only the re-verify on the tree that actually integrates is. Then, in ONE commit, land the work together with `git mv work/tasks/backlog/<slug>.md work/tasks/done/<slug>.md`, message `<type>(<slug>): <summary>; done`, and **transcribe the builder's `## Decisions` block verbatim into that done record** (the builder cannot write it, and that block is the only sanctioned home for build-time rationale). Remove the worktree. PARK instead when the repair budget is spent or the stop bar is hit: write `work/questions/task-<slug>.md` with the reason and exactly what a human must decide, set `needsAnswers: true` on the body, KEEP the branch (it is the recoverable work), and continue with the next independent task. Never force a failed task, never auto-resolve a conflict.

**4g. Re-orient.** The land may have unblocked a layer. Back to step 0.

### 5. STAY IN SCOPE

The goal's done-when is the boundary. Things you notice that are outside it do not become work in this run: an off-path signal is a `work/notes/observations/` note, a good idea is a `work/notes/ideas/` note, and both are captured in one line and left for the human. An unattended agent that follows its own good ideas returns something nobody asked for, and the scope boundary is the only thing standing between a one-shot and a runaway.

### 6. FINISH and DISCHARGE

The run ends when the done-when is satisfied, or when every remaining item is parked. If the done-when is met and every spec rests in `work/specs/tasked/` with every emitted task in `work/tasks/done/` or `work/tasks/cancelled/`, the goal note has stopped being a live signal: **delete it** (`git rm work/notes/ideas/<goal-slug>.md`). A note kept to narrate that it was handled is a backward artifact; the lasting product is the code, the done records and the ADRs.

## The decision journal: what makes the autonomy auditable

Autonomy without a record is just an unreviewable pile. Every judgement lands in exactly one of these homes, and none of them is this chat log:

- **A build-time choice inside a task** goes in the builder's `## Decisions` block, which YOU transcribe into the done record at land. One line each: what was chosen, why, what it touches.
- **A load-bearing choice** (hard to reverse, surprising without context, a real trade-off) is an **ADR** in `docs/adr/`. Stack, storage, architectural seams, protocol shapes. The bootstrap normally produces two or three.
- **An answer you gave to an item's open question** is written into that item's body as you clear its flag, so the next reader sees the question and the answer together.
- **A refusal** is a `work/questions/` sidecar naming the decision the human must make, the options, and your recommended default.
- **A scope boundary you enforced** is a `work/notes/ideas/` note, so the good idea you declined is not lost.

The final report then writes itself, and the human reviews DECISIONS rather than diffs.

## Dispatching subagents

- **One child per rung, one rung per child.** A brief that says "spec this, then task it, then build it" defeats the point: each rung has a different discipline doc, authority boundary and output shape.
- **Every brief is SELF-CONTAINED.** The child has no history. Give it: the objective in one sentence, the exact files to read (the protocol doc for its rung, the item path, the goal note), its cwd, its authority boundary including the no-git rule, the acceptance criteria, the report shape, and its stop condition.
- **Launch shape.** A single rung is a direct `{ agent, task, cwd }` child. Multi-step or parallel work is exactly ONE top-level workflow call that launches its children inside. Children never spawn children here.
- **Role to agent.** Authoring, tasking, building and repairing need a write-capable agent (`worker`); reviews, freshness checks and recon need a **read-only** one (`reviewer`, `scout`). Giving a reviewer write tools is how a review quietly becomes an unreviewed edit. Check the roster first, names differ per harness.
- **Make parallel briefs DISTINCT.** Cloned prompts with a slug swapped produce cloned reasoning. Each brief names its own seam, its own files and its own decision.
- **The report contract.** Ask every child to end with this and nothing longer:

```
## Result
done | stopped | blocked
## Artifacts
paths written or changed
## Decisions
(builders only) what I chose, why, what it touches
## Questions
what I could not resolve inside my brief
## Signals
off-path things I noticed and captured as notes/observations/
```

- **Interrupts.** Aborting your own tool call does not necessarily stop a child already editing files. After any interrupt, confirm the child is gone, inspect the worktree, and re-derive state from disk.

## The handover report

The last thing you produce, and for an unattended run it is the deliverable the human actually reads:

- **What the project now does**, in the human's terms, and whether the done-when is met.
- **What landed**: tasks by slug with one line each, and the commits to look at first.
- **Decisions I took for you**: the ADRs by title, plus any choice a reasonable person might reverse. Lead with the ones you would most want checked.
- **Parked**: each `work/questions/` sidecar, what it is waiting on, what it unblocks, and your recommended default.
- **Declined as out of scope**: the ideas captured as notes.
- **Where the quality floor is**: what `verify` actually covers and what it does not, so the human knows what the green tick did and did not prove.

## Pitfalls

- **Doing the work yourself.** The failure mode of this whole skill, and it is most tempting precisely when unattended: no one is watching, the task is small, and suddenly there is an unreviewed, ungated diff in the checkout.
- **Asking instead of deciding.** An unattended run that parks ten reversible choices has delivered nothing. Decide, record, continue; park only at the bar above.
- **Deciding without recording.** Worse than asking. An unrecorded decision is indistinguishable from an accident.
- **Grinding past the repair budget.** Two attempts, then park. A third rebuild of a task that is itself wrong is how a night's tokens vanish.
- **Letting the goal conversation fill with build detail.** If you are pasting diffs into this session, the tracker is dying. Delegate the reading, keep the verdict.
- **Skipping the re-verify on the rebased tree.** The only gate that matters is the one run on the tree that integrates.
- **Scope creep dressed as helpfulness.** Note it, do not build it.
- **Back-filling artifacts.** Never mint a task or observation to narrate work already done; completed work is a `tasks/done/` record plus its commit. Never open a `decisions-<slug>.md` note; rationale goes in the `## Decisions` block.
- **Forgetting that the tree is the memory.** On resume, re-derive; never continue from a remembered picture that git has since invalidated.

## Relationship to the other conductors

- **`drive-tasks`** builds a READY BOARD via the `dorfl` CLI (real claim locks, isolated job worktrees, the runner's gates). If the CLI is present and you only need tasks built, use it.
- **`orchestrate`** is the human-in-the-loop meta conductor: it surveys the whole tree and batches the residue to a present human. `one-shot` is its unattended, goal-scoped mirror image, which is why the batching step here becomes parking plus a handover report. If the human IS sitting there and wants to answer live, they want `orchestrate`, not this.
- **`from-idea`** clarifies an idea and stops at a spec. `one-shot` starts there and keeps going to landed code.
- **`run`/`advance`** are the real daemon when `dorfl` is installed: many goals, indefinitely, with locks. `one-shot` is one goal, one session, no locks.
