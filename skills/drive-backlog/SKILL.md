---
name: drive-backlog
description: "Drive a whole work/ backlog of ready SLICES to exhaustion as a CONDUCTOR over the agent-runner worker: pick the ready, fresh (non-drifted) slices AND a practical order, build each with `agent-runner do … --review --propose`, review the diff yourself against the slice's criteria, merge, and continue until no ready slice can advance — accumulating anything stuck/uncertain into a stuck-set (ask the human if present, else report) rather than stalling, and never forcing a blocked one. Use when asked to 'drive/work through the backlog', 'implement every ready slice', 'build the ready slices in a loop'. The SUPERVISED conductor (distinct from `run`, the unattended parallel daemon); the survey-everything-and-fill-gaps conductor is `orchestrate`, which delegates building here. Composes `review` and `to-slices`. NEVER force-merges a red/blocked slice. REQUIRES the agent-runner CLI + the work/ contract."
---

# drive-backlog

**Be the conductor, not the player.** `agent-runner do <slice> --review --propose` already builds ONE slice autonomously (claim → build agent → acceptance gate → Gate-2 review → PR). `drive-backlog` is the layer ABOVE: it looks at the _whole_ backlog, checks each ready slice is still _fresh_, decides _what_ to build and in _what order_, drives `do` per slice, then acts as a **third reviewer** (Gate-3, the conductor's own diff-vs-criteria pass — see step 4b) over each PR before merging it.

It is a **methodology skill** (prose you follow), like `to-slices` / `review` — NOT a runner command. **Precondition:** it drives the **`agent-runner` CLI** over a repo using the **`work/` contract** — if neither is present, this skill does not apply. (It is the ONE skill that leans on the runner CLI directly; that is its job. The other skills stay protocol-native.) It composes:

- **`agent-runner do … --review --propose`** — the per-slice worker (build + acceptance gate + the PR/code-review gate). The harness, model, and acceptance gate come from agent-runner CONFIG (per-repo / global) — do not hardcode them here; pass only the flags a given run needs.
- **`review`** (`skills/review/`) — the discipline for your own diff-vs-criteria pass over each opened PR.
- **`to-slices`** (`skills/to-slices/`) — for the forward-note step and any re-slice the human asks for.

It is **scoped to building ready SLICES.** The broader job — survey _everything_ (observations, ideas, PRDs, slices), figure out what can advance, fill judgement gaps conversationally until new slices are READY, then build them — is `orchestrate`, which delegates the BUILDING back to this skill. Keep `drive-backlog` focused on building ready slices; hand the deep survey up to `orchestrate`.

## How it stalls (the stuck-set)

There is ONE loop. The skill **advances every slice it can** and, whenever it hits a wall on a particular slice, it does NOT halt — it records that slice + its specific question in a **stuck-set** and moves to the next independent ready slice (the [accumulate-don't-block rule](#the-accumulate-dont-block-rule)). Only when nothing more can advance does it deal with the stuck-set, and HERE is the only behavioural fork — it depends purely on whether a human is reachable in this session:

- **A human is present** (the normal case — you are running in their session): present the accumulated stuck-set as one [batched set of questions](#batching-the-questions), take the answers, and **continue the loop** (a slice whose question is resolved becomes buildable again; one the human defers stays parked).
- **No human is reachable** (you were invoked to run unattended): do not block waiting — finish everything that can advance, then **stop and report the stuck-set** (plus the built/merged/needs-attention summary) as your result.

That is the whole difference; the loop, the selection, and the stuck-set are identical either way.

### Selection + isolation

This skill does its OWN intelligent per-slice selection (graph order + freshness + diff review) and dispatches `do` **per chosen slug** — it never uses `do`'s auto-pick (that is `run`'s daemon mechanism, not a conductor's). Builds run **in-place** (`do slice:<slug>` in the current checkout): one slice end-to-end, visible, with trivial rebases between merges. (`do` refuses on a dirty tree, so keep the tree clean between builds — golden rule 5.)

## When to use vs. not

- **Use** to take a `work/backlog/` from "N ready slices" to "no ready slice can advance", building + reviewing + merging each, in dependency-and-practical order; to conduct the agent-runner worker through a phase of slice-building; as the building engine `orchestrate` delegates to.
- **Don't** use it as the unattended daemon — that's `run` (genuine parallelism, no human). `drive-backlog` is **one slice at a time, end-to-end**. Don't use it to _author_ slices from scratch (that's `to-slices`), or to _slice PRDs / triage observations / fill judgement gaps / answer scattered open questions across the whole tree_ (that's `orchestrate`). Don't use it to FORCE a blocked slice — it respects the gate.

## The golden rules (do not violate)

1. **One slice at a time, end-to-end** (build → Gate-3 review → merge) so each merge unlocks the next cleanly and rebases stay trivial. Parallelism is `run`'s job.
2. **Never force a failed slice.** A red gate / Gate-2 block / rebase conflict routes the item to `work/needs-attention/` — leave it there, branch preserved, skip its dependents, continue with independent ready slices, report it at the end.
3. **Capture, don't fix-in-place, off-path findings.** Spot drift outside a slice's scope → write a `work/observations/` note (and COMMIT it — see rule 5), don't expand the slice.
4. **You merge the approval.** GitHub refuses `gh pr review --approve` on a PR whose commits are under your own identity — so post the verdict as a PR **comment** (`gh pr comment <n> --body-file …`, lead with `APPROVE ✅` / `BLOCK`), then `gh pr merge <n> --squash --delete-branch`. The comment + merge IS the approval.
5. **Clean tree before every `do`** (`do` refuses on a dirty tree) — so COMMIT your own `work/observations/` notes (they are contract-native, append-only, low-risk) before the next `do`, rather than leaving them uncommitted/stashed. Report what you committed in the summary. **What a conductor commits:** its own `work/observations/` notes; a load-bearing **forward-note it plants in a slice body** (step 2 — it MUST be committed to take effect before that slice's `do`, and it is a small protocol-mechanical edit, not authored content); and the protocol's own moves the runner/`do`/`complete` make (claim reverts, done-moves, PR merges). It does NOT hand-author-and-commit a full PRD or a fresh slice SET — producing those is `to-prd`/`to-slices`' job and they are left for human review. Report every commit in the summary.
6. **Accumulate, don't stall.** When ONE slice is stuck or needs a judgement call, write it into the stuck-set and move to the next INDEPENDENT ready slice — never block the whole loop on one item. When nothing more can advance, surface the stuck-set: ask the human if one is present, else report it. See [the rule](#the-accumulate-dont-block-rule).

## The accumulate-don't-block rule

The loop's job is to **advance as much as possible**, not to halt at the first judgement call. Whenever you hit a **wall** on a slice —

- it looks **stale/drifted** (the freshness check in step 1 fires),
- a **forward-note** seems needed but you're unsure it's wanted,
- a **Gate-3 review** surfaces a genuine judgement call (a maybe-blocking nit, an ambiguously-met criterion), or
- the slice is otherwise ambiguous / rests on an unresolved decision

— do NOT stop the loop. **Record the item + the specific question in a STUCK-SET** (a running list you keep for the session), SKIP that slice (and its dependents), and **continue with the next independent ready slice.** Only when nothing more can advance do you deal with the stuck-set:

- **A human is present** → present the stuck-set as a [batched set of questions](#batching-the-questions), take answers, and resume the loop (a slice whose question is resolved becomes buildable again; one the human defers stays parked).
- **No human reachable** → finish all you can, then stop and report the stuck-set (+ the built/merged/needs-attention summary) as your result; do not block waiting.

Either way the discipline is the same: do as much as can be done, then surface the residue in ONE batch — never dribble out one question at a time, never stall the whole loop on a single item.

## Recovering a needs-attention item (requeue)

When a slice has routed to `work/needs-attention/` (a red gate / Gate-2 block / rebase conflict / a build-time STOP), its body carries the reason and its `work/<slug>` branch is **preserved on the arbiter** — nothing is lost. Whether you can re-drive it depends on the reason:

- **A fixable problem the agent can resolve on a retry** — a real bug the gate caught, a scoping miss, a flaky-test red — is a CONDUCTOR move, not a human question. Recover it with **`agent-runner requeue <slug> --arbiter origin`** (DEFAULT = keep + continue: moves it back to `backlog/`, leaves the branch UNTOUCHED so the next claim CONTINUES from its tip). Optionally add a precise handoff with **`-m "<what to fix>"`** (appended to the body). Then `do slice:<slug>` again: the re-claim CONTINUES from the kept branch, and the merged `agent-prompt-continue-context` puts the prior work + the needs-attention reason
  - your `-m` note into the agent's prompt — so it BUILDS ON the good code and fixes the gap rather than restarting. (This session fixed `slicer-review-edit-loop` exactly this way: `requeue -m "<scoping fix>"` → `do` → review → merge.)
- **A genuine human-decision block** — the slice is ambiguous / drifted / rests on an unresolved fork — is NOT something a retry fixes. Leave it parked; it is a stuck-set question (ask it if a human is present, else report it). Do NOT requeue a slice whose premise is wrong — re-scope it first (that is `orchestrate`/human work).
- **`requeue --reset`** (DISCARD + fresh: deletes the remote branch first, then moves to backlog so the next claim starts CLEAN) is for when the kept work is worthless. It is guarded and NEVER the default — only on an explicit human call; the conductor's default recovery is keep+continue.

AFTER any requeue, re-sync (`git fetch && pull --rebase`) so the re-`do` claims off the latest main. A requeued-and-rebuilt slice then flows through the normal step-4 BUILD → REVIEW → MERGE.

> **Let `do` re-drive a recovered branch — do NOT hand-roll a parallel `pr/<slug>` branch.** When a flake-recovered slice's `work/<slug>` branch already holds green work but needs only a small lifecycle fixup before its PR (move the slice `.md` `needs-attention/ → done/`, strip the runner's "aborted/needs-attention" commit subjects), the right move is `requeue` (keep+continue) + re-`do`: the re-claim continues from the kept branch tip and the runner ITSELF opens the PR — no manual PR at all. If you genuinely must fix up by hand, commit the fixup **ON the existing `work/<slug>` branch** and PR that branch (`gh pr create --head work/<slug>`). NEVER spin a separate `pr/<slug>` branch off `main` and re-apply the tree: it **orphans** the canonical `work/<slug>` branch on the remote (it then has to be remembered and hand-deleted — easy to miss) and **discards** the branch's real history for mere cosmetic single-commit tidiness. One branch, its own history, no orphan.

## The loop

### 0. ANALYSE the slice set + dependency graph

Read every `work/backlog/*.md` frontmatter (`slug`, `blockedBy`/`deps`, `needsAnswers`, `prd`, `covers`) and the `work/done/` set. Build the graph:

- **READY** = every `blockedBy` is in `work/done/` AND `needsAnswers !== true`.
- **BLOCKED** = a `blockedBy` is still in `backlog`/`in-progress`/`needs-attention`.
- **GATED** = `needsAnswers: true` (needs a human first — NEVER agent-buildable; list it but do not build it, even once its deps land).

Note which slices **unlock the most downstream work** when they land — those go first.

### 1. CHECK freshness / up-to-dateness of each ready slice

**A ready slice is not necessarily a CORRECT slice.** Slices are authored ahead of time; by the time one is ready its load-bearing premises may have **drifted** — something it says is "unconsumed / not yet built / still TODO" may already have landed in `work/done/` + the code. Building a drifted slice wastes a full `do` run (the build agent will rightly STOP, or worse, churn working code) — and the conductor, which sees the WHOLE graph, can catch it cheaply UP FRONT.

For each ready slice, before dispatching `do`, sanity-check its premises against current reality:

- Read the slice's "What to build" + any **drift-check / READ-FIRST** block (slices often name the exact files + the premise to confirm).
- Spot-check the load-bearing claims: if it says "X has zero consumers", "Y still uses the old path", "the seam is unwired" — grep `work/done/` + `src/` to confirm that is STILL true. Recently-merged slices are the usual culprit (a convergence that already happened, a verb already renamed, a primitive already adopted).
- Glance at `work/observations/` for a `*-premise-drifted` / drift note naming this slice.

If the slice still holds → proceed. **If it smells stale → it's a WALL**: record it in the stuck-set with the specific premise that no longer holds + a suggested re-scope, SKIP it (per the accumulate-don't-block rule), and move on. (This catches drift cheaply up front. The build-time backstop also exists: a slice that IS drifted and slips past this check makes the build agent raise a STOP — the runner routes it to needs-attention with the agent's reason, skipping the wasted gate — but catching it here saves the whole `do` run.)

This is also the natural place for a **light look-ahead**: skim `work/prd/` (and, if cheap, `work/observations/` + `work/ideas/`) for what's coming — it informs the forward-notes in step 2. The DEEP survey-everything pass is `orchestrate`'s job, not this skill's; keep this shallow.

### 2. CHECK for forward-looking notes a soon-to-be-sliced PRD will need

Before building, scan `work/prd/` for a PRD that will be sliced soon and whose design **depends on the shape** of slices you're about to land (a `sliceAfter:` / "builds on the X convergence" relationship). If a ready slice should carry a `> FORWARD-POINTER` note so that PRD can be sliced later WITHOUT amending the PRD (e.g. "keep this loop/tick separable", "keep `-n` sequential", "don't rename X — the advance migration owns it", "shape this as a named callable unit"), **add the note to the slice body now** (compose `to-slices`' forward-note discipline). These notes are load-bearing: they prevent the downstream PRD from needing changes. A note you're CONFIDENT about: plant it and COMMIT it (it must land before that slice's `do` to take effect; per rule 5 this small protocol edit is committed, unlike authored artifacts). If a note is non-trivial or you're unsure it's wanted, that is a WALL → record it in the stuck-set (surface it with the batch when the loop stalls) rather than planting a guessed note.

> This is the step that earns the conductor its keep — a per-slice `do` agent only sees its own slice; only the conductor sees the whole graph + the pending PRDs and can plant the cross-slice notes.

### 3. SELECT the slices + a practical order

From the READY set, order by: (a) **dependency** (a slice that unlocks others first), then (b) **practical** concerns — serialise slices that edit the SAME hot file (e.g. one big `cli.ts`) so rebases stay trivial; prefer the order that keeps each subsequent claim rebasing cleanly off fresh `main`. State the planned order (and why) before you start.

### 4. For EACH fresh, ready slice, in order — BUILD → REVIEW → MERGE

**4a. Build it (clean tree first):**

```sh
agent-runner do slice:<slug> --review --propose
```

(The harness + model + acceptance gate are resolved from agent-runner config — flag > env > per-repo > global. Pass an explicit `--harness`/`--model` only to override config for this run; otherwise let config drive it.) Use a **generous timeout** — `do` runs a build agent + the full gate + the Gate-2 review and can take well over an hour for a big slice. If you interrupt it, KILL the spawned `do`/agent process tree explicitly (an abort of your wrapper does NOT stop the child); then discard its partial edits and revert the claim before retrying.

- **Non-zero exit** (red gate / Gate-2 block / rebase conflict) → the item is now in `work/needs-attention/` with its reason in the body and its branch preserved on the arbiter. STOP that slice (golden rule 2), skip its dependents, move to the next INDEPENDENT ready slice. If the reason is a FIXABLE problem (not a human-decision block), it is recoverable IN-LOOP via `requeue` + re-`do` (continues from the kept branch) — see [Recovering a needs-attention item](#recovering-a-needs-attention-item-requeue); otherwise it becomes a stuck-set question.

**4b. Gate-3 — review the opened PR yourself** (the conductor's own review, the third review layer after Gate-1 = `do`'s acceptance gate and Gate-2 = `do`'s PR/code-review gate — the discipline that makes you a real reviewer of the result, not a rubber stamp). `do` already ran Gate-1 AND Gate-2 before opening the PR, so **trust that green** — do NOT re-run the (potentially slow) acceptance gate here. Your job is the JUDGEMENT the gates can't fully do: does the diff actually deliver THIS slice?

- Read the **diff against the slice's acceptance criteria** — tick each criterion (apply the `review` skill's lenses + destination check).
- **Verify every drift note / forward-pointer / must-fix-before-consume** the slice carried was actually honoured (these are exactly where a `do` agent silently drifts — e.g. "don't rename X", "keep it sequential", "make the omitted path REFUSE"). Grep the branch to confirm.
- Read the gate-generated `work/observations/review-nits-<slug>-*.md` and triage each nit (blocking? benign? a real off-path finding worth its own observation?).
- **Verdict:** if a drift note was violated or an acceptance criterion is unmet → **BLOCK** (comment the blocking findings; do NOT merge). If it is a clear BLOCK or clear APPROVE, act on it. If it is a genuine **judgement call** (a maybe-blocking nit, an ambiguously-met criterion), that is a WALL → record it in the stuck-set and skip (do not merge on a coin-flip), per the [accumulate-don't-block rule](#the-accumulate-dont-block-rule). Otherwise **APPROVE**.

  > The gate `do` ran tests the agent's checkout, not the exact pushed branch — a rare divergence the conductor no longer re-checks (re-running a full gate per slice is too costly). The durable fix is to make `do`'s OWN gate run against the to-be-pushed tree; tracked in `work/observations/gate1-could-run-in-fresh-worktree-to-match-pushed-branch.md`.

**4c. Merge** (golden rule 4):

```sh
gh pr comment <n> --body-file /tmp/approve-<n>.md     # leads with APPROVE ✅ + per-criterion reasoning
gh pr merge <n> --squash --delete-branch
```

Use `--body-file` (PR bodies are backtick-heavy and break inline `--body` shell quoting).

> PROVIDER ASSUMPTION: the verdict-as-PR-comment + `gh pr merge` flow above assumes **`--propose` mode + a GitHub arbiter** (the only review-surface this skill knows today). In `--merge` mode `do` integrates directly with no PR — then your Gate-3 diff review still applies, but you record the verdict in the slice/observation, not a PR comment, and there is nothing to `gh pr merge`. A non-GitHub arbiter has no `gh` at all. Making the approval/merge surface provider-agnostic (a likely future `agent-runner` command, e.g. an `approve`/`land` verb) is NOT built yet; until then this step is GitHub-propose-specific — adapt the merge mechanics to the repo's actual integration mode.

**4d. Re-sync + re-evaluate:**

```sh
git checkout main && git fetch origin && git pull --rebase origin main
```

If the next `do` runs from a BUILT copy of agent-runner (e.g. a local checkout of this very repo), rebuild it so the merge you just made is in the binary the next `do` invokes. The merge landed `work/done/<slug>.md` on `main`; any slice blocked only by it is now unlocked. Recompute the READY set (steps 0–1, including a fresh freshness check on newly-unlocked slices) and continue.

### 5. CONTINUE until nothing can advance

Repeat step 4 until no ready slice can advance (the READY set is empty OR every remaining ready slice is parked in the stuck-set). THEN deal with the stuck-set ([the rule](#the-accumulate-dont-block-rule)): if a human is present, ask the batched questions and resume the loop from the answers; if not, report the stuck-set and stop.

### 6. SUMMARISE — the conductor's report

End with a structured rundown (this is a first-class deliverable, not an afterthought):

- **Built + merged** — each slice with its PR number + a one-line note on any drift/forward-pointer/must-fix it honoured (`do` ran the acceptance + review gates; you reviewed the diff).
- **Routed to needs-attention** — each, with the EXACT blocking reason, whether the agent produced no code vs. a real bug the gate caught, and that the branch is preserved on the arbiter (recoverable via `requeue` + re-claim, or `work-on`).
- **Still blocked / gated** — what remains and on what (a needs-attention item? a `needsAnswers` human gate?).
- **What's now UNLOCKED in the project** — new commands, new behaviours/capabilities, retired verbs, and crucially **which PRDs are now sliceable / unblocked** by what landed (the cross-cutting view only the conductor has).
- **Observations filed** (committed as you go, per rule 5) — list them so the human can find them in `git log`.
- **Housekeeping** — any direct-to-`main` chore commits you made (claim reverts, forward-notes), so the human can see them in `git log`.

When you run unattended (no human reachable), this report (plus the stuck-set) is your RESULT to whoever invoked you, not a message to a human.

## Batching the questions

When the loop stalls with a non-empty stuck-set, do NOT ask one question at a time. **Regroup the stuck-set into a single, well-organised batch** (the way a good conductor surfaces everything at once for one efficient answering pass):

- Group by item, each with: the slice, the SPECIFIC question, why it's stuck (stale premise / uncertain forward-note / review judgement call), enough inline context to answer WITHOUT opening the file, and a **suggested default** where you have one.
- Order by leverage (a question whose answer unblocks the most downstream work first).
- If a human is present: present the batch, take answers, resume the loop (resolved → buildable again; deferred → stays parked). If not: this batch is the residue you report and stop on.

The batch is conversational (asked) or reported (unattended), not a written file.

## Beyond slices

This skill builds READY SLICES. Two things sit ABOVE it, sharing its loop shape:

- **`orchestrate`** — the human-in-the-loop META conductor: surveys _everything_ (observations / ideas / PRDs / slices), advances what it can (slicing PRDs, triaging), fills judgement gaps with the human conversationally until new slices are READY, then **delegates the building to THIS skill** and surfaces the stuck-set to the human.
- **`advance` (the `advance-loop` PRD, not yet built)** — the AUTONOMOUS, file-mediated version of the same idea, driven by `run`/CI with a `work/questions/` sidecar. `drive-backlog` + `orchestrate` are the human-agency, synchronous siblings of `advance`; expect them to converge on the same tick contract.

The conductor is **tick-agnostic**: today the per-item action is `agent-runner do slice:<slug>` (build a slice); as `advance`-class ticks land (slice / triage / surface / apply), the SAME loop applies — only the per-item command in step 4a changes. (Mirrors the loop/tick split in `run`: the conductor is a _loop_; the per-item command is the _tick_.)

## Pitfalls (learned in practice)

- **The interrupt footgun.** Aborting your `do` wrapper does NOT kill the spawned agent — it keeps editing files in the background. After any interrupt, `ps`-find + kill the `do`/agent/`tsc` tree, discard its partial edits, and revert the claim (`git mv` the item back to `backlog/` + push) before redoing.
- **Flaky tests red a good gate.** If a slice's gate fails ONLY on a known-flaky test with everything else green, re-run before treating it as a real block (and the flake itself is an `observations/` note, not a slice fix).
- **A `do` that delivers no code is NOT a success** (nothing changed → the gate passes vacuously). The runner catches this two ways — an agent STOP (drift) routes to needs-attention before the gate, and Gate-2 (plus your Gate-3) check the _diff against the criteria_, not just the gate. Trust the block; never merge an empty-or-criteria-unmet diff.
- **Don't sum two freshness models.** When reporting cross-repo + local state, keep them distinct (the lesson the cwd-local-vs-registry reporting encodes).
