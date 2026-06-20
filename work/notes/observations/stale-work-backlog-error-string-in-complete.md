# Stale `work/backlog/` path in a complete.ts error message

2026-06-20 — Noticed while renaming the `work-layout` symbolic keys.

`packages/agent-runner/src/complete.ts` (~line 754) throws a `source-strand`
refusal whose message reads
`work/backlog/${slug}.md (nor work/in-progress/${slug}.md nor work/needs-attention/${slug}.md) found`.
The on-disk pool folder is `work/tasks/todo/` (the `tasks-todo` key), not
`work/backlog/`, so this user-facing error names a path that no longer exists.
This is a PROSE/VALUE drift that predates the key-rename task (it was already
present at HEAD `16b4893`), so it was left untouched here (out of scope: the
key-rename task only flips symbolic KEYS, not error-message path prose). Worth a
small follow-up to refresh the message to `work/tasks/todo/...`.
