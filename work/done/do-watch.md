---
title: do --watch — live-stream the agent's run by tailing the pi session log
slug: do-watch
blockedBy: [do-in-place]
covers: []
---

## What to build

> Self-contained feature \u2014 derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Restores, for `do`, the live conversation view `ar-run.sh --watch` gave.

A **`do --watch`** flag that streams the agent's activity live while `do` runs, instead of `do`'s current silent-until-done behaviour. `ar-run.sh --watch` did this by piping `pi -p --mode json | jq` to surface tool calls + assistant text + lifecycle; `do` runs the agent through the harness seam (captured), so the live view was lost. This restores it.

### Mechanism (DECIDED \u2014 option (a): tail the pi session log)

The pi adapter already writes a session **`.jsonl` event log** to its `--session-dir` (the dir from `piSessionDir(input.dir)` in `src/pi-harness.ts`). `do --watch` does NOT change how the agent is launched \u2014 it adds a **concurrent observer** that TAILS that growing `.jsonl` and pretty-prints the high-signal events while the agent runs, stopping when the agent process exits.

- **Surface the same events as `ar-run.sh --watch`** (parity), via the same event shapes its `jq` filter used:
  - `tool_start` \u2192 `\u25b6 <tool>` (cyan)
  - `message_end` where `message.role == "assistant"` \u2192 the assistant text
  - `agent_end` \u2192 `\u2713 agent finished` (green)
  - everything else \u2192 skipped. Parse the JSONL in TS (do NOT shell out to `jq` \u2014 that bash dependency is part of what `do` replaces); colour only on a TTY / honour `NO_COLOR`.

- **CONCURRENCY (the one structural point):** today the pi adapter uses a SYNCHRONOUS `spawnSync` (`src/pi-harness.ts`), so nothing could read the log until the agent exits. To tail LIVE, the agent run + the log-tail must proceed concurrently \u2014 e.g. launch the agent non-blocking (`spawn`) and tail the `.jsonl` until the child exits, OR run the tailer in parallel with the existing launch. The launch SEMANTICS stay identical (same prepared PROMPT fed on stdin; output still CAPTURED — we read the `.jsonl` LOG, NOT piped stdout); the WHOLE launch delta is `spawnSync` → async `spawn`. The watcher is a pure concurrent file-reader. Keep it otherwise identical (captured result, PID + session pointer recorded for liveness, exit status unchanged) \u2014 `--watch` is an OBSERVER, it must not change the run's outcome, gate, or git. Do NOT switch the launch to inherited-stdio piping (that is the SEPARATE future `--agent` streaming seam, option (b) \u2014 see Lineage).

### Scope + degradation

- **`do` only.** Only `do` (and the future `run`) launch an agent; `start` / `complete` do not. Do NOT add `--watch` to them. Explicitly NOT `run` either \u2014 N concurrently-interleaved agent streams is a separate, harder problem; `do` is one sequential agent = a clean single stream.
- **Requires the pi harness \u2014 FAIL on the null adapter.** The null/shell adapter has no session log / event taxonomy, so `do --watch` cannot tail anything there. When `--watch` is passed with `harness: null` (no pi), **error clearly** ("`do --watch` requires the pi harness; configure `harness: pi` or drop `--watch`") \u2014 do not silently run without the view.

### Lineage (why (a) now, (b) with `--agent` later)

`--watch` (a) = OBSERVE the agent (read-only tail of a log the pi adapter already writes; the launch path is untouched). The future **`--agent`** = INTERACT with the agent, which needs the harness to actually stream/inherit stdio (`spawn` with piped/inherited `stdio`, no prepared prompt) \u2014 the real launch-seam change, option (b). They serve different needs, so `--watch` deliberately does NOT open the streaming seam here. A later `--watch` COULD migrate onto (b)'s stream once `--agent` builds it, but need not. Keep them decoupled.

## Acceptance criteria

- [ ] `do --watch <slug>` streams the agent's high-signal events live (tool starts, assistant text, agent-finished) while the run proceeds, by tailing the pi session `.jsonl` (parity with `ar-run.sh --watch`); without `--watch`, `do` behaves exactly as today.
- [ ] The JSONL is parsed in TS (no `jq` dependency); colour only on a TTY / `NO_COLOR` honoured.
- [ ] `--watch` is an OBSERVER: the run's outcome, gate, integration, git, and exit code are identical with or without it (the agent launch result is unchanged; only a concurrent log-tail is added).
- [ ] `do --watch` with the null harness ERRORS clearly (it requires pi); it is NOT added to `start`/`complete`/`run`.
- [ ] Tests (vitest, house style): feed a synthetic/stubbed session `.jsonl` (a growing file, or a fixture) and assert the tailer surfaces `tool_start` / assistant `message_end` / `agent_end` and skips the rest; assert `--watch` + null harness errors; assert a normal `do` run is byte-identical without `--watch`.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` \u2014 `--watch` is a flag on the `do` command + observes its agent run; `do` must exist first (in `done/`). Also touches the `do` wiring in `cli.ts` + the pi adapter's session-dir, both of which `do-in-place` established.

## Prompt

> Add **`do --watch`** \u2014 restore, for `do`, the live agent-conversation view `ar-run.sh --watch` gave (which `do` lost by running the agent captured through the harness seam). MECHANISM IS DECIDED (option (a)): do NOT change how the agent is launched \u2014 add a concurrent observer that TAILS the pi session `.jsonl` log (the pi adapter already writes it to `piSessionDir(dir)` / `--session-dir`) and pretty-prints the high-signal events while the agent runs.
>
> READ FIRST: `src/pi-harness.ts` (`piSessionDir`, the `--print --session-dir` launch \u2014 note it is SYNCHRONOUS `spawnSync`, the one structural thing you must work around to tail concurrently), `src/do.ts` + the `do` wiring in `src/cli.ts` (where the flag attaches), `ar-run.sh`'s `--watch` `jq` filter (the EVENT PARITY reference: `tool_start` \u2192 \u25b6 tool, assistant `message_end` \u2192 text, `agent_end` \u2192 \u2713 finished), and `src/output.ts` (the TTY/`NO_COLOR` colour rule to reuse).
>
> Implement: a `--watch` flag on `do` only; tail the session `.jsonl` concurrently with the agent run (launch non-blocking, or tail in parallel \u2014 keep the launch result / liveness / exit status identical; `--watch` is a READ-ONLY observer, it must not change outcome/gate/git). Parse JSONL in TS (no `jq`). FAIL clearly when `--watch` is passed with the null harness (no pi session log to tail). Do NOT add it to `start`/`complete`/`run`, and do NOT switch the launch to inherited-stdio piping (that is the future `--agent` seam, option (b) \u2014 keep them decoupled).
>
> TDD with vitest, house style: a stubbed/growing session `.jsonl` \u2192 the tailer surfaces tool_start / assistant message_end / agent_end and skips the rest; `--watch` + null harness errors; a normal `do` run is unchanged without `--watch`. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim do-watch --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-watch <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-watch.md work/done/do-watch.md
```
