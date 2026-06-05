---
title: agent-runner pins pi --session-dir into the cwd, hiding sessions from SessionManager/the dashboard; make it configurable, default pi-default
type: observation
status: spotted
spotted: 2026-06-05
---

# `do`/`run` sessions are invisible to the pi-remote dashboard (and pollute the in-place checkout)

## What was spotted (live, using the pi-remote dashboard alongside `do`)

The maintainer's `pi-remote` web dashboard (which live-watches running pi agents)
stopped showing sessions once work was driven via `agent-runner do`. The session IS
being written \u2014 just to a place the dashboard doesn't watch.

## Root cause (verified in code)

agent-runner's pi adapter (`src/pi-harness.ts`) ALWAYS passes an explicit
`--session-dir` pinned INTO the working directory:

```ts
export const PI_SESSION_DIRNAME = '.agent-runner-pi-session';
export function piSessionDir(dir: string): string { return join(dir, PI_SESSION_DIRNAME); }
```

- **In-place `do`:** sessions land in `<your-checkout>/.agent-runner-pi-session/`.
- **Job worktrees (`run`/`do --remote`):** in
  `~/.agent-runner/work/<work-id>/.agent-runner-pi-session/` (inside the disposable
  worktree).

But the dashboard lists sessions via the pi package's `SessionManager.listAll()`
(see `~/dev/github/wighawag/pi-remote` `server/src/session-pool.ts`), which
enumerates pi's DEFAULT managed location (`~/.pi/agent/sessions/<cwd-slug>/`, via
`getAgentDir`). An explicit `--session-dir` OUTSIDE that managed root is NOT in
`listAll()` \u2192 invisible to the dashboard. Two consequences:

1. **Dashboard blindness:** you can no longer live-watch agent-runner-driven agents.
2. **In-place checkout pollution (latent bug):** `.agent-runner-pi-session/` is
   written into the REAL checkout and is NOT gitignored \u2014 it shows up as untracked
   in `git status` (observed), and risks tripping the dirty-tree guard /
   `complete`'s git-add on a later in-place run.

## The original rationale (and why it doesn't hold)

The `--session-dir`-into-cwd choice served the job worktree: the session is the
job's liveness/audit pointer that "travels with the job and dies with it" (`gc`/
`status` re-derive liveness from `PiHarnessRecord.session`). But:

- **Liveness works regardless of WHERE the session lives** \u2014 as long as the harness
  RECORDS the actual path pi used. pi-default is just as recordable.
- **"Dies with the job" is a downside disguised as a feature:** reaping the worktree
  destroys the agent's audit trail exactly when you might want it (post-mortem of a
  failed job). pi-default PERSISTS \u2014 better for debugging.

So the per-job in-cwd session was a non-feature; pi-default is better on visibility,
audit, and (for in-place) checkout cleanliness.

## Decided design (maintainer)

- **Make the session location CONFIGURABLE** \u2014 a new key (e.g. `sessionsDir`)
  resolved per-repo like the rest (flag > env > per-repo > global > default).
- **DEFAULT to pi's default** (`SessionManager`-managed `~/.pi/agent/sessions/`) for
  ALL agent-runner pi launches \u2014 so `do` "just works" with the existing dashboard,
  no checkout pollution, and the audit trail persists. Do NOT force a location on
  the user; do NOT gitignore anything (nothing lands in their tree by default).
- **Override is especially for `run` (the AFK daemon):** an operator can point the
  fleet's sessions at a dedicated folder (e.g. its own dir) so a dashboard can watch
  the AUTONOMOUS fleet as a group, separate from manual pi work.
- **Load-bearing implementation point:** do NOT just drop `--session-dir` \u2014 the
  harness must RECORD the actual session path pi used (pi reports it, or
  `SessionManager` resolves it) so `gc`/`status` liveness still works.
- **Verify when slicing:** does `gc`/`reapJob` currently delete the in-worktree
  `.agent-runner-pi-session` as part of `git worktree remove`? Moving to pi-default
  means those sessions now PERSIST after reap (desired for audit), but agent-runner
  no longer cleans them \u2014 pi's own session retention does. Note it consciously.

## Separate, dashboard-side idea (belongs in pi-remote, NOT agent-runner)

`pi-remote` could **watch MULTIPLE folders** (config) \u2014 e.g. pi-default (manual +
`do`) AND a configured AFK-agent folder (`run`'s fleet) \u2014 and DIFFERENTIATE/group
agent-runner-driven sessions (the runner knows the work-id/slug; pi's session `name`
field could tag them). Turns this fix into a feature: "watch all my autonomous
agents, right now, grouped, from one dashboard." This is pi-remote backlog, not
agent-runner's.

## Why an observation, not a work item yet

Decided in conversation; a clean future slice (config key + default-to-pi-default +
record-the-actual-path + the opt-in override). Best built ALONGSIDE or AFTER `run`
(`run-daemon-reframe`), since the configurable-fleet-folder case is `run`'s. Captured
so it is not lost. Delete once the configurable session location lands.
