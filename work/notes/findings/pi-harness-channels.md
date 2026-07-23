---
title: 'pi harness channels — best channel per need (output / liveness / watch)'
type: finding
verified: 2026-07-07
source: pi 0.73.1 CLI + docs (`docs/json.md`, `docs/rpc.md`, `docs/session-format.md`, `docs/sdk.md` on the installed `@mariozechner/pi-coding-agent@0.73.1`), current dorfl code (`packages/dorfl/src/{pi-harness,watch-session,agent-launch,harness}.ts`)
related-task: pi-harness-polish
---

# pi harness channels — best channel per need

The `pi` adapter currently rests on **one** pi surface — the session
`.jsonl` file pi writes at the `--session <path>` we pass — to satisfy
**three** distinct needs:

1. `LaunchResult.output` — the agent's final answer (post-mortem read).
2. Liveness / audit pointer — `PiHarness.sessionPointer(record)` +
   `piSessionExists(record)`.
3. `--watch` — live surfacing of the agent's conversation
   (`SessionTailer` in `watch-session.ts`).

That betting-three-on-one worried the maintainer that flagged this task:
the session-persistence format is pi-internal, and a single change in it
could silently break watch + output + audit at once. The task asked:
STUDY the alternative channels pi exposes, and RECOMMEND per need.

This finding records that study and the resulting recommendation.
The code changes made under `pi-harness-polish` are consistent with it.

## Channels pi actually exposes (v0.73.1)

pi exposes four surfaces we could bet on. Sources for each are pinned
in this file's header.

### A. `--session <path>` session file (JSONL, session-persistence)

- Format documented in `docs/session-format.md`. Explicitly **versioned**
  (`version: 3` in the header) and pi **auto-migrates on load** across
  v1/v2/v3, so the on-disk shape is the format with the most explicit
  stability contract of the four.
- The dashboard reads these files (they ARE the audit trail from pi's
  own perspective) — this is why we already pass `--session <path>` for
  the human-interactive launch too.
- Post-mortem readable: it survives the process exiting, is complete at
  process-close, and contains the LAST assistant message intact.
- What we use it for today: (1) output extraction after launch,
  (2) `sessionPointer`/`piSessionExists` audit pointer, (3) live tail
  under `--watch`.

### B. `--mode json` STDOUT stream (event stream)

- Format documented in `docs/json.md`. This is the `AgentSessionEvent`
  vocabulary (`agent_start` / `turn_start` / `message_start` /
  `message_update` / `message_end` / `turn_end` / `agent_end` / …).
- **NOT the same format as the session file** — it is a live EVENT
  stream shaped for consumers building UIs. The `AgentSessionEvent`
  union is pi-internal (`packages/coding-agent/src/core/agent-session.ts`),
  is not documented as versioned, and has visibly evolved (this task's
  own context notes a prior vocabulary mismatch made `do --watch` a
  silent no-op).
- Delivered on STDOUT: no post-mortem read — a consumer must be reading
  the stream as pi runs. If we do not consume it, it is discarded.
- Would need us to give up "captured stdout" (`spawnSync`'s buffered
  return) OR route stdout through a parser in `launchAsync` too.

### C. `--mode rpc` STDIN/STDOUT JSON protocol

- Documented in `docs/rpc.md`. Bidirectional: the caller sends `prompt` /
  `steer` / `follow_up` / … commands on stdin and receives `response`
  frames + agent events on stdout. Strict JSONL framing (LF only).
- Designed for a long-lived embedding host (an IDE, a custom UI) that
  drives pi interactively — NOT for a one-shot batch job. The one-shot
  path in RPC still emits the same event vocabulary as `--mode json` for
  its output signal, so RPC does not solve anything `--mode json` does
  not, and it costs more (a whole client-side session driver).

### D. In-process SDK (`AgentSession`)

- `docs/sdk.md`. Imports pi's `AgentSession` directly and runs it in the
  same Node process. Gives us typed events without spawning a
  subprocess. Costs a hard runtime dep on `@mariozechner/pi-coding-agent`
  and loses process isolation between dorfl and the agent (dorfl
  process death would kill the agent and vice versa; pi model state
  would sit in dorfl's memory). Also collapses the harness seam — the
  whole point of the seam is that the AGENT is a subprocess dorfl
  supervises via PID / file, not a library it embeds.

## Comparison per need

### Need 1 — Agent output (`LaunchResult.output`, task `harness-agent-output`)

What we need: the agent's LAST assistant text, read AFTER pi exits, as
a single `string | undefined`.

| channel                  | fit                                     | cost                                       |
| ------------------------ | --------------------------------------- | ------------------------------------------ |
| A. session `.jsonl`      | perfect (post-mortem, versioned, present) | 0 (already implemented, shared reader)   |
| B. `--mode json` stdout  | usable but streaming: must consume live | force `launchAsync` on the sync path, parse stdout, format not versioned |
| C. `--mode rpc`          | overkill (bidirectional protocol)       | client-side session driver                 |
| D. SDK                   | works                                   | hard dep + no process isolation            |

Session `.jsonl` is the only channel that is **both** post-mortem AND
explicitly versioned. `--mode json`'s event union is arguably the
LESS stable of the two shapes on disk today (the maintainer worry that
prompted this task actually applies more to it than to A).

**Recommendation: KEEP `.jsonl` for `LaunchResult.output`.**

### Need 2 — Liveness / audit pointer

What we need: (a) a PID for "is the process alive?" and (b) a pointer
to the pi-native activity/audit trail that outlives the process.

Only channel A produces something that persists after the process. B/C
are stdio streams; D runs in-process. The dashboard already reads the
session files as the pi-native audit surface; there is no other one to
point at.

**Recommendation: KEEP the recorded `--session <path>` as
`sessionPointer` + KEEP PID as the liveness anchor.** (Explicitly NOT
mtime — ADR §5.)

### Need 3 — `--watch` live view

What we need: surface assistant text and tool starts as they happen,
during pi's run.

Here the tradeoff is closest. Channel B is designed for exactly this
job (it is what `ar-run.sh --watch` piped through jq), and its
`message_update` deltas would give lower latency than tailing a file
pi writes in chunks. But:

- Switching costs: `launchAsync` currently drains stdout so pi never
  stalls; we would keep that AND additionally parse each stdout line
  through a new classifier — a **second** parser, in a **less-versioned**
  format (channel B), for the SAME conceptual events channel A already
  gives us.
- The tail vocabulary was already fixed once (task `do-watch-session-log-format`);
  the classifier now MIRRORS pi-remote's own `session-pool.ts` reference
  parser over the session-log shape, which pins us to the same block
  walk pi's own team maintains. Switching to `--mode json` would
  invalidate that alignment for no user-visible win.
- The most valuable "future-proofing" move is not to move channels but
  to keep the **classifier** and the **output extractor** pure
  (string → lines / string → last-text) so a future opencode-style
  adapter — which exposes output as a stdout STREAM / `export` HTTP
  path with no persisted file — can feed the SAME classifier. Both
  helpers in `watch-session.ts` are already pure this way.

**Recommendation: KEEP session-file tail for `--watch`.** Revisit only if
pi's session format changes AND `--mode json` remains stable through
that change (the reverse is more likely, given `docs/session-format.md`'s
explicit version+migration policy).

## Cross-harness `LaunchResult.output` seam (Option C) — still safe

`LaunchResult.output` is typed `string | undefined` on the interface
(`harness.ts`). Nothing about the type or its callers assumes a file:

- `run.ts` / `do.ts` treat it as the agent's captured final summary
  string.
- `review-gate.ts` and `agent-stop.ts` consume it as opaque content.
- `complete.ts` proposes it as a summary.

An opencode-style harness whose `launch` accumulates a `--format json`
stream and returns the last assistant `text` part as `output` fits the
same field unchanged. The file shape lives BEHIND the pi adapter
(inside `readLastAssistantText`) and is not observable through the
seam. No change required to preserve Option C.

## Summary

| need                            | recommended channel                 | change |
| ------------------------------- | ----------------------------------- | ------ |
| output (`LaunchResult.output`)  | session `.jsonl` (channel A)        | none — reaffirmed |
| liveness / audit pointer         | `--session <path>` + PID (A + PID) | none — reaffirmed |
| `--watch` live view              | session `.jsonl` tail (channel A)  | none — reaffirmed |

The queued polish pass concludes: the tactical bet on `.jsonl` was
also the right structural bet. The doc comments in `pi-harness.ts`
and `watch-session.ts` are updated under `pi-harness-polish` to record
this as a STUDIED choice (pin: pi 0.73.1, session format v3), not an
unexamined default, and to link to this finding as the durable
rationale.
