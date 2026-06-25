---
date: 2026-06-25
slug: requeue-dash-m-fails-and-strands-lock-for-staged-backlog-item
needsAnswers: false
triaged: keep
---

`dorfl requeue <slug> --reset -m "<note>"` on a STAGED item (body in
`work/tasks/backlog/`, not the pool `work/tasks/ready/`) deletes the remote work
branch and then FAILS on the handoff-note append, leaving the per-item lock NOT
released. Re-running WITHOUT `-m` releases the lock cleanly. So `-m` is broken for
backlog-resident items, and its failure mode strands the lock rather than being a
no-op.

## What was seen (ground truth)

During the backlog-drive of `promoted-task-emits-prompt-and-pre-claim-wellformedness-guard`
(a `tasks/backlog/` item driven with `do ... --isolated --allow-backlog`), a Gate-2
crash left the lock dangling `state: active`. Recovering with:

```
dorfl requeue promoted-task-emits-prompt-and-pre-claim-wellformedness-guard \
  --arbiter origin --reset -m "<handoff note>"
```

produced:

```
>> Deleted the remote branch work/task-...-guard on origin (--reset).
>> requeue for '...': could not append the handoff note (the body is not in
   work/backlog/ on origin/main, or main kept moving). The lock was NOT released.
   Try again shortly.
error: ... The lock was NOT released.
```

The branch WAS deleted (first side effect landed), but the note-append step failed
and the lock stayed held. State after: lock still `active`, body still in
`work/tasks/backlog/`. Re-running the SAME command WITHOUT `-m` succeeded:

```
>> Deleted the remote branch ... (--reset).
>> Returned '...' to backlog (released the lock; body rests in pool).
```

## Impact

- The `-m` handoff note (the documented way to hand the next agent a precise
  "what to fix" on a continue) is UNAVAILABLE for a staged item, even though
  `--allow-backlog` backlog-drive is a supported mode (`drive-tasks` opt-in).
- Worse than unavailable: the failure is NOT atomic/transactional. It deletes the
  branch FIRST, then fails the note step, and on that failure does NOT release the
  lock — so a single `-m` requeue leaves a half-applied state (branch gone, lock
  stranded) the operator must notice and re-run to clear. A caller who does not
  re-check could leave the lock dangling indefinitely.

## Likely mechanism (hypothesis)

The note-append path resolves the body via the pool/ready semantics ("the body is
not in work/backlog/ on origin/main" — note the message even says `work/backlog/`,
the OLD pool name, suggesting a stale path assumption) and aborts before the lock
release when it cannot find/rewrite the body there. The lock release should either
(a) run BEFORE the optional note append, or (b) the note append should degrade to a
warning (skip the note) rather than abort and strand the lock, or (c) the note path
should understand a `tasks/backlog/`-resident body the same way `--allow-backlog`
resolution does.

## Suggested fix direction (for triage, not decided)

- Make `requeue` lock-release ORDER-INDEPENDENT of the optional `-m` note: release
  the lock (the load-bearing recovery) first / unconditionally, and treat a failed
  note append as a non-fatal warning.
- Teach the note-append body resolver about `tasks/backlog/` residence (mirror the
  `--allow-backlog` resolution order in `resolveTask`), so `-m` works for staged
  items too.
- Fix the stale `work/backlog/` path string in the error message (the pool is
  `tasks/ready/`; staging is `tasks/backlog/`) — it currently names a folder that
  is neither.

Refs: observed via `node packages/dorfl/dist/cli.js requeue <slug> --reset -m ...`
on a `tasks/backlog/` item. Related: the Gate-2 crash that caused the recovery in
the first place — `work/notes/observations/gate2-review-verdict-json-parse-crash-on-large-diffs.md`.
