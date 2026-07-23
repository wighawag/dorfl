---
title: 'do --watch parses the wrong event format — fix it to the pi SESSION-LOG shape (not --mode json stream)'
slug: do-watch-session-log-format
blockedBy: [do-watch]
covers: []
---

## What to build

> Self-contained bug fix \u2014 derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live: `do --watch` ran but surfaced NOTHING while the agent worked normally.

`do --watch` is silently a no-op: it shows nothing even though the agent runs and the pi session log grows. **Root cause (verified against a real session `.jsonl`): the watcher (`src/watch-session.ts`) parses the WRONG event vocabulary.** It filters for `tool_start` / `message_end` / `agent_end` \u2014 those are pi's **`--mode json` STREAM** events (what `ar-run.sh --watch` piped). But `do --watch` tails the **`--session-dir` SESSION-PERSISTENCE log**, which is a DIFFERENT format. Every line in the real log is `type:"message"` (or `text`/`session`/`model_change`) \u2014 NONE of which match the watcher's cases \u2192 every line falls through to skip \u2192 silent.

The `do-watch` slice conflated the two formats (it told the implementer to match `ar-run.sh`'s `jq` filter event names, but those don't occur in the session log), and the tests passed because they used a SYNTHETIC `--mode json`-shaped fixture rather than a real session-log fixture.

### The REAL session-log format (parse THIS)

Verified shapes from a real `.dorfl-pi-session/*.jsonl`:

- A record is `{"type":"message", "message":{"role":"user"|"assistant", "content":[...]}}`.
- **Assistant text:** on `message.role == "assistant"`, the `content[]` parts with `{"type":"text","text":"..."}` \u2014 concatenate/emit the text.
- **Tool calls:** `content[]` parts with `{"type":"toolCall","name":"<tool>", ...}` \u2192 emit `\u25b6 <name>` (cyan). (Tool RESULTS appear as separate `message` records; surfacing them is optional \u2014 match the `ar-run.sh` signal level: tool starts + assistant text.)
- **No `agent_end` in the log.** "Finished" is the PROCESS exiting \u2014 the watcher already stops tailing when the child exits, so emit the `\u2713 agent finished` line on process exit (not on a log event).
- Skip everything else (`session`, `model_change`, `thinking_level_change`, `user` messages, tool results unless you choose to surface them).

### Scope

- Rewrite `watch-session.ts`'s per-record classifier to the session-log shape above (walk `type:"message"` \u2192 `message.role`/`message.content[]`), keeping the same OUTPUT parity intent (\u25b6 tool starts, assistant text, \u2713 finished) and the TS-only, no-`jq` parsing.
- Keep the rest of `do --watch` unchanged (the concurrent tail, the `launchAsync`/`spawn` plumbing, the fail-on-null-harness guard \u2014 all correct; ONLY the event classifier was wrong).
- **Tests must use a REAL session-log-shaped fixture** (the `type:"message"` + nested `content[]` shape), NOT a synthetic `--mode json` stream \u2014 that synthetic fixture is exactly why the bug shipped green. Capture a small real example as the fixture.

## Acceptance criteria

- [ ] `do --watch` surfaces live events from the pi SESSION log: assistant text (from `type:"message"`, `role:"assistant"`, `content[].text`) and tool starts (`content[].type == "toolCall"` \u2192 `\u25b6 <name>`); `\u2713 agent finished` on process exit. It is no longer silent on a real run.
- [ ] Parsing is TS-only (no `jq`); colour only on a TTY / `NO_COLOR` honoured (unchanged).
- [ ] The watcher is still a pure OBSERVER (no change to outcome/gate/git/exit; the `launchAsync` plumbing + null-harness guard are untouched).
- [ ] Tests parse a REAL session-log-shaped `.jsonl` fixture (`type:"message"` with nested `content[]`) \u2014 NOT a `--mode json` stream fixture \u2014 and assert tool starts + assistant text are surfaced and other record types skipped.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-watch` \u2014 this fixes the watcher `do-watch` shipped (in `done/`); same module (`src/watch-session.ts`).

## Prompt

> Fix `do --watch` being silently a no-op (read `work/observations/`... none \u2014 the diagnosis is in this slice). ROOT CAUSE (verified against a real session `.jsonl`): `src/watch-session.ts` filters for `tool_start`/`message_end`/`agent_end` \u2014 pi's `--mode json` STREAM events (what `ar-run.sh --watch` piped) \u2014 but `do --watch` tails the `--session-dir` SESSION-PERSISTENCE log, whose records are `type:"message"` with nested `message.role` + `message.content[]`. None of the watcher's cases match \u2192 every line is skipped \u2192 silent.
>
> Rewrite the classifier to the SESSION-LOG shape: walk `type:"message"` records; on `role:"assistant"` emit `content[]` `type:"text"` text and `\u25b6 <name>` for `content[]` `type:"toolCall"` parts; emit `\u2713 agent finished` on PROCESS EXIT (the log has no `agent_end`); skip the rest. Keep TS-only parsing (no `jq`), the TTY/`NO_COLOR` colour rule, and the rest of `do --watch` (concurrent tail, `launchAsync`, fail-on-null-harness) UNCHANGED \u2014 only the event classifier was wrong.
>
> READ FIRST — the AUTHORITATIVE sources: (1) `@earendil-works/pi-coding-agent` EXPORTS `SessionEntry` / `SessionMessageEntry` — type the parser against those (dorfl already imports from this package), do NOT hand-roll the schema. (2) `~/dev/github/wighawag/pi-remote`'s `server/src/session-pool.ts` ~L529–L577 is a COMPLETE reference parser of this exact `.jsonl` (`type:'message'` → `role` → `content[]` block walk over `thinking`/`text`/`toolCall`, incl. edge cases `tc.name||tc.toolName`, `tc.arguments||tc.args`, content-as-string) — mirror it. Then (3) `src/watch-session.ts` (the wrong classifier + `extractAssistantText`, which already reads `content[].text` \u2014 it is keyed on the wrong `type`), the `do-watch` done file, and a REAL session log under a `.dorfl-pi-session/*.jsonl` (capture a small one as the test fixture; if none is handy, generate via a `do --harness pi` run). CRITICAL: the existing tests passed because they used a SYNTHETIC `--mode json` fixture \u2014 replace it with a real session-log-shaped fixture so this bug cannot recur green.
>
> TDD with vitest, house style: a real-shaped session `.jsonl` \u2192 tool starts + assistant text surfaced, other record types skipped; finished-on-exit. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim do-watch-session-log-format --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-watch-session-log-format <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-watch-session-log-format.md work/done/do-watch-session-log-format.md
```
