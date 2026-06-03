# CONTEXT — agent-runner domain language

The domain glossary for `agent-runner`. Agents and skills should use THIS
vocabulary when naming modules, tests, and discussing the system — it is the
shared language. Architectural rationale lives in `docs/adr/` (decisions); product
framing lives in `work/prd/`.

## What agent-runner is

A small TS/Node CLI that discovers, schedules, and runs work across many repos —
both as a guided **human loop** and as an unattended **autonomous runner** — on
top of a file-based `work/` contract and an atomic claim protocol. It is built by
dogfooding itself (it tracks its own work in its own `work/`).

## Core domain terms

- **work/ contract** — the on-disk system this consumes (defined in the
  `wighawag-work-slices` skill): one markdown file per item, **status = the folder
  it lives in** (never a field). See that skill's `WORK-CONTRACT.md`.
- **slice** — one buildable work item: a tracer-bullet vertical slice, a markdown
  file `work/backlog/<slug>.md`. Has frontmatter: `slug`, `prd`, `afk`,
  `blocked_by`, `covers`.
- **PRD** — a north-star doc in `work/prd/<slug>.md` a slice's `prd:` field points
  at. (The launch/framing doc; may be a hand-off snapshot.)
- **ADR / finding** — a decision record in `docs/adr/<slug>.md` (the *why* of a
  technical choice; durable). The substrate decisions are in
  `docs/adr/execution-substrate-decisions.md` (§1–§12).
- **slug** — content-derived, URL-safe id of an item (never a counter).
- **status (lifecycle)** — the folder: `backlog/` (claimable) → `in-progress/`
  (claimed) → `done/` (completed), or → `needs-attention/` (stuck) or
  `out-of-scope/`. Transitions are `git mv`.
- **afk gate** (`afk` field) — *may an autonomous runner claim this unattended?*
  `true` = yes; `false` = human-only; *omitted* = decided by
  `allowUnspecifiedGate`. Orthogonal to lifecycle status.
- **blocked_by / eligibility** — an item is **eligible** iff its afk gate passes
  AND every `blocked_by` slug is present in the SAME repo's `work/done/`. Deps
  never cross repos.
- **needs-attention** — the post-claim **stuck** state (`work/needs-attention/`):
  a claimed item that couldn't finish (red gate, conflict, ambiguity, timeout,
  rejected review). The runner `git mv`s it here with a reason; a human resolves
  and moves it back to `backlog/`. Folder-native surfacing (no labels). (ADR §12.)

## Claim & integration terms

- **arbiter** — the single git remote whose `main` ref serialises claims (GitHub,
  or a local `--bare` repo). Default remote name `origin`.
- **claim (CAS)** — atomically moving an item `backlog → in-progress` by pushing a
  micro-commit to the arbiter's `main` with `--force-with-lease`; the first push
  wins, losers get exit 2 and pick another item. Implemented by `claim.sh`
  (portable bootstrap) and `agent-runner claim` (the in-process version).
- **work branch** — `work/<slug>`, branched off the latest arbiter `main`, where a
  slice is built.
- **integration mode** — how finished work lands: **`propose`** (push a branch +
  request review; the default) or **`merge`** (direct to main, opt-in for
  trusted/low-risk repos). Resolved at integrate-time: flag > per-repo > global >
  `propose`. Never `--force` to main. (ADR §6, §11.)
- **verify (the gate)** — the per-repo acceptance command (`agent-runner verify`,
  e.g. `pnpm -r build && test && format:check`). The deterministic trust boundary:
  authoritative & non-skippable for the autonomous runner; default-on but
  `--skip-verify` for the human `complete`. (ADR §8.)

## Execution-substrate terms

- **job** — one claimed item being processed (there is NO long-lived "agent"
  identity; the unit is the job). (ADR §1.)
- **hub mirror** — one bare mirror per repo under `~/.agent-runner/repos/<key>.git`
  (the shared `repo-mirror` primitive); cheap shared object store.
- **worktree** — a job's isolated working tree off the hub mirror, under
  `~/.agent-runner/work/<work-id>/`, on branch `work/<slug>`. (ADR §2.)
- **work-id** — flat, deterministic key for a job:
  `<host-...>__<org>__<name>__<slug>` (the repo key with `.`→`-`, then the slug).
- **repo key** — hierarchical `host/org/name` with `.`→`-` per segment
  (`github-com/wighawag/agent-runner`).
- **deletion predicate** — a job worktree is removed only when its work is
  **provably on the arbiter** (clean tree AND branch tip reachable on the
  arbiter); otherwise retained (a retained worktree is a needs-attention signal).
  `gc` re-applies it. (ADR §4.)
- **harness seam** — pluggable interface for launching a job's agent and reporting
  liveness (null adapter; pi adapter is its own slice). Liveness from the harness,
  never filesystem mtime. (ADR §5.)
- **integration seam** — `Integrator` with modes (`merge`/`propose`) × providers
  (`github` via `gh`, `none` = push + open-manually). Push is the safety-bearing
  action. (ADR §6.)

## The two faces (commands)

- **Human loop:** `scan` (cross-repo queue) → `start` (claim + onboard) →
  `prompt` (emit the work-agent prompt) → build → `verify` → `complete` (gate +
  done-move + commit + integrate). `work-on` for parallel human worktrees.
- **Autonomous:** `run --once` (claim N eligible, run agents in isolation,
  integrate, stop) and `watch` (bounded loop over `run --once` with safety rails).

## Invariants (do not relitigate — see ADRs)

- The **runner owns all git-state transitions**; the build agent only writes code
  and gets the gate green (stated in-band in the agent prompt).
- **Status = folder, never a field** (conflict-safety). One file per item; no
  shared index; content slugs, never counters.
- Conflicts: **rebase-or-abort, never auto-resolve** → needs-attention. (ADR §10.)

## House style

pnpm monorepo (CLI in `packages/agent-runner/`), `type: module`, NodeNext, tsc,
prettier (tabs + single quotes), vitest, `commander`. Tests mirror the `claim.sh`
verification: throwaway git repos + a local `--bare` arbiter. Acceptance gate is
`pnpm -r build && pnpm -r test && pnpm -r format:check` (see `AGENTS.md`).
