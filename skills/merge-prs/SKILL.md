---
name: merge-prs
disable-model-invocation: true
description: "Review the open work/ PRs and land them EFFICIENTLY: partition into conflict-free clusters, gate each cluster's combined tip ONCE, then merge the cluster; PRs that don't cleanly combine fall out to their own gate. The batch-landing sibling of drive-tasks (which builds+merges one task at a time). Requires gh + a GitHub arbiter in propose mode."
---

# merge-prs

**Land the already-built, not build the not-yet-built.** `drive-tasks` is the conductor that _builds_ ready tasks one at a time and merges each PR as it opens. `merge-prs` starts one step LATER: a set of work PRs is already OPEN (they came from `dorfl do --propose`, `run`, CI intake, or a `drive-tasks` pass you didn't merge), and the job is to review them and get them ONTO `main` with the fewest possible gate runs.

The trick is **batching by conflict-free clustering**. Instead of one review then gate then merge per PR (N gate runs), partition the approved PRs into clusters that touch disjoint files, combine each cluster onto a scratch branch, run the repo's `verify` gate ONCE against that combined tip, and merge the whole cluster. N PRs that don't overlap become 1 gate run, not N.

It is a **methodology skill** (prose you follow), like `review` and `drive-tasks`, NOT a runner command. **Precondition:** it operates over **open GitHub PRs** on a repo using the **`work/` contract**, in **`propose` integration mode**, with **`gh`** available. If the arbiter is not GitHub, or integration is `merge` (no PRs), this skill does not apply as written (see [Provider assumption](#provider-assumption)). It composes:

- **`review`** (`skills/review/`): the diff-vs-criteria discipline, applied PER PR before it is eligible to join a cluster. A PR that fails review never enters the batch.
- **`drive-tasks`** (`skills/drive-tasks/`): the sibling conductor. Its [accumulate-don't-block rule](../drive-tasks/SKILL.md) and its **never-touch-the-target-checkout** rule (golden rule 7) apply here UNCHANGED. A PR you can't cleanly land goes in the stuck-set and you move on; all combining/gating happens in a scratch worktree/clone you own, never the human checkout.

## When to use vs. not

- **Use** when several work PRs are already open and you want to land the sound ones in as few gate runs as possible; after a `run`/CI burst left a pile of green-gated PRs awaiting a human merge; when you'd rather review-and-land a backlog of PRs than build new tasks.
- **Do NOT use** to BUILD tasks; that is `drive-tasks` (or `dorfl do`). If there are zero open PRs, there is nothing to do here. If integration mode is `merge` (direct-to-main, no PR), there is no PR surface to batch, because the landing already happened at build time.

## The one correctness rule (why clustering, not just "gate the combine")

The whole value is "gate once for N PRs", but a combined gate is only HONEST if **what you gated is what actually lands**. Two ways to break that, and the rule that avoids both:

- Under `gh pr merge`, each PR squash-merges onto the CURRENT `main`, so after the first merge the tree GitHub produces for the second PR is NOT byte-identical to the combined tip you gated. If two PRs touch the **same file**, a green combined gate can still yield a broken/conflicted `main`.
- So a combined gate over OVERLAPPING PRs is necessary-but-not-sufficient. It can lie.

**The rule: only ever batch PRs whose file-sets are DISJOINT.** Within a conflict-free cluster there is no overlap for a later merge to invalidate, so the combined green gate genuinely predicts each per-PR merge. Concretely: partition by "do these PRs' changed-file sets intersect?" A PR that overlaps any other lands in its OWN singleton cluster (gate it alone, merge it alone). You lose the batching win for that one, but never the honesty. This is the "combine only the PRs that make sense" instinct, made a hard invariant.

> Overlap is judged on **changed files** (`gh pr diff <n> --name-only`), which is a conservative proxy: two PRs can touch the same file on non-adjacent lines and still merge cleanly, so file-level disjointness may over-split (extra singletons) but never under-splits into a dishonest batch. That trade is deliberate: prefer an extra gate run over a lying one. (If you want tighter packing later, upgrade the test to an actual trial `git merge`/`rebase` in the scratch tree and treat a clean 3-way merge as non-conflicting; until then, file-set disjointness is the safe default.)

## The loop

Run from ANYWHERE: you need only the arbiter (a URL/remote) plus `gh` plus a scratch area. Resolve the arbiter EXPLICITLY; if `cwd` is the human's checkout, treat it as READ-ONLY (drive-tasks golden rule 7).

**0. Enumerate the open work PRs.** `gh pr list --state open --json number,title,headRefName,url`. Keep only the ones that are work-branch PRs (dorfl pushes `work/<slug>` head branches, so filter on `headRefName` prefix / your repo's convention). Map each PR back to its task slug and the `work/tasks/**/<slug>.md` it done-moves, so review has the acceptance criteria to check against.

**1. Per-PR review (the eligibility gate).** For EACH PR, apply the `review` discipline (`skills/review/`) to its diff vs. its task's criteria. This is the same Gate-3 diff-vs-criteria pass `drive-tasks` step 4 does, just done up front for all PRs:

- clear **APPROVE** → the PR is eligible to be batched.
- clear **BLOCK** (a drift note violated, an acceptance criterion unmet, an empty/vacuous diff) → drop it from the batch, record the blocking finding (post it as a PR comment leading with `BLOCK`, per drive-tasks step 4), and do NOT land it.
- genuine **judgement call** (maybe-blocking nit, ambiguously-met criterion) → that is a WALL, so stuck-set it and skip, per the [accumulate-don't-block rule](../drive-tasks/SKILL.md). Never merge on a coin-flip.

**2. Cluster the approved PRs by conflict-freedom.** For each approved PR collect its changed-file set (`gh pr diff <n> --name-only`). Group PRs so that within a group every pair has DISJOINT file-sets (the [one correctness rule](#the-one-correctness-rule-why-clustering-not-just-gate-the-combine)). Any PR overlapping another becomes its own singleton cluster. Note that dorfl PRs each done-move their OWN `work/tasks/…/<slug>.md` (distinct paths) and edit distinct code, so in practice most PRs land in one big disjoint cluster and overlaps are the exception.

**3. Per cluster: combine → gate ONCE → merge the cluster.** In a scratch worktree/clone you own (NEVER the human checkout):

- fetch the arbiter, create a scratch integration branch off the current `main`, and merge each PR's head branch into it (`git merge --no-ff <headRef>` or cherry-pick the PR range). A merge that CONFLICTS despite the file-set proxy (rare, but possible) → pull that PR OUT of the cluster into a singleton and re-form the cluster; do not force it.
- run the repo's **`verify` gate** ONCE against the combined tip. In this repo that is `pnpm -r build && pnpm -r test && pnpm format:check` (the `dorfl verify` equivalent; see AGENTS.md. Do NOT invent a gate, read the repo's `dorfl.json` `verify`).
- **green** → merge every PR in the cluster: `gh pr comment <n> --body "APPROVE ✅ (batch-gated with #a #b #c)"` then `gh pr merge <n> --squash --delete-branch` for each. Because the file-sets are disjoint, the sequential squash-merges reproduce the tip you gated.
- **red** → the cluster is NOT landable as a batch. Do NOT merge any of it on a batch coin-flip. Bisect by falling back to gating the cluster's PRs INDIVIDUALLY (singleton gate each), land the green ones, and stuck-set the red one with the failing gate output. A batch red almost always means one bad PR poisoning the combine, and the singleton pass isolates it.

**4. Recompute and continue.** Each cluster merge lands `work/tasks/done/<slug>.md` for its PRs on `main`. Fetch, re-enumerate open PRs (new ones may have appeared; a PR blocked-by a now-merged one may have become reviewable), and repeat from step 0 until no open work PR can advance.

**5. Surface the residue in ONE batch.** When nothing more can land, deal with the stuck-set exactly as drive-tasks does: **human present** → present the blocked/judgement-call PRs as one batched set of questions, take answers, resume; **no human reachable** → stop and report the stuck-set plus the landed/blocked summary. Never dribble questions one at a time.

## Confirm the run mode first

At the START, CONFIRM with the user (mirrors drive-tasks): squash vs. merge-commit for the `gh pr merge` (default `--squash --delete-branch`), and whether they want you to actually merge or only review-and-report the clusters (a dry-run: emit "these N PRs cluster into these groups, each would gate as one" without merging). Batch-MERGING is mutating and irreversible-ish (branches deleted), so a dry-run first pass is often the right default; offer it.

## Provider assumption

The `gh pr comment` + `gh pr merge` flow assumes **`propose` mode + a GitHub arbiter**, the only review-and-land surface dorfl exposes today. There is **no `dorfl` merge/land/approve verb yet** (checked against the CLI: `scan/run/do/advance/complete/promote/requeue/drop/intake/...`, none land a PR), so this skill is GitHub-propose-specific by necessity, same as `drive-tasks` step 5. In `merge` mode there are no PRs to batch. A future provider-agnostic land verb would let this skill drop the `gh` specifics; until then, adapt the merge mechanics to the repo's actual arbiter.

## Relationship to the other conductors

- **`drive-tasks`** BUILDS ready tasks (one at a time, build then review then merge). `merge-prs` starts where a build left an OPEN PR and batches the LANDING. Use `drive-tasks` to turn tasks into PRs; use `merge-prs` to turn a pile of PRs into merges cheaply.
- **`orchestrate`** is the meta-conductor over the whole tree. If it (or `run`) produced a burst of PRs, `merge-prs` is the natural closer to land them in a batch rather than one-by-one.
