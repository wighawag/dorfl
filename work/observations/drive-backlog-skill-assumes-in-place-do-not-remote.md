---
title: the drive-backlog skill is written for IN-PLACE `do` only — it needs a `--remote` mode (and an open question whether `--remote` should be the ONLY way the conductor builds, leaving local main alone)
date: 2026-06-11
status: resolved
---

> RESOLVED 2026-06-12 (maintainer decision). The open question — "should `--remote`/`--isolated` be the ONLY way the conductor builds?" — was answered **YES**: `drive-backlog` now ALWAYS builds `--isolated` (a worktree off the arbiter), with NO in-place fallback. A local-only/un-pushed slice is pushed to the arbiter first rather than built in-place. The skill also no longer hardcodes `--review`/`--propose`: `--isolated` is the one pinned flag, review/integration mode is left to config (the autonomy-gate family — `review`/`allowAgents`/`autoSlice`/`autoTriage` — stays human-first off-by-default; `--propose` is already `do`'s default), and the conductor CONFIRMS the run mode with the user at the start of a drive. Implemented in `skills/drive-backlog/SKILL.md`. Kept for provenance.

## The signal

While driving this repo's backlog, the conductor was asked to build every ready slice with `agent-runner do … --remote origin --arbiter origin` so each `do` runs in an isolated job worktree on the arbiter rather than in the human checkout. The `drive-backlog` skill (`skills/drive-backlog/SKILL.md`, symlinked from `~/.agents/skills/`) does NOT support this: it is written assuming the IN-PLACE `do` form (build in the current checkout), and several of its load-bearing rules are wrong or misleading once `--remote` is used.

The skill was NOT edited (deliberately, per the human directive — capture the work to be done here first, decide the shape, then edit). This observation is the spec for that future edit.

## What in the skill is in-place-specific and must change for `--remote`

- **"Selection + isolation" section** explicitly says: *"Builds run in-place (`do slice:<slug>` in the current checkout) … it never uses `--remote` (that is `run`'s daemon mechanism, not a conductor's)."* This is the single most-contradicted line — `--remote` IS a legitimate conductor mechanism (per-job-worktree isolation on the arbiter, no daemon, still one-slice-at-a-time).
- **Golden rule 1** ("One slice at a time … so rebases stay trivial"): with `--remote` there are NO local rebases — isolation is per-job-worktree on the arbiter, reaped after each build. Sequential is still the right cadence (clean unlock + Gate-3 review rhythm), but the JUSTIFICATION ("rebases stay trivial", "edits to the same hot file serialise") is in-place reasoning.
- **Golden rule 5** ("Clean tree before every `do` — `do` refuses on a dirty tree"): does NOT apply to `--remote`. `--remote` never reads the human checkout, so a dirty local tree is irrelevant to the build. The conductor STILL wants to commit its own `work/observations/` notes for hygiene, but it is no longer a hard precondition of dispatching the next build.
- **Step 4a** ("Build it (clean tree first)") + **Step 4d** ("`git checkout main && git fetch && git pull --rebase`; rebuild the local dist so the merge is in the binary"): the rebase dance is in-place-specific. With `--remote` you only `git fetch` to RECOMPUTE the READY set (the remote is the source of truth), and — if you drive off a locally-built dist — rebuild it; you do NOT rebase local main, and you do not need a clean local tree.
- **"How it stalls / Selection + isolation"** prose generally assumes the in-place checkout is the isolation boundary. Under `--remote` the boundary is the agents'-area hub mirror + job worktree (`workspacesDir`), the SAME isolation `run` uses.

## What stays the same (the loop shape is intact)

The conductor discipline is unchanged: analyse the graph → freshness-check each ready slice → select + order → per slice BUILD (`do … --remote`) → Gate-3 review the opened PR → merge → re-evaluate → accumulate-don't-block → surface the stuck-set. Gate-3 (verdict-as-PR-comment + `gh pr merge`) is identical (still `--propose` + GitHub arbiter). Only the per-item BUILD command and the inter-build housekeeping change.

## The open QUESTION for the human (do not decide unasked)

Should `--remote` become the conductor's DEFAULT (or ONLY) build mechanism — i.e. should `drive-backlog` ALWAYS build via `do --remote <arbiter>` and leave local `main`/the human checkout completely alone?

Arguments FOR making `--remote` the only way:
- The human's checkout is never mutated mid-drive — no claim reverts, no done-moves landing in the working tree, no dirty-tree refusals, no "rebuild the dist between merges" dance, no entanglement with whatever the human has uncommitted. The conductor becomes a pure observer of the arbiter.

  > **Concrete evidence (2026-06-11):** while a human + assistant chat was authoring `work/ideas/` notes in THIS checkout, a concurrent autonomous `do`/`run` job (`advance-verb-resolver`) was ALSO operating in the same working tree, and its requeue chore commit (`8c92f63 chore(advance-verb-resolver): return to backlog for re-claiming`) SWEPT UP the assistant's three then-uncommitted idea files into the runner's own commit (a `git add`/`-a` over the shared tree). The files landed correctly byte-for-byte, but under a misleading, unrelated commit message — an unscoped-commit / cross-actor entanglement that is IMPOSSIBLE if the conductor/daemon builds only in an isolated job worktree and treats the human checkout purely as an ORIGIN SOURCE (read the remote), never as a place it writes or commits. This is the entanglement this argument warns about, observed live.

- **Corollary — `drive-backlog` (and any conductor/daemon) must NOT write/commit in a repo it is merely run FROM.** When invoked from a checkout, the cwd repo is ONLY a mechanism to resolve the origin/arbiter; the build, claim-moves, done-moves, and commits all happen in the ISOLATED worktree on the arbiter — never in the cwd working tree. The skill currently does the opposite (in-place by default, committing its own observations into the cwd tree per golden rule 5), which is exactly what allows a concurrent writer (human OR another job) in that same tree to collide. The `--isolated` / `--remote` build mode is what enforces "cwd = origin source, not a write target".
- Isolation is genuinely per-build (a stuck build leaves a `work/<slug>` branch on the arbiter; nothing leaks into the checkout).
- It matches `run`'s isolation model, so conductor and daemon converge on one substrate.

Arguments AGAINST / caveats:
- `--remote` currently IGNORES per-repo `.agent-runner.json` (separate observation: `remote-do-ignores-per-repo-config.md`) — so `harness`/`verify`/`provider` silently fall back to global+default. Until that is fixed, `--remote` can run a DIFFERENT harness/gate than the repo declares (we hit exactly this: `harness: pi` dropped → null-adapter "no agentCmd" error, worked around with `--harness pi`).
- It needs the slice + its deps to be ON the arbiter (`origin/main`), so a local-only/untracked slice is invisible (we hit this with `null-harness-empty-command-guard`, untracked). In-place `do` can build a slice that only exists locally.
- A materialise-mirror-then-reap per build is slower than reusing the checkout.

Suggested resolution shape: make the skill `--remote`-AWARE now (document both modes, caveat the in-place-only rules), and make `--remote` the RECOMMENDED conductor mode once `remote-do-ignores-per-repo-config` is resolved — but keep in-place as the fallback for local-only slices / offline / single-checkout convenience. Decide explicitly rather than silently flipping the default.

## The precise mechanism of the entanglement — and it is NOT just `do`

Follow-up investigation (2026-06-11) into HOW the sweeping commit happened pins it on **`requeue`, not `do`**, and surfaces a broader gap than the `do`-isolation one above.

- **`--isolated` is a `do`-ONLY flag.** It is defined exclusively in the `do` command block (`cli.ts` ~L1272, part of `DoFlags`). `requeue`'s options are only `--config`/`--cwd`/`--arbiter`/`--reset`/`-m`. So the runner's requeue COULD NOT have passed `--isolated` — there is no such flag on `requeue`.
- **`requeue` does its `git mv` + commit DIRECTLY in `--cwd` (default `process.cwd()`).** It is a pure file/git transition (no build): `git mv work/needs-attention/<slug>.md → work/backlog/<slug>.md`, commit, optionally push to `--arbiter`. That commit, made in the SHARED working tree, is what swept up the assistant's uncommitted `work/ideas/` files into `8c92f63`.
- **Contrast `claim`** (`performClaim`, "in-process; mirrors scripts/claim.sh"): it builds the transition as an atomic **compare-and-swap push to the ARBITER ref** and does NOT stage/commit in the cwd working tree. The cwd is its repo context (to find the arbiter), not a write target. `claim` is already "cwd = origin source, not a write target"; `requeue` is the outlier that writes the cwd tree.

### The correction (do not mis-state the cause)

The cause is **NOT "requeue is a human verb so it writes the cwd"** — that conflates two ORTHOGONAL things. Human-vs-agent is about commit ATTRIBUTION (identity); it does NOT dictate WHERE the write lands. `requeue` writing the cwd working tree is an IMPLEMENTATION choice, not a consequence of being a human verb. It could isolate its write exactly like the build path does:

- **(a) Tree-less CAS push, like `claim`.** The move is a single file rename — it does not need a working tree at all; construct the commit and CAS-push it to the arbiter. This is the cleanest fix and makes `requeue` consistent with `claim`.
- **(b) Ephemeral worktree.** Even from inside a repo, `requeue` could create a throwaway worktree off the arbiter, do the `git mv` + commit + push there, and reap it — never touching the cwd working tree.

The `claim`/`requeue` inconsistency (one is tree-less, the other writes the cwd) is itself worth fixing: a backlog-folder transition should have ONE mechanism, and the safe one (no cwd write) is the one `claim` already uses.

### The broader gap

It is not ONLY `do` that must leave the cwd working tree alone. ANY runner-driven transition an autonomous driver invokes in a shared checkout (`requeue` today; potentially others) must not commit in that working tree, or it can collide with whatever a human/assistant is editing there. The `do`-isolation work above is necessary but not SUFFICIENT — the tree-less / isolated-write discipline must extend to the folder-move verbs too.

## Where

`skills/drive-backlog/SKILL.md` — the "Selection + isolation" section, golden rules 1 + 5, steps 4a/4d, and the "When to use vs. not" line that opposes `--remote` to the conductor. PLUS the runner itself: `requeue` (`cli.ts` ~L1808 → `ledgerWrite.applyReturnToBacklogTransition`) should move to a tree-less CAS push (like `performClaim`) or an ephemeral worktree, so it never commits in a shared cwd working tree. Cross-ref: `review-nits-remote-do-reads-per-repo-config-from-arbiter-main-2026-06-11.md` (the per-repo-config read that gates making isolated/`--remote` the default) and `work/ideas/make-isolated-the-default-build-mode.md`.
