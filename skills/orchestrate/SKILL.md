---
name: orchestrate
description: "Drive a whole work/ backlog to exhaustion as a human-in-the-loop CONDUCTOR over the agent-runner worker: analyse the slice set + its dependency graph, add forward-looking notes a soon-to-be-sliced PRD will need, pick the slices AND a practical order, then for each ready slice build it (`agent-runner do … --review --propose`), review the review (and review the diff yourself), merge, and continue until no ready slice remains — never forcing a blocked one. Use when asked to 'run/work through the backlog', 'implement every ready slice', 'orchestrate the slices', 'drive the work/ queue', or to conduct the agent-runner worker across many slices in one sitting. This is the SUPERVISED conductor (you stay in control, merge yourself, ask the human only when a decision is genuinely needed) — distinct from `run`, the unattended parallel daemon. Composes `review` (Gate-3 self-review) and `to-slices` (the forward-note / re-slice step); it NEVER force-merges a red/blocked slice."
---

# orchestrate

**Be the conductor, not the player.** `agent-runner do <slice> --review --propose`
already builds ONE slice autonomously (claim → build agent → acceptance gate →
Gate-2 review → PR). `orchestrate` is the layer ABOVE: it looks at the *whole*
backlog, decides *what* to build and in *what order*, drives `do` per slice, then
acts as a **third reviewer** (Gate-3) over each PR before merging it — and stops to
ask the human only when a real decision is needed.

It is a **methodology skill** (prose you follow), like `to-slices` / `batch-qa` /
`review` — NOT a runner command. It composes:

- **`agent-runner do … --harness pi --review --propose`** — the per-slice worker (build + gate + Gate-2).
- **`review`** (`skills/review/`) — your own Gate-3 pass over each opened PR.
- **`to-slices`** (`skills/to-slices/`) — for the forward-note step and any re-slice the human asks for.

## When to use vs. not

- **Use** to take a `work/backlog/` from "N ready slices" to "no ready slice left",
  building + reviewing + merging each, in dependency-and-practical order, in one
  supervised sitting; to conduct the agent-runner worker through a phase of work; to
  do the same for a *family* of tasks once `advance`-style ticks exist (the conductor
  is tick-agnostic — see [Beyond slices](#beyond-slices)).
- **Don't** use it as the unattended daemon — that's `run` (genuine parallelism, no
  human). `orchestrate` is **one slice at a time, end-to-end, you in the loop**.
  Don't use it to *author* slices from scratch (that's `to-slices`) or to *answer*
  scattered open questions (that's `batch-qa`). Don't use it to FORCE a blocked
  slice — the whole point is that it respects the gate.

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
6. **Ask the human only for genuine decisions** — an open question, an ambiguous
   slice, a `needsAnswers` item, a real design fork. Everything mechanical, you do.

## The loop

### 0. ANALYSE the slice set + dependency graph

Read every `work/backlog/*.md` frontmatter (`slug`, `blockedBy`/`deps`,
`needsAnswers`, `prd`, `covers`) and the `work/done/` set. Build the graph:

- **READY** = every `blockedBy` is in `work/done/` AND `needsAnswers !== true`.
- **BLOCKED** = a `blockedBy` is still in `backlog`/`in-progress`/`needs-attention`.
- **GATED** = `needsAnswers: true` (needs a human first — NEVER agent-buildable;
  list it but do not build it, even once its deps land).

Note which slices **unlock the most downstream work** when they land — those go first.

### 1. CHECK for forward-looking notes a soon-to-be-sliced PRD will need

Before building, scan `work/prd/` for a PRD that will be sliced soon and whose
design **depends on the shape** of slices you're about to land (a `sliceAfter:` /
"builds on the X convergence" relationship). If a ready slice should carry a
`> FORWARD-POINTER` note so that PRD can be sliced later WITHOUT amending the PRD
(e.g. "keep this loop/tick separable", "keep `-n` sequential", "don't rename X —
the advance migration owns it", "shape this as a named callable unit"), **add the
note to the slice body now** (compose `to-slices`' forward-note discipline). These
notes are load-bearing: they prevent the downstream PRD from needing changes. If a
note is non-trivial or you're unsure it's wanted, ASK the human first.

> This is the step that earns the conductor its keep — a per-slice `do` agent only
> sees its own slice; only the conductor sees the whole graph + the pending PRDs and
> can plant the cross-slice notes.

### 2. SELECT the slices + a practical order

From the READY set, order by: (a) **dependency** (a slice that unlocks others
first), then (b) **practical** concerns — serialise slices that edit the SAME hot
file (e.g. one big `cli.ts`) so rebases stay trivial; prefer the order that keeps
each subsequent claim rebasing cleanly off fresh `main`. State the planned order
(and why) before you start.

### 3. For EACH ready slice, in order — BUILD → REVIEW → MERGE

**3a. Build it (clean tree first):**
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
  INDEPENDENT ready slice.

**3b. Gate-3 — review the opened PR yourself** (the discipline that makes you a real
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
  gate is red → **BLOCK** (comment the blocking findings; do NOT merge — decide with
  the human whether to route to needs-attention or hand back). Otherwise **APPROVE**.

**3c. Merge** (golden rule 4):
```sh
gh pr comment <n> --body-file /tmp/approve-<n>.md     # leads with APPROVE ✅ + per-criterion reasoning
gh pr merge <n> --squash --delete-branch
```
Use `--body-file` (PR bodies are backtick-heavy and break inline `--body` shell
quoting).

**3d. Re-sync + re-evaluate:**
```sh
git checkout main && git fetch origin && git pull --rebase origin main
pnpm -r build      # rebuild the dist the next `do` invokes
```
The merge landed `work/done/<slug>.md` on `main`; any slice blocked only by it is now
unlocked. Recompute the READY set (step 0) and continue.

### 4. CONTINUE until exhaustion

Repeat step 3 until the READY set is empty. Stop early and ASK THE HUMAN when you hit
something needing a decision (an open question, an ambiguous slice, a `needsAnswers`
item, a design fork a Gate-3 review surfaces).

### 5. SUMMARISE — the conductor's report

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

## Beyond slices

The conductor is **tick-agnostic**. Today the per-item action is
`agent-runner do slice:<slug>` (build a slice). As other task types become
runner-driven (e.g. an `advance` tick that builds / slices / triages / surfaces /
applies), the SAME loop applies: analyse the item set, order it, run the per-item
command, Gate-3 the result, merge, continue, summarise. Keep the methodology generic;
only step 3a's command changes per task type. (This mirrors the loop/tick split in
`run` — the conductor is a human-in-the-loop *loop*; the per-item command is the
*tick*.)

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
