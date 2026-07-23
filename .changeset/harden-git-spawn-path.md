---
'dorfl': patch
---

Harden git spawning against a caller PATH that omits the system dirs, and self-heal orphan claim residue.

`dorfl` spawned bare `git` resolved against whatever PATH launched it, so a curated launcher PATH (a version-manager / MCP-agent env listing only `~/.volta/bin`, `~/.cargo/bin`, ... and omitting `/usr/bin`) produced an opaque mid-run `spawn git ENOENT`. Git is now resolved to an absolute path per effective PATH (honouring a `DORFL_GIT`/`GIT` override, else the caller's own PATH first, then the standard system dirs `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` appended), and the spawn env's PATH is unioned with those dirs so git's own child processes (`ssh`, hooks) resolve too. A genuine miss now fails fast with an actionable message naming the effective PATH instead of a bare ENOENT.

Also self-heals the orphan claim residue such a crash leaves: a record-less `~/.dorfl/work/<id>` directory or dangling symlink (crashed after the path appeared but before `git worktree add` registered it) is now cleared by the re-create path and swept by `gc`, instead of wedging the next `worktree add` until a manual `rm`.
