---
title: agent-runner — autonomous parallel agents over file-based work/
slug: agent-runner
blockedBy: []
covers: []
---

## Problem Statement

I have many repos. I want autonomous parallel agents to pick up and complete work
across all of them — configurable which repos participate, but detectable without a
hand-maintained registry. The work items already have a home: the file-based `work/`
contract + atomic claim protocol defined in the `to-slices` skill
(`~/dev/github/wighawag/skills/to-slices/` — see WORK-CONTRACT.md and
CLAIM-PROTOCOL.md). What is missing is the thing that discovers, schedules, and runs
that work.

## Solution

A small TS/Node CLI, `agent-runner` (this repo), built in three increments:

- **A. `scan`** (read-only) — detect participating repos and list eligible work items.
- **B. `run --once`** — claim up to N eligible items and run an agent on each in an
  isolated worktree/clone, integrate the results, then stop (supervised).
- **C. `watch`** — loop B on an interval with safety rails (the autonomous endpoint).

agent-runner is also the **first dogfood test** of the `work/` + `to-slices`
system: it tracks its own work in its own `work/` folder.

## User Stories

1. As the maintainer, I want `scan` to list all repos with claimable work across my
   configured roots, so that I can see my cross-repo queue at a glance.
2. As the maintainer, I want a repo to "participate" simply by having a non-empty
   `work/backlog/`, so that there is no separate registry to maintain.
3. As the maintainer, I want to include/exclude specific repos via config, so that I can
   override detection where needed.
4. As the maintainer, I want `scan` to show, per item, its repo, slug, autonomy gate
   (`humanOnly` / undeclared), and whether its `blocked_by` deps are satisfied, so that I
   know what is runnable now.
5. As the maintainer, I want `run --once` to claim eligible items atomically (via
   `claim.sh`) and skip any it loses the race for, so that parallel ticks never collide.
6. As the maintainer, I want each agent to run in its own worktree/clone, so that
   concurrent code changes cannot corrupt shared state.
7. As the maintainer, I want a finished item to integrate in `propose` mode by default
   (push a branch + request review; e.g. a GitHub PR via the provider seam), so that I
   review before merge.
8. As the maintainer, I want to optionally configure direct-merge-to-main where allowed,
   so that trusted/low-risk repos can run fully hands-off.
9. As the maintainer, I want the autonomy gate to be configurable per repo: strict by
   default (agents claim nothing automatically), but optionally `allowAgents` so agents may
   claim any slice not marked `humanOnly: true`, so that I control how much autonomy is
   granted.
10. As the maintainer, I want concurrency caps (`maxParallel`, `perRepoMax`), so that the
    runner never fork-bombs my machine or rate-limits a remote.
11. As the maintainer, I want `watch` to stop on max-iterations/duration and surface
    failures (timeout, red tests) instead of infinite-retrying, so that unattended runs
    stay safe.
12. As the maintainer, I want an item to reach `work/done/` only when its acceptance tests
    pass; otherwise it stays in `work/in-progress/` (or moves to a needs-attention folder)
    for me, so that bad work never auto-merges.

## Implementation Decisions

(Made with the maintainer — do not relitigate.)

- **Repo:** this one, `~/dev/github/wighawag/agent-runner`. TS/Node CLI scaffolded
  from `template-typescript-lib` (`~/dev/github/wighawag/template-typescript-lib`):
  a **pnpm monorepo** (`type: module`, NodeNext, `tsc` build, changesets, prettier
  with tabs+single-quotes, vitest, `tsx` for dev). The CLI lives in
  `packages/agent-runner/` (`bin: { "agent-runner": "dist/cli.js" }`, node>=18,
  dev via `tsx src/cli.ts`); the repo root holds the workspace, changesets, and
  this `work/` folder. Kept a monorepo so we can extract shared packages later.
  Minimal runtime deps: **`commander`** for the CLI surface (`scan`/`run`/`watch`
  + flags); the deterministic core stays dependency-free.
- **Execution engine = standalone (option C):** agent-runner shells out to `git` and a
  configured agent command ITSELF. It does NOT depend on any specific harness's built-in
  subagent/parallel/worktree mode — for portability.
- **The runner owns all git-state transitions; the agent only writes code.** The spawned
  `agentCmd` produces code changes and gets acceptance tests green — nothing more. agent-runner
  performs the claim (via `claim.sh`), the `git mv` to `work/done/`, the work commit, and
  integration. The prompt handed to `agentCmd` must state "do not commit/push; do not move
  `work/` files" **in-band** — we do NOT rely on the host's global agent config (e.g. an
  `AGENTS.md` no-auto-commit rule), since other users won't have it. This keeps the test-gate
  authoritative (the agent can't merge around it) and the inner agent honest by construction.
  Practical note: the mover must `mkdir -p work/<status>/` before `git mv` (git doesn't track
  empty dirs, so `work/done/` may not exist yet); no `.gitkeep` placeholders.
- **Completed-slice commit message format:** the commit that completes a slice (work + the
  `git mv` to `work/done/`, one atomic commit) uses `<type>(<slug>): <summary>; done` — e.g.
  `feat(scan): cross-repo eligible-work queue (read-only); done`. The trailing `; done`
  marks the backlog→done transition (mirroring the `claim: <slug>` message for
  backlog→in-progress). agent-runner authors this deterministically; it is also documented in
  the work-contract (CLAIM-PROTOCOL.md) for human/other consumers.
- **`agentCmd` prompt = constant wrapper + the slice's `## Prompt`.** agent-runner builds the
  prompt it hands to `agentCmd` deterministically: a small fixed wrapper (only the `<slug>`
  varies) around the claimed slice's own `## Prompt`. The wrapper points the agent at
  `work/in-progress/<slug>.md` as its brief, says "implement to satisfy the Acceptance
  criteria," and draws the git boundary IN-BAND: the agent does NO git ops on the repo (no
  commit/push, no moving `work/` files) — though its TESTS may use their own throwaway repos —
  and stops + reports when build/test/format are green. The canonical wrapper text lives in
  the work-contract (CLAIM-PROTOCOL.md → "The prompt handed to the work agent"); agent-runner
  implements that template. In-band (not via a host `AGENTS.md`) because the runner is portable
  and can't assume any host rule exists.
- **Integration mode: configurable, default `propose`.** `propose` = push a `work/<slug>`
  branch + request review via a provider seam (GitHub PR via `gh`, GitLab MR, etc., or
  `none` = pushed + open-manually); `merge` (direct to main) where explicitly allowed.
  *(Renamed from `pr`: "propose" is provider-neutral; "PR" is GitHub jargon — see the
  integration seam in `docs/adr/execution-substrate-decisions.md` §6.)* The universal,
  safety-bearing action is the `git push`; the review request layers on top. Never `--force`
  to main; the only `--force-with-lease` is the claim micro-commit (in `claim.sh`).
- **Autonomy gate: a binary slice field `humanOnly` + a per-repo `allowAgents` policy,
  strict by default.** The slice declares `humanOnly: true` (never auto-claim — deliberately
  human-only) or omits it (undeclared; most slices). The repo policy `allowAgents` decides
  whether agents may claim undeclared slices, resolved like `integration` (flag
  `--allow-agents`/`--no-allow-agents` > per-repo `.agent-runner.json` > global > default
  `false`). The runner resolves: agent-claimable iff `humanOnly` !== true AND `allowAgents`.
  (Replaces the old three-state `afk` field + `allowUnspecifiedGate`; see WORK-CONTRACT.md +
  `docs/adr/methodology-and-skills.md` §4.)
- **Detection:** a repo participates iff it has a `work/backlog/` dir with >= 1 `.md`. Scan
  configured `roots`, prune `node_modules`/dotdirs. Config `include`/`exclude` override.
- **Eligibility (run/watch):** runnable iff (a) passes the autonomy gate (not `humanOnly`
  AND the repo's `allowAgents` is on) AND (b) every slug in `blocked_by` is present in that
  repo's `work/done/`. Claiming is optimistic; the loser of a race gets `claim.sh` exit 2
  and moves on.
- **Consumes the existing contract** (status = folder; one file per item; content-slug IDs;
  `blocked_by`; advisory `claimed_by`) and the verified `skills/to-slices/scripts/claim.sh` (atomic CAS push
  to an arbiter remote — GitHub or local `--bare`).

### Config sketch (`~/.config/agent-runner/config.json`)

```jsonc
{
  "roots": ["/home/wighawag/dev/github/wighawag", "/home/wighawag/dev/github/jolly-roger-eth"],
  "include": [], "exclude": [],
  "maxParallel": 4, "perRepoMax": 2,
  "defaultArbiter": "origin",
  "integration": "propose",
  "allowAgents": false,
  "agentCmd": "<command to run one agent on a slice prompt>"
}
```

## Testing Decisions

- Good tests check **external behaviour**, not internals. The deterministic core —
  config-merge, repo detection, eligibility (autonomy gate + `blocked_by` resolution), slug/
  frontmatter parsing — is highly testable and should be tested first (TDD).
- Use **vitest** (repo convention across wighawag projects). Test detection + eligibility
  against fixture directory trees; test the claim integration against throwaway git repos +
  a local `--bare` arbiter (the pattern already used to verify `claim.sh`).
- Mirror the `claim.sh` verification approach: a simultaneous two-agent race must show
  exactly one winner.

## Out of Scope (for early increments)

- A GraphQL/HTTP control surface or web UI.
- Cross-repo dependency graphs (deps are per-repo only — claims never cross repos).
- A long-lived daemon/service; `watch` is a bounded session, not a system service.
- Auto-merge as the default (default is `propose`; direct `merge` is opt-in).

## Further Notes

- **Bootstrapping:** the claim protocol needs an arbiter remote; this repo must be
  `git init`'d with a remote (GitHub or a local `--bare`) before B/C can claim its own
  items. That setup is a first-session step.
- Build order: **A (scan) first** — read-only, immediately useful, forces the
  detection/config/eligibility design to be concrete before any agent executes. Then B,
  then C with the rails above.
- Slice this PRD with `to-slices` into `work/backlog/` as the first action of
  the build session — dogfooding the system agent-runner is meant to run.
