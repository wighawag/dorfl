---
name: drive-tasks
disable-model-invocation: true
description: 'The supervised conductor: build every ready work/ task in a loop via agent-runner, reviewing each diff and merging, until none can advance. Requires the agent-runner CLI.'
---

# drive-tasks

**Be the conductor, not the player.** `agent-runner do task:<slug> --isolated` already builds ONE task autonomously (claim → build agent → acceptance gate → optional Gate-2 review → PR) in a worktree off the arbiter. `drive-tasks` is the layer ABOVE: it looks at the _whole_ board, checks each ready task is still _fresh_, decides _what_ to build and in _what order_, drives `do` per task, then acts as a **third reviewer** (Gate-3, the conductor's own diff-vs-criteria pass — see step 4b) over each PR before merging it.

It is a **methodology skill** (prose you follow), like `to-task` / `review` — NOT a runner command. **Precondition:** it drives the **`agent-runner` CLI** over a repo using the **`work/` contract** — if neither is present, this skill does not apply. (It is the ONE skill that leans on the runner CLI directly; that is its job. The other skills stay protocol-native.) It composes:

- **`agent-runner do task:<slug> --isolated`** — the per-task worker (build + acceptance gate + optional PR/code-review gate), run `--isolated` ALWAYS (a job worktree off the arbiter, never the human checkout). The harness, model, acceptance gate, review mode, and integration mode all come from agent-runner CONFIG (per-repo / global) — do NOT hardcode them; `--isolated` is the one flag this skill pins, and any other flag (`--review`/`--merge`/…) is a user-confirmed per-run override only.
- **`review`** (`skills/review/`) — the discipline for your own diff-vs-criteria pass over each opened PR.
- **`to-task`** (`skills/to-task/`) — for the forward-note step and any re-tasking the human asks for.

It is **scoped to building ready TASKS.** The broader job — survey _everything_ (observations, ideas, prds, tasks), figure out what can advance, fill judgement gaps conversationally until new tasks are READY, then build them — is `orchestrate`, which delegates the BUILDING back to this skill. Keep `drive-tasks` focused on building ready tasks; hand the deep survey up to `orchestrate`.

## How it stalls (the stuck-set)

There is ONE loop. The skill **advances every task it can** and, whenever it hits a wall on a particular task, it does NOT halt — it records that task + its specific question in a **stuck-set** and moves to the next independent ready task (the [accumulate-don't-block rule](#the-accumulate-dont-block-rule)). Only when nothing more can advance does it deal with the stuck-set, and HERE is the only behavioural fork — it depends purely on whether a human is reachable in this session:

- **A human is present** (the normal case — you are running in their session): present the accumulated stuck-set as one [batched set of questions](#batching-the-questions), take the answers, and **continue the loop** (a task whose question is resolved becomes buildable again; one the human defers stays parked).
- **No human is reachable** (you were invoked to run unattended): do not block waiting — finish everything that can advance, then **stop and report the stuck-set** (plus the built/merged/needs-attention summary) as your result.

That is the whole difference; the loop, the selection, and the stuck-set are identical either way.

### Selection + isolation

This skill does its OWN intelligent per-task selection (graph order + freshness + diff review) and dispatches `do` **per chosen slug** — it never uses `do`'s auto-pick (that is `run`'s daemon mechanism, not a conductor's). It builds **one task at a time, end-to-end**, and it builds **`--isolated`, ALWAYS** — never in-place.

`do task:<slug> --isolated` builds in a per-job worktree off THIS repo's arbiter (the SAME isolation `run` uses), inferring the arbiter from cwd. The human checkout is **never touched**: no dirty-tree refusal, no claim/done-move churn in your tree, no entanglement with the human's (or your own) uncommitted work, no rebuild-the-dist-mid-drive dance. The conductor is a pure observer of the arbiter. (`do --remote <url>` is the same isolation against a FOREIGN repo with no checkout; `--isolated` is its same-repo sibling.)

The ONE consequence to respect: an isolated build reads the task + its `blockedBy` deps from the **arbiter's `main`**, so a **local-only / un-pushed task is INVISIBLE** to it. Do NOT fall back to in-place for such a task — **push it (and its deps) to the arbiter first** (the arbiter is the source of truth; a task that isn't on it isn't ready to drive). There is no in-place mode in this skill.

The loop, selection, freshness check, Gate-3 review, and stuck-set are exactly as described below; `--isolated` is simply the standing build mode.

## When to use vs. not

- **Use** to take a `work/tasks/todo/` from "N ready tasks" to "no ready task can advance", building + reviewing + merging each, in dependency-and-practical order; to conduct the agent-runner worker through a phase of task-building; as the building engine `orchestrate` delegates to.
- **Don't** use it as the unattended daemon — that's `run` (genuine parallelism, no human). `drive-tasks` is **one task at a time, end-to-end**. Don't use it to _author_ tasks from scratch (that's `to-task`), or to _task prds / triage observations / fill judgement gaps / answer scattered open questions across the whole tree_ (that's `orchestrate`). Don't use it to FORCE a blocked task — it respects the gate.

## The golden rules (do not violate)

1. **One task at a time, end-to-end** (build → Gate-3 review → merge) so each merge unlocks the next cleanly and rebases stay trivial. Parallelism is `run`'s job.
2. **Never force a failed task.** A red gate / Gate-2 block / rebase conflict routes the item to needs-attention (its per-item lock is marked `state: stuck`) — leave it there, branch preserved, skip its dependents, continue with independent ready tasks, report it at the end.
3. **Capture, don't fix-in-place, off-path findings.** Spot drift outside a task's scope → write a `work/notes/observations/` note (and COMMIT + PUSH it when a later build depends on it — see rule 5), don't expand the task.
4. **You merge the approval.** GitHub refuses `gh pr review --approve` on a PR whose commits are under your own identity — so post the verdict as a PR **comment** (`gh pr comment <n> --body-file …`, lead with `APPROVE ✅` / `BLOCK`), then `gh pr merge <n> --squash --delete-branch`. The comment + merge IS the approval.
5. **Commit + PUSH your own `work/notes/observations/` notes before they need to matter.** Because builds are `--isolated` (off the arbiter), a dirty local tree does NOT block dispatch — but an un-pushed note or task is INVISIBLE to an isolated build until it lands on the arbiter. So commit your contract-native notes (append-only, low-risk) AND push them when a soon-to-build task depends on them being on `main` (e.g. a forward-note planted in a task body — step 2). Report what you committed/pushed in the summary. **What a conductor commits:** its own `work/notes/observations/` notes; a load-bearing **forward-note it plants in a task body** (step 2 — it MUST be committed to take effect before that task's `do`, and it is a small protocol-mechanical edit, not authored content); and the protocol's own moves the runner/`do`/`complete` make (claim reverts, done-moves, PR merges). It does NOT hand-author-and-commit a full prd or a fresh task SET — producing those is `to-prd`/`to-task`' job and they are left for human review. Report every commit in the summary.
6. **Accumulate, don't stall.** When ONE task is stuck or needs a judgement call, write it into the stuck-set and move to the next INDEPENDENT ready task — never block the whole loop on one item. When nothing more can advance, surface the stuck-set: ask the human if one is present, else report it. See [the rule](#the-accumulate-dont-block-rule).
7. **Never touch the target checkout; be checkout-agnostic.** Driving is a side-effect-free observation of the arbiter, so as a side-effect of driving you perform NO git mutation in the target repo's working checkout — no `git switch`/`checkout -B`/`branch -D`/`reset`/`rebase`/commit in the human's working tree. If you need a working tree for a cheap verification (e.g. re-run a task's own tests off its pushed branch), use a THROWAWAY clone / the job worktree / a temp dir — NEVER the human checkout. The human's uncommitted work and current branch are sacrosanct; leave the tree exactly as you found it. And because you need only the arbiter (a URL/remote) + `gh` + a scratch area, you can RUN FROM ANYWHERE: resolve the arbiter EXPLICITLY rather than assuming `cwd` is the repo, and if `cwd` happens to BE the human's checkout, treat it as READ-ONLY. Your own `work/notes/observations/` note commits (rule 5) go to the arbiter without dirtying the working tree. (UNLESS the human explicitly asks to drive in-place in a specific checkout.) This is the same arbiter-is-truth posture `do --remote`/`run` already use; the repeated `git rebase origin/main` reconciliations a checkout-bound drive needs are the symptom this rule removes.

## The accumulate-don't-block rule

The loop's job is to **advance as much as possible**, not to halt at the first judgement call. Whenever you hit a **wall** on a task —

- it looks **stale/drifted** (the freshness check in step 1 fires),
- a **forward-note** seems needed but you're unsure it's wanted,
- a **Gate-3 review** surfaces a genuine judgement call (a maybe-blocking nit, an ambiguously-met criterion), or
- the task is otherwise ambiguous / rests on an unresolved decision

— do NOT stop the loop. **Record the item + the specific question in a STUCK-SET** (a running list you keep for the session), SKIP that task (and its dependents), and **continue with the next independent ready task.** Only when nothing more can advance do you deal with the stuck-set:

- **A human is present** → present the stuck-set as a [batched set of questions](#batching-the-questions), take answers, and resume the loop (a task whose question is resolved becomes buildable again; one the human defers stays parked).
- **No human reachable** → finish all you can, then stop and report the stuck-set (+ the built/merged/needs-attention summary) as your result; do not block waiting.

Either way the discipline is the same: do as much as can be done, then surface the residue in ONE batch — never dribble out one question at a time, never stall the whole loop on a single item.

## Recovering a needs-attention item (requeue)

When a task has routed to needs-attention (a red gate / Gate-2 block / rebase conflict / a build-time STOP marks its per-item lock `state: stuck`), its body carries the reason and its `work/<type>-<slug>` branch is **preserved on the arbiter** — nothing is lost. Whether you can re-drive it depends on the reason:

- **A fixable problem the agent can resolve on a retry** — a real bug the gate caught, a scoping miss, a flaky-test red — is a CONDUCTOR move, not a human question. Recover it with **`agent-runner requeue <slug> --arbiter origin`** (DEFAULT = keep + continue: releases the stuck lock; the body is already resting in the pool `tasks/todo/`, and the branch is left UNTOUCHED so the next claim CONTINUES from its tip). Optionally add a precise handoff with **`-m "<what to fix>"`** (appended to the body). Then `do task:<slug>` again: the re-claim CONTINUES from the kept branch, and the merged `agent-prompt-continue-context` puts the prior work + the needs-attention reason
  - your `-m` note into the agent's prompt — so it BUILDS ON the good code and fixes the gap rather than restarting.
- **A genuine human-decision block** — the task is ambiguous / drifted / rests on an unresolved fork — is NOT something a retry fixes. Leave it parked; it is a stuck-set question (ask it if a human is present, else report it). Do NOT requeue a task whose premise is wrong — re-scope it first (that is `orchestrate`/human work).
- **`requeue --reset`** (DISCARD + fresh: deletes the remote branch first, then releases the lock so the next claim starts CLEAN) is for when the kept work is worthless. It is guarded and NEVER the default — only on an explicit human call; the conductor's default recovery is keep+continue.

AFTER any requeue, re-sync (`git fetch && pull --rebase`) so the re-`do` claims off the latest main. A requeued-and-rebuilt task then flows through the normal step-4 BUILD → REVIEW → MERGE.

> **Let `do` re-drive a recovered branch — do NOT hand-roll a parallel `pr/<slug>` branch.** When a flake-recovered task's `work/<type>-<slug>` branch already holds green work but needs only a small lifecycle fixup before its PR (release the stuck lock, strip the runner's "aborted/needs-attention" commit subjects), the right move is `requeue` (keep+continue) + re-`do`: the re-claim continues from the kept branch tip and the runner ITSELF opens the PR — no manual PR at all. If you genuinely must fix up by hand, commit the fixup **ON the existing `work/<type>-<slug>` branch** and PR that branch (`gh pr create --head work/<type>-<slug>`). NEVER spin a separate `pr/<slug>` branch off `main` and re-apply the tree: it **orphans** the canonical `work/<type>-<slug>` branch on the remote (it then has to be remembered and hand-deleted — easy to miss) and **discards** the branch's real history for mere cosmetic single-commit tidiness. One branch, its own history, no orphan.

## The loop

### 0. ANALYSE the task set + dependency graph

Read every `work/tasks/todo/*.md` frontmatter (`slug`, `blockedBy`/`deps`, `needsAnswers`, `humanOnly`, `prd`, `covers`) and the `work/tasks/done/` set. Build the graph:

- **READY** = every `blockedBy` is in `work/tasks/done/` AND `needsAnswers !== true` AND `humanOnly !== true`. (BOTH gate fields exclude a task from READY: `needsAnswers` means open questions a human must answer first; `humanOnly` means a human must DRIVE it. Check BOTH in the frontmatter scan, not just `needsAnswers`. A `humanOnly` task dispatched to `do` will rightly STOP at build time, wasting a claim/surface cycle, so catch it UP FRONT.)
- **BLOCKED** = a `blockedBy` is still in the pool `tasks/todo/`, held (in-progress on its lock), or stuck (needs-attention on its lock).
- **GATED** = `needsAnswers: true` OR `humanOnly: true` (needs a human first, by question or by drive-ownership; NEVER agent-buildable; list it but do not build it, even once its deps land). The agent-buildable READY set is the tasks that are neither blocked nor gated by EITHER field.

(A task in the STAGING slot `tasks/backlog/` is review-first, awaiting a human's promotion into the pool `tasks/todo/`; it is NOT in the READY set — surface it, don't build it.) Note which tasks **unlock the most downstream work** when they land — those go first.

> **This is the DEFAULT and it does NOT change:** the READY set is computed from the agent POOL `work/tasks/todo/`, and `work/tasks/backlog/` is review-first STAGING the conductor does NOT build (it surfaces those, it never dispatches `do` against them). Unless the caller explicitly opts into the drive-from-backlog mode below, behave exactly as documented above.

#### Opt-in: drive tasks from `tasks/backlog/` (the staging folder)

**OPT-IN ONLY — never the default.** When, and ONLY when, the **caller EXPLICITLY instructs** this skill to drive tasks from the staging folder `work/tasks/backlog/` (e.g. "drive the tasks in backlog/", "build the backlog tasks <slugs>", an explicit drive-from-backlog mode), the conductor builds those staged tasks too, using the **identical** loop, selection, freshness check, Gate-3 review, requeue recovery, and stuck-set discipline described in this whole skill — the ONLY change is WHERE the READY set is read from. Absent that explicit instruction, `tasks/backlog/` stays review-first staging you surface but do NOT build (the default above). If you are unsure whether the caller meant this, do NOT assume it — treat the staging folder as review-first and ask.

In this mode the READY computation reads **`work/tasks/backlog/`** instead of `work/tasks/todo/` (or, if the caller explicitly says to drive BOTH, the UNION of `tasks/backlog/` + `tasks/todo/`). Everything else is unchanged:

- **READY** = every `blockedBy` is in `work/tasks/done/` AND `needsAnswers !== true` AND `humanOnly !== true` — the SAME gating, just over the staging set (and, when the caller scopes the run to specific slugs, restricted to those). `blockedBy` still resolves against `work/tasks/done/` exactly as in the default; deps held in `tasks/backlog/` (or `tasks/todo/`) that are not yet `done/` are BLOCKED, so honour the same dependency ordering.
- **GATED** (`needsAnswers`/`humanOnly`) and **BLOCKED** mean exactly what they mean above; a `humanOnly`/`needsAnswers` staged task is NEVER agent-buildable here either.
- The build is the SAME `agent-runner do task:<slug> --isolated`, the SAME Gate-3 diff-vs-criteria review, the SAME merge-via-PR-comment, and the SAME accumulate-don't-block stuck-set. (The staged task must be on the arbiter's `main` for the isolated build to see it — per [Selection + isolation](#selection--isolation), push it and its deps first if they are local-only.)

This mode exists so a caller who has already decided a set of staged tasks is good can have the conductor build them straight from `tasks/backlog/` without first promoting them into `tasks/todo/`. It does NOT relax the review-first nature of staging for any OTHER caller or run; it is a per-invocation, explicitly-requested override of the read location only.

### 1. CHECK freshness / up-to-dateness of each ready task

**A ready task is not necessarily a CORRECT task.** Tasks are authored ahead of time; by the time one is ready its load-bearing premises may have **drifted** — something it says is "unconsumed / not yet built / still TODO" may already have landed in `work/tasks/done/` + the code. Building a drifted task wastes a full `do` run (the build agent will rightly STOP, or worse, churn working code) — and the conductor, which sees the WHOLE graph, can catch it cheaply UP FRONT.

For each ready task, before dispatching `do`, sanity-check its premises against current reality:

- Read the task's "What to build" + any **drift-check / READ-FIRST** block (tasks often name the exact files + the premise to confirm).
- Spot-check the load-bearing claims: if it says "X has zero consumers", "Y still uses the old path", "the seam is unwired" — grep `work/tasks/done/` + `src/` to confirm that is STILL true. Recently-merged tasks are the usual culprit (a convergence that already happened, a verb already renamed, a primitive already adopted).
- Glance at `work/notes/observations/` for a `*-premise-drifted` / drift note naming this task.

If the task still holds → proceed. **If it smells stale → it's a WALL**: record it in the stuck-set with the specific premise that no longer holds + a suggested re-scope, SKIP it (per the accumulate-don't-block rule), and move on. (This catches drift cheaply up front. The build-time backstop also exists: a task that IS drifted and slips past this check makes the build agent raise a STOP — the runner routes it to needs-attention with the agent's reason, skipping the wasted gate — but catching it here saves the whole `do` run.)

This is also the natural place for a **light look-ahead**: skim `work/prds/ready/` (and, if cheap, `work/notes/observations/` + `work/notes/ideas/`) for what's coming — it informs the forward-notes in step 2. The DEEP survey-everything pass is `orchestrate`'s job, not this skill's; keep this shallow.

### 2. CHECK for forward-looking notes a soon-to-be-tasked prd will need

Before building, scan `work/prds/ready/` for a prd that will be tasked soon and whose design **depends on the shape** of tasks you're about to land (a `prdAfter:` / "builds on the X convergence" relationship). If a ready task should carry a `> FORWARD-POINTER` note so that prd can be tasked later WITHOUT amending the prd (e.g. "keep this loop/tick separable", "keep `-n` sequential", "don't rename X — the advance migration owns it", "shape this as a named callable unit"), **add the note to the task body now** (compose `to-task`' forward-note discipline). These notes are load-bearing: they prevent the downstream prd from needing changes. A note you're CONFIDENT about: plant it and COMMIT it (it must land before that task's `do` to take effect; per rule 5 this small protocol edit is committed, unlike authored artifacts). If a note is non-trivial or you're unsure it's wanted, that is a WALL → record it in the stuck-set (surface it with the batch when the loop stalls) rather than planting a guessed note.

> This is the step that earns the conductor its keep — a per-task `do` agent only sees its own task; only the conductor sees the whole graph + the pending prds and can plant the cross-task notes.

### 3. SELECT the tasks + a practical order

From the READY set, order by: (a) **dependency** (a task that unlocks others first), then (b) **practical** concerns — serialise tasks that edit the SAME hot file (e.g. one big `cli.ts`) so rebases stay trivial; prefer the order that keeps each subsequent claim rebasing cleanly off fresh `main`. State the planned order (and why) before you start.

### 4. For EACH fresh, ready task, in order — BUILD → REVIEW → MERGE

**4a. Build it** — ALWAYS `--isolated`:

```sh
agent-runner do task:<slug> --isolated
```

**`--isolated` is the one flag this skill mandates. Everything else — review mode, integration mode, harness, model — is LET TO CONFIG** (resolved `flag > env > per-repo > global > default`), so do NOT hardcode `--review`/`--propose`/`--merge` here: the repo's `.agent-runner.json` decides, and `do --propose` is already the default. (`--isolated` reads the target repo's committed `.agent-runner.json` from the arbiter's main, so per-repo `harness`/`verify`/`noPR`/`review` apply automatically — no `--harness`/env workaround.) **At the START of a drive, CONFIRM the run mode with the user** — do they want Gate 2 (`--review`, off by default — the human-first family default), and propose vs merge integration? — and add `--review` / `--merge` / etc. as explicit per-run OVERRIDES only when the user asks; otherwise let config drive every build of the drive.

After a failed/aborted isolated run, a stale job worktree can linger and block the next build's mirror fetch — run `agent-runner gc` (or `gc --force --yes` once you've confirmed the work is safe on the arbiter) to reap it before continuing. Use a **generous timeout** — `do` runs a build agent + the full gate + (if enabled) the Gate-2 review and can take well over an hour for a big task. If you interrupt it, KILL the spawned `do`/agent process tree explicitly (an abort of your wrapper does NOT stop the child); the isolated worktree is then reaped/recovered via `gc` + the kept arbiter branch (your checkout is untouched).

- **Non-zero exit** (red gate / Gate-2 block / rebase conflict) → the item is now in needs-attention (its lock is `state: stuck`) with its reason in the body and its branch preserved on the arbiter. STOP that task (golden rule 2), skip its dependents, move to the next INDEPENDENT ready task. If the reason is a FIXABLE problem (not a human-decision block), it is recoverable IN-LOOP via `requeue` + re-`do` (continues from the kept branch) — see [Recovering a needs-attention item](#recovering-a-needs-attention-item-requeue); otherwise it becomes a stuck-set question.

**4b. Gate-3 — review the opened PR yourself** (the conductor's own review, the third review layer after Gate-1 = `do`'s acceptance gate and Gate-2 = `do`'s PR/code-review gate — the discipline that makes you a real reviewer of the result, not a rubber stamp). `do` already ran Gate-1 AND Gate-2 before opening the PR, so **trust that green** — do NOT re-run the (potentially slow) acceptance gate here. Your job is the JUDGEMENT the gates can't fully do: does the diff actually deliver THIS task?

- Read the **diff against the task's acceptance criteria** — tick each criterion (apply the `review` skill's lenses + destination check).
- **Verify every drift note / forward-pointer / must-fix-before-consume** the task carried was actually honoured (these are exactly where a `do` agent silently drifts — e.g. "don't rename X", "keep it sequential", "make the omitted path REFUSE"). Grep the branch to confirm.
- Read the gate-generated `work/notes/observations/review-nits-<slug>-*.md` and triage each nit (blocking? benign? a real off-path finding worth its own observation?).
- **Verdict:** if a drift note was violated or an acceptance criterion is unmet → **BLOCK** (comment the blocking findings; do NOT merge). If it is a clear BLOCK or clear APPROVE, act on it. If it is a genuine **judgement call** (a maybe-blocking nit, an ambiguously-met criterion), that is a WALL → record it in the stuck-set and skip (do not merge on a coin-flip), per the [accumulate-don't-block rule](#the-accumulate-dont-block-rule). Otherwise **APPROVE**.

  > Dropping the Gate-3 re-verify is SOUND by default: `do`'s OWN acceptance gate runs against the merged artifact, because the `freshWorktreeGate` config (ON by default) runs `prepare`+`verify` in a CLEAN throwaway worktree cut from the work branch REBASED onto `<arbiter>/main` (the exact tree that integrates) — closing the checkout-vs-pushed-tree divergence at the root, so there is no separate per-task re-verify to re-introduce. (The opt-out `--no-fresh-worktree-gate` reverts to the old in-build-worktree pre-rebase gate, where that rare divergence is consciously accepted.)

**4c. Merge** (golden rule 4):

```sh
gh pr comment <n> --body-file /tmp/approve-<n>.md     # leads with APPROVE ✅ + per-criterion reasoning
gh pr merge <n> --squash --delete-branch
```

Use `--body-file` (PR bodies are backtick-heavy and break inline `--body` shell quoting).

> PROVIDER ASSUMPTION: the verdict-as-PR-comment + `gh pr merge` flow above assumes **`--propose` mode + a GitHub arbiter** (the only review-surface this skill knows today). In `--merge` mode `do` integrates directly with no PR — then your Gate-3 diff review still applies, but you record the verdict in the task/observation, not a PR comment, and there is nothing to `gh pr merge`. A non-GitHub arbiter has no `gh` at all. Making the approval/merge surface provider-agnostic (a likely future `agent-runner` command, e.g. an `approve`/`land` verb) is NOT built yet; until then this step is GitHub-propose-specific — adapt the merge mechanics to the repo's actual integration mode.

**4d. Re-sync + re-evaluate:** recompute the READY set from the ARBITER (read-only) — `git fetch origin` and read the refreshed `origin/main` `work/` state (or use the mirror-side scan). You do NOT need to mutate a working checkout to do this:

```sh
git fetch origin   # then read origin/main's work/ state to recompute the ready set
```

Builds run `--isolated` on the arbiter, NOT your checkout, so a `git fetch` against the arbiter is all you need to RECOMPUTE the READY set — there is no local rebase dance, no branch switch, and no clean-tree precondition for the next dispatch (per golden rule 7, do not `git checkout`/`pull` INTO the human's working tree as a driving side-effect; if you are driving from a scratch clone you own, fast-forwarding IT is fine). If the next `do` runs from a BUILT copy of agent-runner (e.g. a local checkout of this very repo), rebuild it so the merge you just made is in the binary the next `do` invokes. The merge landed `work/tasks/done/<slug>.md` on `main`; any task blocked only by it is now unlocked. Recompute the READY set (steps 0–1, including a fresh freshness check on newly-unlocked tasks) and continue.

### 5. CONTINUE until nothing can advance

Repeat step 4 until no ready task can advance (the READY set is empty OR every remaining ready task is parked in the stuck-set). THEN deal with the stuck-set ([the rule](#the-accumulate-dont-block-rule)): if a human is present, ask the batched questions and resume the loop from the answers; if not, report the stuck-set and stop.

### 6. SUMMARISE — the conductor's report

End with a structured rundown (this is a first-class deliverable, not an afterthought):

- **Built + merged** — each task with its PR number + a one-line note on any drift/forward-pointer/must-fix it honoured (`do` ran the acceptance + review gates; you reviewed the diff).
- **Routed to needs-attention** — each, with the EXACT blocking reason, whether the agent produced no code vs. a real bug the gate caught, and that the branch is preserved on the arbiter (recoverable via `requeue` + re-claim, or `work-on`).
- **Still blocked / gated** — what remains and on what (a needs-attention item? a `needsAnswers` human gate?).
- **What's now UNLOCKED in the project** — new commands, new behaviours/capabilities, retired verbs, and crucially **which prds are now taskable / unblocked** by what landed (the cross-cutting view only the conductor has).
- **Observations filed** (committed as you go, per rule 5) — list them so the human can find them in `git log`.
- **Housekeeping** — any direct-to-`main` chore commits you made (claim reverts, forward-notes), so the human can see them in `git log`.

When you run unattended (no human reachable), this report (plus the stuck-set) is your RESULT to whoever invoked you, not a message to a human.

## Batching the questions

When the loop stalls with a non-empty stuck-set, do NOT ask one question at a time. **Regroup the stuck-set into a single, well-organised batch** (the way a good conductor surfaces everything at once for one efficient answering pass):

- Group by item, each with: the task, the SPECIFIC question, why it's stuck (stale premise / uncertain forward-note / review judgement call), enough inline context to answer WITHOUT opening the file, and a **suggested default** where you have one.
- Order by leverage (a question whose answer unblocks the most downstream work first).
- If a human is present: present the batch, take answers, resume the loop (resolved → buildable again; deferred → stays parked). If not: this batch is the residue you report and stop on.

The batch is conversational (asked) or reported (unattended), not a written file.

## Beyond tasks

This skill builds READY TASKS. Two things sit ABOVE it, sharing its loop shape:

- **`orchestrate`** — the human-in-the-loop META conductor: surveys _everything_ (observations / ideas / prds / tasks), advances what it can (tasking prds, triaging), fills judgement gaps with the human conversationally until new tasks are READY, then **delegates the building to THIS skill** and surfaces the stuck-set to the human.
- **`advance`** — the AUTONOMOUS, file-mediated version of the same idea, driven by `run`/CI with a `work/questions/` sidecar. `drive-tasks` + `orchestrate` are the human-agency, synchronous siblings of `advance`; they share the same tick contract.

The conductor is **tick-agnostic**: today the per-item action is `agent-runner do task:<slug>` (build a task); as `advance`-class ticks land (task / triage / surface / apply), the SAME loop applies — only the per-item command in step 4a changes. (Mirrors the loop/tick split in `run`: the conductor is a _loop_; the per-item command is the _tick_.)

## Pitfalls

- **The interrupt footgun.** Aborting your `do` wrapper does NOT kill the spawned agent — it keeps editing files in the background. After any interrupt, `ps`-find + kill the `do`/agent/`tsc` tree, discard its partial edits, and release the claim (the runner reverts the lock; the body is already resting in the pool `tasks/todo/`) before redoing.
- **Flaky tests red a good gate.** If a task's gate fails ONLY on a known-flaky test with everything else green, re-run before treating it as a real block (and the flake itself is a `notes/observations/` note, not a task fix).
- **A `do` that delivers no code is NOT a success** (nothing changed → the gate passes vacuously). The runner catches this two ways — an agent STOP (drift) routes to needs-attention before the gate, and Gate-2 (plus your Gate-3) check the _diff against the criteria_, not just the gate. Trust the block; never merge an empty-or-criteria-unmet diff.
- **Don't sum two freshness models.** When reporting cross-repo + local state, keep them distinct.
