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

## Update (2026-06-05) — ALSO breaks `--watch` (a SECOND bug, same root) + verified fix mechanism

### `--watch` latches onto a STALE session file (the shared-dir race)

Spotted live: `do --watch` dumped an OLD completed session instantly, then went
silent (never showed the current run). Root cause: `findSessionLog`
(`src/watch-session.ts`) picks the **newest `.jsonl` by mtime** in the shared
`<repo>/.agent-runner-pi-session/` dir, ONCE at launch — but pi creates the new
run's file ASYNCHRONOUSLY a moment after spawn. So at selection time the dir holds
only PRIOR runs' logs (all runs in this checkout share the one `--session-dir`), and
the watcher latches onto a stale sibling and tails it forever. So this `--session-dir`
decision causes TWO bugs, one root: (1) dashboard blindness, (2) the `--watch`
stale-file race. The fix below kills both.

### Verified fix mechanism: `--session <full-path>` (tested against pi + its source)

pi supports **`--session <path|id>`** (not just `--session-dir <dir>`). Verified by
live test: `pi --print --session /abs/new-path.jsonl` with a NON-EXISTENT path
CREATES + writes the session there (does NOT fall back to default). `--session` is
a literal path and takes PRECEDENCE over `--session-dir`. So agent-runner should
generate a **deterministic full session-file path** and pass `--session <that>`:

- **Watcher tails that EXACT known path** (generated before pi starts) — no
  `findSessionLog` "newest" guessing, race ELIMINATED.
- **`gc`/`status` liveness records the same generated path** — trivial.
- **No checkout pollution** (path is under the chosen root, not the repo tree).

### What is / isn't load-bearing about the path (from pi source, `session-manager.ts`)

- **Filename is FREE** — pi uses `uuidv7()` but NOTHING parses the filename;
  agent-runner may use the work-id / any deterministic name.
- **cwd is read from the FILE HEADER** (`{"type":"session", "cwd":...}`), NOT the
  filename or folder. So grouping-by-repo is driven by `header.cwd`, which is always
  correct regardless of where the file sits.
- **Folder only needs to be a subdir under `~/.pi/agent/sessions/`** for the
  dashboard's default `SessionManager.listAll()` to scan it (it reads ALL subdirs of
  the sessions root, groups by `header.cwd`). The exact cwd-slug folder is NOT
  required. The slug encoding, if you want the exact folder, is
  `--${cwd.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--` — or import
  `getDefaultSessionDir(cwd)` from the pi package (exported) to avoid drift.
- **Display ORDER is purely time-based** (`listAll` sorts by `modified` =
  `header.timestamp`); the FOLDER does NOT affect ordering. So a DISTINCT subfolder
  (e.g. `~/.pi/agent/sessions/agent-runner-fleet/`) gives FREE "runner-driven vs
  manual" distinguishability with correct cwd-grouping AND undisturbed chronological
  order — the differentiation idea, for free.
- **`listAll(customDir)`** accepts an explicit dir — so the pi-remote "watch multiple
  folders" idea is natively supported by the pi API.

### Decided route

Generate `--session <full-path-under-~/.pi/agent/sessions/<folder>/<deterministic-id>.jsonl>`;
DEFAULT folder = the cwd-slug (groups exactly like manual pi work) via the exported
`getDefaultSessionDir`; for the `run` FLEET, optionally a distinct subfolder (free
differentiation) or a configurable root. Tail the known path; record it for
liveness. (Sub-routes — exact fleet-folder naming, whether to import vs replicate
the slug — settle at slice time.)
