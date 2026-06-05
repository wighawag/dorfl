# `.agent-runner-pi-session/` runtime logs are not gitignored

2026-06-05 — Running `do --harness pi` in a checkout writes pi session `.jsonl`
logs to `<cwd>/.agent-runner-pi-session/` (`PI_SESSION_DIRNAME` in
`src/pi-harness.ts`). In THIS repo those land as untracked files at the repo root
(seen in `git status` during the do-watch-session-log-format slice) and are NOT in
`.gitignore`, so they can be accidentally committed. Consider gitignoring
`.agent-runner-pi-session/` (or writing the session dir under the workspace state
area). Out of scope for the watcher fix; left untouched.
