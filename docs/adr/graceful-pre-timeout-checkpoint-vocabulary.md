---
title: The deadline/backstop vocabulary (agentDeadlineMinutes + checkpointHeadroomMinutes) replaces the retired legTimeoutMinutes
status: accepted
created: 2026-07-13
decided: 2026-07-13
supersedes:
superseded_by:
---

# ADR: Deadline/backstop vocabulary replaces `legTimeoutMinutes`

## Context

Before this change the per-leg wall-clock cap on the advance-lifecycle matrix
jobs was a single number, `legTimeoutMinutes` (config field + `install-ci
--leg-timeout-minutes` flag, default 120). It was rendered STATICALLY into the
generated `.github/workflows/advance-lifecycle.yml` at `install-ci` time. Two
problems:

1. **The GitHub `timeout-minutes` cap is a HARD SIGKILL of the whole runner** —
   there is no graceful-shutdown hook. A legitimately-long agent leg (a wide
   migration, a big refactor) that ran past the cap therefore lost EVERYTHING:
   the work never reached `work/<slug>`, the branch was never pushed, and the
   next tick's requeue re-cut a fresh branch off `main` and re-tried the same
   too-large task from scratch — a permanent trap (observation
   `timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13`).

2. **The static YAML render only refreshed on `install-ci` re-run.** Editing
   `legTimeoutMinutes` in `dorfl.json` had no effect until an operator re-ran
   the wizard — a silent drift between the committed configuration and the
   value CI actually used.

The spec `graceful-pre-timeout-wip-checkpoint` (task
`graceful-pre-timeout-wip-checkpoint`) resolves both by splitting the single
number into a **two-layer deadline model**:

- **A dorfl-INTERNAL deadline** (the PRIMARY stop): the agent session
  self-stops at this budget. Dorfl then SAVES the WIP (commit + push
  `work/<slug>`) and routes the run as a CHECKPOINT — auto-continue on real
  progress under the ceiling, else surface a `needsAnswers:true` question for
  a human.
- **A GitHub `timeout-minutes` BACKSTOP** set STRICTLY ABOVE the internal
  deadline, so the hard kill only fires if the graceful save itself wedges.

## Decision

### 1. `legTimeoutMinutes` is removed entirely (no alias)

The config field, the `install-ci --leg-timeout-minutes` flag, the
`DEFAULT_LEG_TIMEOUT_MINUTES` constant, and every test that asserted the
static `timeout-minutes: <n>` render are gone. The tool is early enough that
an alias would carry legacy debt without adopters owed a migration window.

### 2. The replacement vocabulary is a triple

The single number splits into three fields on `Config`:

| Field                        | Default | Bounds           | Role                                                                                                |
| ---------------------------- | ------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `agentDeadlineMinutes`       | 60      | `[1, 240]`       | The dorfl-INTERNAL deadline the agent session self-stops at (the primary stop).                     |
| `checkpointHeadroomMinutes`  | 30      | `[10, 60]`       | Head-room the GitHub backstop sits ABOVE the internal deadline (so the graceful save has room).     |
| `maxAutoCheckpoints`         | 5       | `>= 1` (integer) | Anti-loop ceiling on CONSECUTIVE deadline auto-continues; past this the next checkpoint surfaces.   |

All three are FAIL-LOUD on out-of-range: `validateDeadlineConfig` throws at load
time (never clamps), so a bad value cannot silently propagate.

The defaults render `60 + 30 = 90` minutes on the GitHub backstop (1h30) — well
above a legitimate hour-long build session, well under GitHub's 6h hard job
default.

### 3. The GitHub `timeout-minutes` is now DYNAMIC (single source of truth)

`dorfl.json` is the SINGLE source read at RUN TIME by BOTH consumers:

- the `advance`/`do` LEGS read `agentDeadlineMinutes` via the normal
  precedence chain → the harness's internal deadline race
  (`PiHarness.launchAsync` SIGTERMs on fire, ~10s grace, then SIGKILL);
- the advance-lifecycle workflow's `enumerate` job reads
  `dorfl config --json` in the checkout and emits a job OUTPUT
  `githubTimeout = agentDeadlineMinutes + checkpointHeadroomMinutes`; ONLY
  the agent-leg jobs (`advance-propose` / `advance-merge`) set
  `timeout-minutes: ${{ needs.enumerate.outputs.githubTimeout }}`.

So editing `dorfl.json` reflects EVERYWHERE (internal deadline AND GitHub
cap) on the NEXT tick — no `install-ci` re-run, no baked-in YAML number.
`enumerate` and `reap-merged-branches` timeouts are UNTOUCHED (they had none
before).

### 4. `dorfl config --json` is a NEW focused primitive

The workflow reads the resolved config via this command — NOT overloaded onto
`scan`. `config --json` runs `resolveRepoConfig` on the cwd (in-place, same as
`scan --here`) and prints the JSON tree to stdout, so `jq` in the `enumerate`
job can extract the two fields.

### 5. The deadline stop is NOT a failure

A hard-kill-avoided checkpoint means "healthy work in progress, ran out of
time" — NOT "something went wrong, a human must look". So the checkpoint has
its own routing distinct from `saveAgentFailure`:

- **ALWAYS save WIP first** (commit + push `work/<slug>` via the SAVE HALF of
  the needs-attention mechanism — `routeToNeedsAttention` — NOT the whole
  `applyNeedsAttentionTransition` which ALSO marks the lock stuck).
- **AUTO-CONTINUE branch** (progress AND under ceiling): release the lock,
  KEEP the branch, NO sidecar, exit 0. Uses `returnToBacklog`'s DEFAULT
  keep+continue path — the next claim continues from the branch tip. NOT
  `saveAgentFailure` (which marks the item STUCK, the OPPOSITE ledger
  outcome).
- **SURFACE branch** (no progress this session OR ceiling hit): the stuck /
  needsAnswers sidecar path. A human decides continue / split / cancel.

The anti-loop guard is LOAD-BEARING: unconditional auto-requeue would turn a
wedged agent into an infinite CI-burning loop, worse than today. The counter
lives ON THE BRANCH — it counts commits with subject prefix
`chore(deadline-checkpoint)`. Because the branch is discarded on integration,
the counter naturally RESETS when the item completes.

### 6. New DoOutcome values distinguish the two branches

`deadline-auto-continued` and `deadline-surfaced` are distinct from
`agent-failed` / `needs-attention` / `agent-stopped`, so CI logs and callers
can classify the outcome accurately. The recorded reason string names the
counter position (`(auto-continued N/max)` vs `(no progress / ceiling)`).

## Consequences

- **A legitimately-long autonomous leg now makes resumable progress across
  runs** instead of losing everything to the 6h hard kill.
- **The GitHub cap can no longer drift** from the committed configuration:
  one `dorfl.json` edit flips both the internal deadline and the GitHub
  backstop on the next tick.
- **A wedged agent cannot burn CI compute forever** — the ceiling surfaces to
  a human after N consecutive no-progress-or-progress-but-hit-cap
  checkpoints.
- The tool's config vocabulary expands by three fields; migration for an
  existing dorfl-adopter is: remove the vestigial `legTimeoutMinutes` from
  their `dorfl.json` (silently ignored as unknown key) and — if the defaults
  do not fit — set `agentDeadlineMinutes` / `checkpointHeadroomMinutes`.

## Alternatives considered

- **Keep `legTimeoutMinutes` as an alias.** Rejected: no adopters owed
  migration; a clean removal avoids the debt (per the maintainer's
  answer at the top of the source task).
- **Hook GitHub's SIGKILL.** Impossible — there is no graceful-shutdown hook.
  That is exactly why the internal deadline exists.
- **A continue-token protocol** (observation option 3). Rejected — the branch
  push IS the durable checkpoint; the next claim's DEFAULT keep+continue
  already resumes from the branch tip. There is no `requeue --continue` flag;
  continue is the default.
