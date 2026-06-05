# Pre-existing `.agent-runner-pi-session/` untracked at repo root

2026-06-05 — At the start of the `session-path-pi-default` slice the repo's
working tree already had an untracked `.agent-runner-pi-session/` directory at the
repo ROOT (a ~500KB `*.jsonl` pi session log, mtime 23:06, predating this session).
This is exactly the in-place-checkout pollution the slice fixes: the OLD pi adapter
pinned `--session-dir <cwd>/.agent-runner-pi-session`, so a prior `do`/pi run in
this checkout left this artifact behind. It is a stale runtime artifact, not source
work, so it was removed to leave a clean tree for the slice's commit (the fix means
no such dir is created going forward). Noting it here because it was present before
the slice work began.
