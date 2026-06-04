---
title: Execution substrate decisions — jobs, isolation, deletion safety, seams, arbiters
slug: execution-substrate-decisions
type: finding
created: 2026-06-03
---

# Execution substrate decisions (ADR)

Captures the load-bearing decisions for how agent-runner runs work concurrently
and safely, agreed during design before any of the B/C-tier slices were built.
The slices `agent-workspaces`, `claim-command`, `arbiter-management`,
`harness-pi`, `integration-github`, and `watch` all depend on these.

## 1. Jobs, not agents

There is **no long-lived "agent" identity**. The unit is a **job** = one claimed
work item being processed. We do not name agents, pool agents, or track
per-agent clones. We track *active jobs* (and their liveness via the harness
seam, §5). This collapses earlier ideas about agent-name generators and
per-agent clone trees — they solved a problem we don't have.

## 2. Isolation: hub mirror + external worktrees (not N full clones)

Full `git clone` per job gives the best isolation but costs disk + transfer.
Instead:

- **One bare hub mirror per repo** under `~/.agent-runner/repos/<host>/<org>/<name>.git`
  (shared object store, cheap; re-fetched from the arbiter).
- **One git worktree per job**, checked out **outside** the hub at
  `~/.agent-runner/work/<work-id>/`, on branch `work/<slug>`.

Worktrees share the hub's objects (cheap) yet have independent working trees
(isolated). Git forbids the *same branch* in two worktrees — but each job is a
distinct slug ⇒ distinct `work/<slug>` branch, so the constraint is **naturally
avoided** by keying on the work item. (Claims serialize per slug via the arbiter
CAS, so the same slug never runs twice concurrently.)

### Encoding (repo → folder key)

From the arbiter remote URL, drop scheme/user/`.git`, and replace `.` → `-` per
segment (lossless, reversible; avoids the dotted-segment hazard that trips some
editors/tools and our own dotdir-pruning):

- `git@github.com:wighawag/agent-runner.git`
- hub (hierarchical): `repos/github-com/wighawag/agent-runner.git`
- work-id (flat, deterministic, unique per claim):
  `github-com__wighawag__agent-runner__<slug>`

Hierarchical for hubs (groups by host/org); **flat** for work-ids (so listing /
counting / GC of jobs is a flat `ls`).

## 3. `~/.agent-runner/` is STATE, not cache

The working area (hub mirrors + job worktrees) lives under a single visible
`~/.agent-runner/` (config-overridable). It is treated as **state**, NOT cache.

Why not `~/.cache`: a hub mirror *is* regenerable (true cache), but a job
worktree is **only conditionally** regenerable — before its branch is pushed to
the arbiter it holds the ONLY copy of the agent's commits (and any uncommitted
changes). Housing it under a cache dir invites the wrong reflex (OS cleaners,
"clear caches" scripts, a human `rm -rf ~/.cache/*`) and risks destroying
un-pushed work. So we classify the whole working area at the level of its
most-precious member: **state**. The "safe to delete" property is enforced
*behaviourally* (§4), never *spatially* by living in a cache dir.

## 4. Deletion safety = a provable arbiter-reachability predicate

A job's worktree is removed (auto, at end-of-job; or by `gc`) **iff**:

1. the working tree is **clean** (no uncommitted changes), AND
2. the job branch's tip is **reachable on the arbiter** — either merged into
   `<arbiter>/main` (`git merge-base --is-ancestor <tip> <arbiter>/main`), or
   pushed as an up-to-date branch (`<arbiter>/<branch>` tip == local tip).

Both hold ⇒ the worktree is genuinely redundant (reconstructible from the
arbiter) ⇒ delete. Otherwise ⇒ **retain for the human**.

Consequences:

- The trigger is **provable safety, not "success."** A successful-but-unpushed
  job is retained; a job whose commits are on the arbiter is reaped. One rule,
  no done-vs-failed special-casing.
- `propose` mode (§6) is delete-eligible because opening a review request implies
  the branch was **pushed** — but we verify *remote tip == local tip*, not merely
  "a review request exists" (guards a later un-pushed amend).
- The only worktrees that linger are **genuinely un-saved work** (failures,
  crashes, dirty trees) — a reliable "needs attention" signal that dovetails with
  `watch`'s surface-failures rail.
- **`gc`** re-applies the same predicate as a safety net (for when auto-delete
  didn't run — runner crash/kill). `gc --force` overrides (loud, never default).
- Removal is `git worktree remove` (+ prune), never a bare `rm -rf` (which would
  leave a dangling worktree registration on the hub).

## 5. Harness seam (liveness + invocation)

How a job is launched and how its liveness is observed is **pluggable** behind a
harness adapter; the core never hard-codes a specific tool.

- **null adapter** (this substrate's default, testable standalone): records PID,
  runs a configured command.
- **pi adapter** (first real target, own slice): liveness via PID + a pointer to
  the pi session dir/log; invocation via the pi CLI.

Liveness is reported by the harness, NOT inferred from filesystem mtime (a live
agent can think for minutes without writing files). mtime is not used.

## 6. Integration seam: mode × provider; push is the guarantee

Integration after green tests has two orthogonal axes:

- **Mode** (`integration` config): `merge` (ff/rebase onto `<arbiter>/main`, push
  to main — provider-agnostic git) or **`propose`** (push a branch + request
  review). *(Renamed from `pr`: "propose" is provider-neutral; "PR" is GitHub
  jargon that misleads for GitLab MRs / bare arbiters.)*
- **Provider** (the review-request tool, a seam): `github` (`gh pr create`, own
  slice), future `glab`/Gitea, or **`none`** (push the branch + tell the human to
  open a request manually — the graceful-degradation path, and the only option
  for a local `--bare` arbiter, which has no review concept).

The **universal, safety-bearing action is `git push`** to the arbiter; the
review request is layered on top and provider-specific. Deletion safety (§4)
rides on the push, never on the provider step — so a provider failure leaves a
safe, pushed branch, not lost work. The core calls `Integrator.integrate(job)`;
adapters own the tooling. Provider is auto-detected from the arbiter URL with an
explicit override; default `none` when unknown.

## 7. Arbiters are precious DATA → `~/git/`, agent-runner-managed

A local `--bare` arbiter (offline mode) is the **source of truth**, not cache or
state — the thing §4's predicate proves everything else safe *against*. It must
NOT live under `~/.agent-runner/` (a `gc`/cleanup mishap could nuke the only
copy). Default location: **`~/git/<host>/<org>/<name>.git`** (hierarchical;
visible, memorable, easy to back up / put on a synced/archived folder),
overridable via `arbitersDir`. agent-runner *provisions/locates* it
(`arbiter init` from an existing repo, `arbiter status`) but treats its bytes as
precious.

Three ownership tiers (do not conflate):

| Tier | Role | Disposable | Location |
| --- | --- | --- | --- |
| your working repos | where you edit | no | `~/dev/...` |
| hub mirrors + job worktrees | execution **state** | conditionally (§4) | `~/.agent-runner/` |
| arbiters (offline) | **source of truth** | no | `~/git/...` |

## 8. The acceptance gate is a per-repo `verify` seam; authority differs by caller

The gate that decides whether work is acceptable is a **per-repo declared
command** (`verify` config, e.g. `pnpm -r build && test && format:check`),
exposed as `agent-runner verify`. NOT per-slice: a per-slice gate would force a
model to interpret prose to decide what "passing" means — putting an LLM inside
the trust boundary, which is exactly where we want determinism. Per-repo config
keeps the gate a dumb, auditable shell command (and means there is nothing to
"cache" — the gate is known by reading config, no model call).

One mechanism, two callers, different **authority**:

- **Autonomous runner** (`run-once`/`watch`): the gate is the **non-negotiable
  trust boundary** (PRD story 12 — bad work never reaches `done/`). The agent's
  own "I'm done / tests pass" is a hint, NEVER a substitute; the runner runs
  `verify` itself and that is the verdict. No skip.
- **Human `complete`**: the human is the trusted operator, so `verify` runs as a
  **default-on safety-net** with `--skip-verify` to opt out ("I already ran it").

A possible later optimization is caching *test results* (skip re-running when the
git tree is unchanged) — but it must be off-by-default for the authoritative
autonomous gate (a safety boundary must not trust a cache). Out of scope for now.

## 9. agent-runner is the primary implementation; contract + `claim.sh` are the portable substrate

agent-runner and the `to-slices` skill (the `work/` contract,
`CLAIM-PROTOCOL.md`, `claim.sh`) are **one project / one vision**. agent-runner
grows a first-class **`claim` command** (TS) that implements the same claim CAS
as `claim.sh`, with identical exit-code semantics.

- The **contract docs stay tool-agnostic and primary** (the stable interface).
- **`claim.sh` is retained** as the zero-dependency, portable bootstrap / reference
  implementation (it is how the very first slice gets claimed before agent-runner
  can build anything).
- The other behaviours designed here (isolation §2, deletion §4, integration §6)
  are likewise **protocols**, not just features. Follow-up (own task, not these
  slices): author companion contract docs in the skill repo
  (e.g. `EXECUTION-PROTOCOL.md`, `INTEGRATION-PROTOCOL.md`) once the
  implementation proves them out, so other tools can implement the same protocols.

## 10. Merge conflicts: rebase-or-abort, never auto-resolve

`blocked_by` encodes LOGICAL ordering, not FILE ordering: two independent slices
can touch the same files and conflict when the second integrates after the first.
Conflicts between parallel branches are therefore **inherent**, not a bug. We do
NOT try to prevent them with file reservations / locks (that reintroduces the
shared-state coordination the `work/` contract bans, and agents can't reliably
predeclare touched files). Instead:

- **Rarer, by design (slicing guidance):** prefer thin, file-orthogonal slices;
  when two slices are known to touch the same module, add a `blocked_by` to
  serialize them. This is the slicer's judgement (documented in the
  `to-slices` skill), not enforced by tooling.
- **Cheaper + safe, by tooling:** at integration time the runner / `complete`
  does a **deterministic rebase** of `work/<slug>` onto the latest
  `<arbiter>/main`. A **clean** rebase proceeds. A **conflicting** rebase is
  `git rebase --abort`ed, the job is marked **needs-attention**, and it is
  surfaced (the retained worktree is the signal; dovetails with `watch`'s
  surface-failures rail).
- **Never auto-resolve.** agent-runner deterministically *attempts* the rebase
  and *detects* conflict; it does NOT pick `--ours`/`--theirs` or any heuristic,
  because a conflict resolution requires SEMANTIC judgement and a wrong-but-
  compiling merge is the worst outcome (it passes the gate, the code is broken).
  Resolution is a human task (or a future, explicitly conflict-prompted
  `resolve`-agent — distinct from the build agent, which still does no git).
- The build agent is unaffected: it does no git writes (read-only `git log`/`diff`
  for context is fine). Rebase/integration/conflict-surfacing are the runner's.

## 11. Integration mode is resolved at integrate-time, per-repo, never at start-time

Whether work lands via `merge` (direct to main) or `propose` (push a branch +
request review) is decided **where it applies — at `complete`/integrate time**,
NOT at `start` time. Stamping a mode at start would force it into slice
frontmatter (rejected: that puts non-source-of-truth runtime policy into
declarative slice content, the same anti-pattern as per-slice gates) or into a
side-channel the human in-place flow doesn't have. Nothing in the build phase
depends on the mode, so there is nothing to carry forward.

Resolution precedence (highest first), identical for human and autonomous paths
except the flag is human-only:

1. `complete --merge` / `--propose` flag (human, per-invocation)
2. per-repo config override (a committed repo-root `.agent-runner.json`)
3. global config `integration`
4. built-in default `propose`

`propose` is the safe default (human reviews before main moves — essential for
unattended/autonomous work). `merge` is opt-in for repos where trust × low
blast-radius × a strong `verify` gate make hands-off landing acceptable.
Integration mode (and `verify`, arbiter) are repo properties, so they live in a
per-repo config layered over global — letting repo A be `merge` and repo B
`propose` in the same multi-repo run.

## 12. Stuck items move to `needs-attention/` (folder-native surfacing, not labels)

Every "couldn't finish, a human must look" outcome — a failed acceptance gate, a
rebase/merge conflict (§10), a slice the agent found too ambiguous to build, a
timeout, a rejected review — resolves to ONE mechanism: the runner `git mv`s the
claimed item from `work/in-progress/<slug>.md` to `work/needs-attention/<slug>.md`,
writing the reason (+ any surfaced agent questions) into the file body. This is
the folder-native form of "needs-attention surfacing" (which we had parked as an
open problem): the surface is a folder you can `ls`, read by `scan`/`status` — no
labels, no status field (honours WORK-CONTRACT rule 3: status = folder).

Why folders, not Matt-Pocock-style labels: a mutable status/label *field* that
every transition rewrites is a shared conflict point (rules 2–3). Moving a file
between folders is conflict-safe by construction. So we borrow the *concept* of
triage/needs-attention states but express them the contract's way — as folders +
`git mv`.

Decisions:

- **One folder for now: `needs-attention/`** — the *post-claim, attempted-but-
  stuck* state. We deliberately do NOT add a separate *pre-claim* "not ready to
  claim" state (a la intake `needs-triage`/`needs-info`): under-specified items
  simply should not be written into `backlog/` until ready. (Solo-with-agents has
  no separate "reporter" to wait on, so `needs-info` doesn't map cleanly.) Revisit
  only if a real intake-triage need appears.
- **The runner owns the move** (not the build agent — agents do no git). It writes
  the reason, `git mv` in-progress -> needs-attention, commits/pushes like the
  done-move.
- **Not claimable, but surfaced:** `scan`/eligibility skip `needs-attention/` for
  claiming; `status` lists them with their reason (this folder is the "look here"
  set; dovetails with the retained-worktree signal).
- **Return path:** a human resolves the cause and `git mv`s the item back to
  `backlog/` to be re-claimed (or resumes on its branch). It must not rot.
- This unifies and subsumes the previously-separate "needs-attention surfacing"
  concern across the gate, conflict, ambiguity, and timeout outcomes.

## 13. Model selection is agent-runner's (via the harness seam); auth/keys are the harness's

The runner decides **which model** a job runs on; it never touches **credentials**.
This is the clean boundary: model = routing intent agent-runner controls; API keys,
OAuth, provider base URLs = the agent harness's job, out of scope for agent-runner
(the harness — `pi`, or whatever `agentCmd` wraps — already does auth well, and a
portable runner must not duplicate per-provider secret handling).

Decisions:

- **`model` is a first-class, harness-agnostic field** carried through the harness
  seam (`LaunchInput.model`). The CORE passes the *intent* (a model id); the
  ADAPTER decides how that reaches its tool:
  - the **pi** adapter passes it natively (`--model <model>`);
  - the **null/shell** adapter substitutes a `{model}` placeholder in `agentCmd`
    (degradation rules: placeholder + no model ⇒ a clear config error; no
    placeholder ⇒ run the command as-is — agent-runner offers model routing but
    never forces it, so a user who bakes the model into `agentCmd` or relies on the
    harness's own default is untouched).
  This mirrors §6's seam discipline: one declared intent, adapter-specific
  realization; the core stays tool-agnostic.

- **`model` resolves per-repo, like `integration`/`verify`:** flag (`--model`) >
  per-repo `.agent-runner.json` > global > default (unset). So `model` joins
  `REPO_ALLOWED_KEYS` — choosing the model for *this repo's* work is a legitimate
  repo property. `harness` (which adapter) is likewise repo-appropriate and
  allowed per-repo; `piBin` and `agentCmd` stay **host-only** (rejected per-repo)
  because they are machine paths/commands, not repo policy.

- **Auth stays in the harness, always.** agent-runner sets no API keys, writes no
  `auth.json`/`models.json`, and reads no secrets. (The CI `install-ci` work —
  separate PRD — wires harness auth as a harness concern, mirroring whitesmith.)

- **Per-ROLE model (build vs slice vs review vs grilling) is STAGED, not built
  now.** A single `model` covers the build path today. Each future capability
  brings its own role override *as it becomes real* (e.g. `auto-slice` adds a
  `slice` model; review adds a `review` model) — resolved as role-override > base
  `model`, then through the per-repo chain. We do NOT spec the role map up front
  (it would be config for capabilities that don't exist yet — speculative
  generality that goes stale). The `model` field is shaped so a later `perRole`
  map layers on without breaking it.
