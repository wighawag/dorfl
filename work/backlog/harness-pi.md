---
title: harness adapter — pi (liveness + invocation)
slug: harness-pi
prd: agent-runner
humanOnly: true
blocked_by: [agent-workspaces]
covers: [6, 11]
created: 2026-06-03
claimed_by:
claimed_at:
---

## What to build

The concrete **pi** adapter for the harness seam introduced by `agent-workspaces`
(ADR §5, `docs/adr/execution-substrate-decisions.md`). pi is the first real
agent harness agent-runner drives.

End-to-end:

- **Invocation**: launch a pi agent against a job's prompt (the constant wrapper
  + the slice's `## Prompt`, per the PRD's agentCmd-prompt decision and
  CLAIM-PROTOCOL's "prompt handed to the work agent"), in the job's worktree.
- **Liveness**: report whether the job's agent is alive and what it's doing,
  using pi-native signals — PID (process alive?) plus a pointer to the pi
  **session dir/log** (real activity + an audit trail). NOT filesystem mtime.
- **Wire into the harness seam** so `run-once` / `agent-workspaces` `status` show
  pi job liveness, and so `watch`'s timeout/failure rails can act on a hung pi
  agent.

Keep pi specifics behind the adapter interface; the core stays harness-agnostic.

## Acceptance criteria

- [ ] A `pi` harness adapter implements the seam from `agent-workspaces`.
- [ ] It launches a pi agent in the job worktree with the standard work-agent
      prompt (wrapper + slice `## Prompt`).
- [ ] Liveness reports PID-alive plus a reference to the pi session dir/log; not
      mtime-based.
- [ ] `agent-runner status` shows pi job liveness via the adapter.
- [ ] A hung/dead pi agent is detectable so `watch`'s rails can act.
- [ ] Tests cover liveness reporting and invocation wiring (mock/stub the pi CLI
      where running real pi in CI is impractical; document the seam contract).

## Blocked by

- `agent-workspaces` — provides the harness seam this adapter implements.

## Prompt

> Implement the **pi** harness adapter for `agent-runner`, fulfilling the harness
> seam created by the `agent-workspaces` slice. READ FIRST: ADR §5 in
> `docs/adr/execution-substrate-decisions.md`, the harness-seam code from
> `agent-workspaces`, and the PRD's decisions on the agentCmd prompt (constant
> wrapper + slice `## Prompt`) plus CLAIM-PROTOCOL's "prompt handed to the work
> agent".
>
> The adapter must: launch a pi agent in a job's worktree with the standard
> work-agent prompt; report liveness from pi-native signals (PID alive + a pointer
> to the pi session dir/log — NOT mtime); and integrate with `status` and with
> `watch`'s timeout/failure rails. Keep all pi specifics behind the seam
> interface.
>
> TDD with vitest; stub the pi CLI where running real pi in CI is impractical, and
> document the seam contract. Match house style. "Done" = acceptance criteria met
> and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
