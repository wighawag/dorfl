---
name: drive-backlog
description: "Drive a whole work/ backlog of ready SLICES to exhaustion as a CONDUCTOR over the agent-runner worker: analyse the slice set + its dependency graph, CHECK each ready slice is still up-to-date (not drifted/stale), add forward-looking notes a soon-to-be-sliced PRD will need, pick the slices AND a practical order, then for each ready slice build it (`agent-runner do … --review --propose`), review the review (and review the diff yourself = Gate-3), merge, and continue until no ready slice can advance — never forcing a blocked one. Runs in two POSTURES sharing one loop: INTERACTIVE (default, main session — voice the batch of accumulated blockers/questions when the loop stalls, then continue from the answers) and AUTONOMOUS (sub-agent-safe — never ask; terminate when nothing can advance and RETURN the accumulated questions + report to the caller). Use when asked to 'drive/work through the backlog', 'implement every ready slice', 'build the ready slices in a loop'. This is the SUPERVISED conductor (distinct from `run`, the unattended parallel daemon). Composes `review` (Gate-3) and `to-slices` (forward-notes). NEVER force-merges a red/blocked slice. The higher-level survey-everything-and-fill-gaps conductor is `orchestrate` (Skill B), which CALLS this one to build."
---

# drive-backlog

**Be the conductor, not the player.** `agent-runner do <slice> --review --propose`
already builds ONE slice autonomously (claim → build agent → acceptance gate →
Gate-2 review → PR). `drive-backlog` is the layer ABOVE: it looks at the *whole*
backlog, checks each ready slice is still *fresh*, decides *what* to build and in
*what order*, drives `do` per slice, then acts as a **third reviewer** (Gate-3) over
each PR before merging it.

It is a **methodology skill** (prose you follow), like `to-slices` / `batch-qa` /
`review` — NOT a runner command. It composes:

- **`agent-runner do … --harness pi --review --propose`** — the per-slice worker (build + gate + Gate-2).
- **`review`** (`skills/review/`) — your own Gate-3 pass over each opened PR.
- **`to-slices`** (`skills/to-slices/`) — for the forward-note step and any re-slice the human asks for.

It is **scoped to building ready SLICES.** The broader job — survey *everything*
(observations, ideas, PRDs, slices), figure out what can advance, fill judgement
gaps conversationally until new slices are READY, then build them — is `orchestrate`
(Skill B). `orchestrate` CALLS `drive-backlog` (often as a sub-agent, autonomous
posture) to do the building. Keep this skill focused; hand the deep survey up to B.

## The two postures (one loop, different VOICING of the stuck-set)

Both postures run the IDENTICAL loop and the IDENTICAL
[accumulate-don't-block rule](#the-accumulate-dont-block-rule): advance every slice
you can, write down what's stuck/uncertain, keep going. They differ ONLY in what
happens when nothing more can advance:

- **INTERACTIVE** (default — running in the main session, the human is here): when
  the loop stalls, **present the accumulated batch of questions** (regrouped — see
  [batching](#batching-the-questions)), take the human's answers, and **continue the
  loop from there**. This is the mode used live this session.
- **AUTONOMOUS** (sub-agent-safe — no human to ask): **never pause to ask.** Advance
  everything possible, then **terminate when nothing is left** and **RETURN the
  accumulated questions + the full report** to the caller. A sub-agent cannot ask you
  live; it surfaces questions by *returning them as data*, and its in-session parent
  (`orchestrate`) voices them to you. This is how `orchestrate` delegates the heavy
  building yet still gets the questions in front of you.

State the posture at the start ("running INTERACTIVE" / "running AUTONOMOUS for the
calling agent"). Default to INTERACTIVE unless invoked as a sub-agent or told
otherwise.

## When to use vs. not

- **Use** to take a `work/backlog/` from "N ready slices" to "no ready slice can
  advance", building + reviewing + merging each, in dependency-and-practical order;
  to conduct the agent-runner worker through a phase of slice-building; as the
  building engine `orchestrate` delegates to.
- **Don't** use it as the unattended daemon — that's `run` (genuine parallelism, no
  human). `drive-backlog` is **one slice at a time, end-to-end**. Don't use it to
  *author* slices from scratch (that's `to-slices`), to *slice PRDs / triage
  observations / fill judgement gaps across the whole tree* (that's `orchestrate`),
  or to *answer scattered open questions* (that's `batch-qa`, until `orchestrate`
  supersedes it). Don't use it to FORCE a blocked slice — it respects the gate.

## The golden rules (do not violate)

1. **One slice at a time, end-to-end** (build → Gate-3 review → merge) so each merge
   unlocks the next cleanly and rebases stay trivial. Parallelism is `run`'s job.
2. **Never force a failed slice.** A red gate / Gate-2 block / rebase conflict routes
   the item to `work/needs-attention/` — leave it there, branch preserved, skip its
   dependents, continue with independent ready slices, report it at the end.
3. **Capture, don't fix-in-place, off-path findings.** Spot drift outside a slice's
   scope → write a `work/observations/` note, don't expand the slice.
4. **You merge the approval.** GitHub refuses `gh pr review --approve` on a PR whose
   commits are under your own identity — so post the verdict as a PR **comment**
   (`gh pr comment <n> --body-file …`, lead with `APPROVE ✅` / `BLOCK`), then
   `gh pr merge <n> --squash --delete-branch`. The comment + merge IS the approval.
5. **Clean tree before every `do`.** `do` refuses on a dirty tree. Stash your own
   uncommitted notes; never auto-commit them (the human commits observations).
6. **Accumulate, don't stall.** When ONE slice is stuck or needs a judgement call,
   write it into the stuck-set and move to the next INDEPENDENT ready slice — never
   block the whole loop on one item. Voice the stuck-set per your posture (interactive
   = ask the batch when stalled; autonomous = return it at the end). See
   [the rule](#the-accumulate-dont-block-rule).

## The accumulate-don't-block rule

The loop's job is to **advance as much as possible**, not to halt at the first
judgement call. Whenever you hit a **wall** on a slice —

- it looks **stale/drifted** (the [freshness check](#1-check-freshness--up-to-dateness-of-each-ready-slice) fires),
- a **forward-note** seems needed but you're unsure it's wanted,
- a **Gate-3 review** surfaces a genuine judgement call (a maybe-blocking nit, an
  ambiguously-met criterion), or
- the slice is otherwise ambiguous / rests on an unresolved decision

— do NOT stop the loop. **Record the item + the specific question in a STUCK-SET**
(a running list you keep for the session), SKIP that slice (and its dependents), and
**continue with the next independent ready slice.** Only when nothing more can
advance do you deal with the stuck-set, per posture:

- **INTERACTIVE** → present the stuck-set as a [batched set of questions](#batching-the-questions),
  take answers, and resume the loop (a slice whose question is resolved becomes
  buildable again; one the human defers stays parked).
- **AUTONOMOUS** → terminate and RETURN the stuck-set (+ the built/merged/
  needs-attention report) to the caller; do not ask.

This maximises work-done in BOTH postures and is the single behaviour that unifies
them — the sub-agent does as much as it can and brings back the residue; the
interactive run does as much as it can and then asks the residue in one go.

## Recovering a needs-attention item (requeue)

When a slice has routed to `work/needs-attention/` (a red gate / Gate-2 block /
rebase conflict / a build-time STOP), its body carries the reason and its
`work/<slug>` branch is **preserved on the arbiter** — nothing is lost. Whether you
can re-drive it depends on the reason:

- **A fixable problem the agent can resolve on a retry** — a real bug the gate
  caught, a scoping miss, a flaky-test red — is a CONDUCTOR move, not a human
  question. Recover it with **`agent-runner requeue <slug> --arbiter origin`**
  (DEFAULT = keep + continue: moves it back to `backlog/`, leaves the branch
  UNTOUCHED so the next claim CONTINUES from its tip). Optionally add a precise
  handoff with **`-m "<what to fix>"`** (appended to the body). Then `do slice:<slug>`
  again: the re-claim CONTINUES from the kept branch, and the merged
  `agent-prompt-continue-context` puts the prior work + the needs-attention reason
  + your `-m` note into the agent's prompt — so it BUILDS ON the good code and fixes
  the gap rather than restarting. (This session fixed `slicer-review-edit-loop`
  exactly this way: `requeue -m "<scoping fix>"` → `do` → Gate-3 → merge.)
- **A genuine human-decision block** — the slice is ambiguous / drifted / rests on an
  unresolved fork — is NOT something a retry fixes. Leave it parked; it is a
  stuck-set question (interactive: ask it; autonomous: return it). Do NOT requeue a
  slice whose premise is wrong — re-scope it first (that is `orchestrate`/human work).
- **`requeue --reset`** (DISCARD + fresh: deletes the remote branch first, then
  moves to backlog so the next claim starts CLEAN) is for when the kept work is
  worthless. It is guarded and NEVER the default — only on an explicit human call;
  the conductor's default recovery is keep+continue.

AFTER any requeue, re-sync (`git fetch && pull --rebase`) so the re-`do` claims off
the latest main. A requeued-and-rebuilt slice then flows through the normal
step-4 BUILD → Gate-3 → MERGE.

## The loop

### 0. ANALYSE the slice set + dependency graph

Read every `work/backlog/*.md` frontmatter (`slug`, `blockedBy`/`deps`,
`needsAnswers`, `prd`, `covers`) and the `work/done/` set. Build the graph:

- **READY** = every `blockedBy` is in `work/done/` AND `needsAnswers !== true`.
- **BLOCKED** = a `blockedBy` is still in `backlog`/`in-progress`/`needs-attention`.
- **GATED** = `needsAnswers: true` (needs a human first — NEVER agent-buildable;
  list it but do not build it, even once its deps land).

Note which slices **unlock the most downstream work** when they land — those go first.

### 1. CHECK freshness / up-to-dateness of each ready slice

**A ready slice is not necessarily a CORRECT slice.** Slices are authored ahead of
time; by the time one is ready its load-bearing premises may have **drifted** —
something it says is "unconsumed / not yet built / still TODO" may already have
landed in `work/done/` + the code. Building a drifted slice wastes a full `do` run
(the build agent will rightly STOP, or worse, churn working code) — and the
conductor, which sees the WHOLE graph, can catch it cheaply UP FRONT.

For each ready slice, before dispatching `do`, sanity-check its premises against
current reality:

- Read the slice's "What to build" + any **drift-check / READ-FIRST** block (slices
  often name the exact files + the premise to confirm).
- Spot-check the load-bearing claims: if it says "X has zero consumers", "Y still
  uses the old path", "the seam is unwired" — grep `work/done/` + `src/` to confirm
  that is STILL true. Recently-merged slices are the usual culprit (a convergence
  that already happened, a verb already renamed, a primitive already adopted).
- Glance at `work/observations/` for a `*-premise-drifted` / drift note naming this
  slice.

If the slice still holds → proceed. **If it smells stale → it's a WALL**: record it
in the stuck-set with the specific premise that no longer holds + a suggested
re-scope, SKIP it (per the [accumulate-don't-block rule](#the-accumulate-dont-block-rule)),
and move on. (This is the check that would have caught
`do-run-share-isolation-seam` before burning an hour on a build-time STOP.)

This is also the natural place for a **light look-ahead**: skim `work/prd/` (and, if
cheap, `work/observations/` + `work/ideas/`) for what's coming — it informs the
forward-notes in step 2. The DEEP survey-everything pass is `orchestrate`'s job, not
this skill's; keep this shallow.

### 2. CHECK for forward-looking notes a soon-to-be-sliced PRD will need

Before building, scan `work/prd/` for a PRD that will be sliced soon and whose
design **depends on the shape** of slices you're about to land (a `sliceAfter:` /
"builds on the X convergence" relationship). If a ready slice should carry a
`> FORWARD-POINTER` note so that PRD can be sliced later WITHOUT amending the PRD
(e.g. "keep this loop/tick separable", "keep `-n` sequential", "don't rename X —
the advance migration owns it", "shape this as a named callable unit"), **add the
note to the slice body now** (compose `to-slices`' forward-note discipline). These
notes are load-bearing: they prevent the downstream PRD from needing changes. If a
note is non-trivial or you're unsure it's wanted, that is a WALL → record it in the
stuck-set (interactive asks it later in the batch; autonomous returns it) rather than
planting a guessed note. (A note you're confident about, just plant.)

> This is the step that earns the conductor its keep — a per-slice `do` agent only
> sees its own slice; only the conductor sees the whole graph + the pending PRDs and
> can plant the cross-slice notes.

### 3. SELECT the slices + a practical order

From the READY set, order by: (a) **dependency** (a slice that unlocks others
first), then (b) **practical** concerns — serialise slices that edit the SAME hot
file (e.g. one big `cli.ts`) so rebases stay trivial; prefer the order that keeps
each subsequent claim rebasing cleanly off fresh `main`. State the planned order
(and why) before you start.

### 4. For EACH fresh, ready slice, in order — BUILD → REVIEW → MERGE

**4a. Build it (clean tree first):**
```sh
agent-runner do slice:<slug> --harness pi --review --propose
```
Use a **generous timeout** — `do` runs a build agent + the full gate + the Gate-2
review and can take well over an hour for a big slice. If you interrupt it, KILL the
spawned `do`/agent process tree explicitly (an abort of your wrapper does NOT stop
the child); then discard its partial edits and revert the claim before retrying.

- **Non-zero exit** (red gate / Gate-2 block / rebase conflict) → the item is now in
  `work/needs-attention/` with its reason in the body and its branch preserved on the
  arbiter. STOP that slice (golden rule 2), skip its dependents, move to the next
  INDEPENDENT ready slice. If the reason is a FIXABLE problem (not a human-decision
  block), it is recoverable IN-LOOP via `requeue` + re-`do` (continues from the kept
  branch) — see [Recovering a needs-attention item](#recovering-a-needs-attention-item-requeue);
  otherwise it becomes a stuck-set question.

**4b. Gate-3 — review the opened PR yourself** (the discipline that makes you a real
third reviewer, not a rubber stamp):
- Read the **diff against the slice's acceptance criteria** — tick each criterion.
- **Verify every drift note / forward-pointer / must-fix-before-consume** the slice
  carried was actually honoured (these are exactly where a `do` agent silently
  drifts — e.g. "don't rename X", "keep it sequential", "make the omitted path
  REFUSE"). Grep the branch to confirm.
- Read the gate-generated `work/observations/review-nits-<slug>-*.md` and triage each
  nit (blocking? benign? a real off-path finding worth its own observation?).
- **Run the gate yourself** on the PR branch in a throwaway worktree to confirm green
  independently:
  ```sh
  git worktree add /tmp/ar-rev-<slug> origin/work/<slug>
  cd /tmp/ar-rev-<slug> && pnpm install --frozen-lockfile
  pnpm -r build && pnpm -r test && pnpm -r format:check     # == agent-runner verify
  git worktree remove --force /tmp/ar-rev-<slug>
  ```
- **Verdict:** if a drift note was violated, an acceptance criterion is unmet, or the
  gate is red → **BLOCK** (comment the blocking findings; do NOT merge). If the
  verdict is a clear BLOCK or clear APPROVE, act on it. If it is a genuine
  **judgement call** (a maybe-blocking nit, an ambiguously-met criterion), that is a
  WALL → record it in the stuck-set and skip (do not merge on a coin-flip), per the
  [accumulate-don't-block rule](#the-accumulate-dont-block-rule). Otherwise
  **APPROVE**.

**4c. Merge** (golden rule 4):
```sh
gh pr comment <n> --body-file /tmp/approve-<n>.md     # leads with APPROVE ✅ + per-criterion reasoning
gh pr merge <n> --squash --delete-branch
```
Use `--body-file` (PR bodies are backtick-heavy and break inline `--body` shell
quoting).

**4d. Re-sync + re-evaluate:**
```sh
git checkout main && git fetch origin && git pull --rebase origin main
pnpm -r build      # rebuild the dist the next `do` invokes
```
The merge landed `work/done/<slug>.md` on `main`; any slice blocked only by it is now
unlocked. Recompute the READY set (steps 0–1, including a fresh freshness check on
newly-unlocked slices) and continue.

### 5. CONTINUE until nothing can advance

Repeat step 4 until no ready slice can advance (the READY set is empty OR every
remaining ready slice is parked in the stuck-set). THEN deal with the stuck-set per
posture ([the rule](#the-accumulate-dont-block-rule)): INTERACTIVE → ask the batched
questions, then resume the loop from the answers; AUTONOMOUS → return the stuck-set
+ report to the caller (do not ask).

### 6. SUMMARISE — the conductor's report

End with a structured rundown (this is a first-class deliverable, not an
afterthought):

- **Built + merged** — each slice with its PR number + tests-passing count + a
  one-line note on any drift/forward-pointer/must-fix it honoured.
- **Routed to needs-attention** — each, with the EXACT blocking reason, whether the
  agent produced no code vs. a real bug the gate caught, and that the branch is
  preserved on the arbiter (recoverable via `requeue` + re-claim, or `work-on`).
- **Still blocked / gated** — what remains and on what (a needs-attention item? a
  `needsAnswers` human gate?).
- **What's now UNLOCKED in the project** — new commands, new behaviours/capabilities,
  retired verbs, and crucially **which PRDs are now sliceable / unblocked** by what
  landed (the cross-cutting view only the conductor has).
- **Observations filed** (left untracked/uncommitted for the human, per rule 3).
- **Housekeeping** — any direct-to-`main` chore commits you made (claim reverts,
  forward-notes), so the human can see them in `git log`.

In AUTONOMOUS posture this report (plus the stuck-set) is the RETURN VALUE to the
caller, not a message to a human.

## Batching the questions

When the loop stalls with a non-empty stuck-set, do NOT ask one question at a time.
**Regroup the stuck-set into a single, well-organised batch** (the way a good
conductor surfaces everything at once for one efficient answering pass):

- Group by item, each with: the slice, the SPECIFIC question, why it's stuck (stale
  premise / uncertain forward-note / Gate-3 judgement call), enough inline context
  to answer WITHOUT opening the file, and a **suggested default** where you have one.
- Order by leverage (a question whose answer unblocks the most downstream work first).
- INTERACTIVE: present the batch, take answers, resume the loop (resolved → buildable
  again; deferred → stays parked). AUTONOMOUS: this batch IS the returned residue —
  the parent (`orchestrate`) voices it to the human.

This is the same batching discipline `batch-qa` uses for files — here it's
conversational (or a returned payload), not a written `work/questions/` file.

## Beyond slices

This skill builds READY SLICES. Two things sit ABOVE it, sharing its loop shape:

- **`orchestrate` (Skill B)** — the human-in-the-loop META conductor: surveys
  *everything* (observations / ideas / PRDs / slices), advances what it can
  (slicing PRDs, triaging), fills judgement gaps with the human conversationally
  until new slices are READY, then **calls THIS skill** (often as a sub-agent in
  AUTONOMOUS posture) to build them, and voices the returned stuck-set to the human.
- **`advance` (the `advance-loop` PRD, not yet built)** — the AUTONOMOUS,
  file-mediated version of the same idea, driven by `run`/CI with a
  `work/questions/` sidecar. `drive-backlog` (autonomous posture) + `orchestrate`
  are the human-agency, synchronous twins of `advance`; expect them to converge on
  the same tick contract.

The conductor is **tick-agnostic**: today the per-item action is
`agent-runner do slice:<slug>` (build a slice); as `advance`-class ticks land
(slice / triage / surface / apply), the SAME loop applies — only the per-item
command in step 4a changes. (Mirrors the loop/tick split in `run`: the conductor is
a *loop*; the per-item command is the *tick*.)

## Pitfalls (learned in practice)

- **The interrupt footgun.** Aborting your `do` wrapper does NOT kill the spawned
  agent — it keeps editing files in the background. After any interrupt, `ps`-find +
  kill the `do`/agent/`tsc` tree, discard its partial edits, and revert the claim
  (`git mv` the item back to `backlog/` + push) before redoing.
- **Flaky tests red a good gate.** If a slice's gate fails ONLY on a known-flaky test
  with everything else green, re-run before treating it as a real block (and the flake
  itself is an `observations/` note, not a slice fix).
- **A `do` that delivers no code still "passes" the acceptance gate** (nothing
  changed → nothing breaks) — that's exactly why Gate-2 (and your Gate-3) check the
  *diff against the criteria*, not just the gate. Trust the block.
- **Don't sum two freshness models.** When reporting cross-repo + local state, keep
  them distinct (same lesson the `scan`/`status` slices encode).
