---
title: 'Smithers (smithers.sh) is prior art / a fellow-traveller for dorfl: same "durable orchestration is the stable layer" thesis, but resolved on a SQLite ledger with a runtime guarantee rather than on a git + work/ ledger with an in-band protocol'
type: finding
date: 2026-07-23
verified: 2026-07-23
source: smithers.sh landing page + /introduction + /how-it-works + /why/vs-claude-code-workflows + /why/vs-temporal + /why/vs-langgraph (fetched 2026-07-23); MIT, https://github.com/smithersai/smithers
---

# Smithers is dorfl's thesis on a different ledger

**Smithers** (smithers.sh, MIT, open source) is a durable runtime for orchestrating AI coding-agent workflows. It is worth recording here because it argues, explicitly and well, the SAME founding thesis dorfl is built on: that the fashionable layer of agent-building (chains, ReAct, crews, swarms, subagent fan-out) churns every few months, while the layer underneath (durable steps, retries, state, approvals, observability) never changes, and THAT is the layer worth building on. Where Smithers is most useful to us is not as a dependency but as a sharp contrast: it resolves the harness-independence question the OPPOSITE way to dorfl, and seeing both side by side sharpens dorfl's own positioning.

## What Smithers actually is (runtime model)

Smithers is a React reconciler whose host elements are tasks instead of DOM nodes. The whole engine is one loop: render the JSX workflow tree, extract the ready tasks, schedule the ones whose deps are met (within `maxConcurrency`), execute each (agent / compute / static mode), persist validated output to SQLite, then re-render against the new state. State is the single source of truth and the plan is a pure function of state. Every render FRAME is a SQLite row; `rewind`, `fork`, `replay`, `timeline`, and crash-resume all key off the frame number. It also snapshots the working tree alongside the DB, so `rewind`/`fork` restore the edited repo, not just workflow state. Infra floor is one process plus one SQLite file (`bunx smithers-orchestrator up`): no cluster, no worker fleet. Human gates are first-class: `needsApproval` (pause-before-execute gate), `<Approval>` (a typed, durable `ApprovalDecision` row downstream rendering branches on, with `fail`/`continue`/`skip` denial policies), `<HumanTask>`, `<EscalationChain>`. An approval suspends the run as a free DB row and can be answered tomorrow over CLI/web/HTTP. It is model- and harness-agnostic AT THE RUNTIME: one workflow can point different tasks at Claude Code, Codex, Gemini, or Pi, with fallback arrays (`agent={[claude, codex]}`) for a bad-provider day.

Its own "vs Temporal" page states the recovery philosophy crisply: "Temporal replays; Smithers re-renders." Smithers carries no determinism contract on your code, because the unit of recovery is the STEP, not the instruction, so an agent task may shell out, edit files, and call flaky tools freely.

## Smithers vs dorfl, head to head

The two systems are the same bet executed on two different ledgers.

- **Unit of durable work.** dorfl: a task file in `work/` moving claim -> build -> acceptance-green -> done-move -> PR/merge. Smithers: a `<Task>` frame persisted to SQLite.
- **Source of truth / ledger.** dorfl: the filesystem `work/` tree plus git branches (`work/<slug>`). Smithers: SQLite rows plus filesystem snapshots of the repo.
- **Who owns git transitions.** dorfl: the RUNNER (or a human); the spawned build agent never stages/commits/moves files. Smithers: the runtime snapshots the worktree itself, and `rewind`/`fork` restore it.
- **Acceptance gate.** dorfl: `pnpm -r build && pnpm -r test && pnpm format:check` (`dorfl verify`). Smithers: per-task Zod schema validation, plus whatever `<Loop until={...}>` you write to keep swinging until tests are green.
- **Human approval.** dorfl: the interactive-confirmation rules in AGENTS.md plus runner gates, expressed in prose. Smithers: first-class durable `<Approval>` nodes.
- **Crash recovery.** dorfl: re-derived from `work/` bucket state plus git, implicitly, at the protocol level. Smithers: explicit resume from the last persisted frame, plus a `supervise` command that revives stale runs on a heartbeat.
- **Multi-vendor.** dorfl: harness-agnostic BY PROMPT CONVENTION (the git rule is stated in-band in the prompt precisely so the protocol does not depend on any harness or on AGENTS.md existing). Smithers: harness-agnostic BY RUNTIME (`agent={[...]}` fallback arrays in one workflow file).
- **Workflow definition.** dorfl: prose protocol docs (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`) plus `dorfl.json`. Smithers: a single versioned JSX/MDX file.
- **Substrate.** dorfl: a pnpm/TypeScript monorepo with git as the ledger. Smithers: Bun plus SQLite as the ledger.

## Why this matters for dorfl (and why it is NOT a threat to the core bet)

The crucial divergence is exactly dorfl's founding constraint. Dorfl's whole point is that the protocol MUST NOT depend on the harness, so the authoritative rules (especially "the runner owns every git-state transition") are stated in-band in the prompt the runner hands the build agent, not in a runtime and not in `AGENTS.md`. Smithers is the opposite trade: it IS the infrastructure, and durability/time-travel are runtime guarantees you buy by adopting the engine. Adopting Smithers as dorfl's runtime would therefore violate dorfl's founding constraint. They are not competitors for the same job; they are two answers to "durable orchestration is the stable layer," one protocol-shaped and substrate-light, one runtime-shaped and substrate-heavy.

That contrast is the value. Three things are worth studying (not adopting):

1. **Name the "re-render, don't replay" model in dorfl's runner design.** Dorfl's runner already implicitly does what Smithers calls re-rendering: it reads `work/` state and re-derives "where are we." Smithers names this and shows the payoff (no determinism contract, step-level recovery). Framing dorfl's runner explicitly as "the plan is a pure function of `work/` state" would be a clean, borrowed articulation.
2. **Worktree snapshots as an attempt-fork primitive.** Smithers bolts filesystem snapshots onto its SQLite state so `fork` yields an alternate attempt. Dorfl gets essentially the same thing MORE naturally from `work/<slug>` git branches. This is good outside validation that dorfl's git-as-ledger choice is sound, not a gap to close.
3. **`<Approval>` as a typed, durable, resumable decision row** is a cleaner primitive than dorfl's current prose-based human gates. If dorfl ever needs "approval waits overnight," this is the shape to copy: a typed decision persisted as data that later rendering branches on, with explicit deny policies.

## Disposition

Prior-art / positioning note only. No change proposed to the protocol or the runner from this alone. If dorfl ever writes external positioning ("why not just use X"), Smithers belongs in that comparison as the closest fellow-traveller, with the protocol-vs-runtime / git-ledger-vs-SQLite-ledger distinction as the honest differentiator. Revisit item 3 (typed durable approvals) if/when a durable-overnight-approval requirement lands.

(Captured 2026-07-23 after the maintainer asked what smithers.sh is and how it relates to their work; sourced from the live site and its vs-Temporal / vs-LangGraph / vs-Claude-Code-Workflows comparison pages.)
