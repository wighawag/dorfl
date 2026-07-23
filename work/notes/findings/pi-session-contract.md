---
title: 'pi session storage contract — `--session`/`--session-dir`, header validity, listAll discovery, env overrides'
type: finding
verified: 2026-06-06
source: pi source (pinned local checkout ~/dev/github/wighawag/pi/packages/coding-agent/src) + live tests
---

# pi session storage contract (verified external ground truth)

Durable reference for how the **pi** coding-agent reads/writes/discovers session files, so any dorfl slice that integrates with pi sessions can rely on it WITHOUT re-deriving (and re-missing) pieces. This is a `finding` (verified EXTERNAL/domain ground truth about a tool dorfl integrates with), not an ADR (our decision) or an observation (unverified). Verified against the pinned pi source files named below + live tests; re-confirm against the pinned source if pi changes (a slice's drift check).

Source files (pinned): `packages/coding-agent/src/core/session-manager.ts`, `packages/coding-agent/src/main.ts` (`resolveSessionPath`), `packages/coding-agent/src/config.ts` (`getAgentDir`/`getSessionsDir`, `ENV_AGENT_DIR`/`ENV_SESSION_DIR`), `packages/coding-agent/src/cli/args.ts`.

## 1. `--session <arg>` resolution (the arg MUST be path-shaped)

`main.ts resolveSessionPath` takes the **file-path** branch ONLY when `arg` contains a `/` or `\` OR ends in `.jsonl`; OTHERWISE it treats `arg` as a **session-ID to look up** (local project → global `listAll`), and on no match **pi exits 1**. So a caller generating a session path MUST emit an **absolute path ending in `.jsonl`** — a bare id (no slash, no extension) kills the run.

- `--session <path>` to a **non-existent** file → `SessionManager.open` loads no header and `setSessionFile`'s else-branch calls `newSession()` then pins the explicit path → pi **creates + writes** a fresh session there. (verified live)
- `--session <path>` to an **existing non-empty** file → it LOADS the entries and **appends/resumes** that session. ⇒ a session path MUST be **unique per launch** (timestamp/uuid suffix); reusing one resumes the prior run (corrupt audit + `--watch` replays the old run).
- `--session` takes **precedence over `--session-dir`** (pass one OR the other; passing both is redundant — `open` derives its dir from the file's parent).

## 2. Session header validity (a MALFORMED header crashes consumers)

A session file's first line is the header record:

```json
{
	"type": "session",
	"version": 3,
	"id": "<id>",
	"timestamp": "<ISO-8601>",
	"cwd": "<abs cwd>"
}
```

- `version` and `timestamp` are **mandatory in practice**: `buildSessionInfo` computes `created: new Date(header.timestamp)`. A header **missing `timestamp`** yields `new Date(undefined)` = `Invalid Date`, and any consumer calling `.toISOString()` on it throws **`RangeError: Invalid time value`** — this **hard-crashed the pi-remote dashboard's `listSessions()`** (live incident, 2026-06-05). ⇒ **every test fixture / synthetic session file MUST carry a valid `version` + ISO `timestamp`.**
- **`cwd` drives repo-grouping** in the dashboard, and for a NEW file it falls back to the spawn `process.cwd()` (no header to read it from). So group-by-repo is correct ONLY because the launcher spawns pi with `cwd =` the repo/worktree. The folder the file sits in does NOT imply the repo.

## 3. `listAll()` discovery (NON-recursive, one level)

`SessionManager.listAll()` (no arg) scans pi's sessions root (`getSessionsDir()` = `<agentDir>/sessions`): it reads the **immediate subdirectories**, then `.jsonl` files **directly inside each** — **NOT recursive**. It groups by `header.cwd` and sorts purely by `modified` (last activity time, header-derived), folder-independent. Consequences:

- A session is dashboard-visible (default `listAll()`) ONLY as a `.jsonl` **directly inside a FIRST-LEVEL subdir** of the sessions root. A NESTED sub-subfolder is invisible.
- `listAll(customDir)` accepts an explicit dir (one-level scan of THAT dir) — so a dashboard can be pointed at an arbitrary fleet folder.
- `getDefaultSessionDir(cwd)` returns `<sessionsRoot>/--<cwd-slug>--` (a direct child) and **mkdirs it as a side effect**; the PURE form is `getDefaultSessionDirPath` (NOT exported). The slug encoding is `--${resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`.

## 4. Env overrides (pi reads these; a replica MUST honour them)

pi's `config.ts`:

- **`PI_CODING_AGENT_DIR`** (`${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`) — overrides the **agent dir** (`getAgentDir`, with `~` tilde expansion); when set, ALL of pi's default session paths move under `<that>/sessions/`. Anything that REPLICATES pi's default-dir resolution (rather than importing) MUST honour this var too, or it writes sessions where pi/pi-remote don't look (sessions go invisible). dorfl's `session-path.ts piAgentDir()` honours it as of the session-path-pi-default slice's follow-up.
- **`PI_CODING_AGENT_SESSION_DIR`** (`..._CODING_AGENT_SESSION_DIR`) — overrides the **sessions dir specifically** (lower-level than the agent dir; itself overridden by `--session-dir`). dorfl does NOT honour this one — its own `sessionsDir` config key plays that role.

## 5. Practical rules for dorfl slices touching pi sessions

- Generate `--session <absolute .jsonl>`, **unique per launch**; never `--session <bare-id>`. Spawn pi with `cwd =` the repo/worktree (grouping).
- Default the sessions root to pi's per-cwd default (a first-level child of the sessions root) so `do`/manual work co-locate and the dashboard sees them; allow an arbitrary override folder (its dashboard visibility is pi-remote's concern).
- **Any test that launches pi (even a stub) MUST isolate pi's agent dir** (set `PI_CODING_AGENT_DIR` to a scratch dir) so it never writes the developer's real `~/.pi/agent/sessions/`, and any synthetic session fixture MUST have a valid `version` + ISO `timestamp` header (§2). See the test helper `isolatePiAgentDir`.
