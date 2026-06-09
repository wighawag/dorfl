---
title: the command-surface ADR frames the targeting axis as "bare = current repo; --remote = anywhere" — adding `do --isolated` introduces a THIRD point (isolated-but-same-repo); the ADR wants a one-line additive note
date: 2026-06-08
kind: observation
area: docs/adr/command-surface-and-journeys.md
severity: low
status: open
---

## The signal

The maintainer decided (2026-06-08) to add `do --isolated <slug>` — build in a job worktree off THIS repo's arbiter — as a flag ORTHOGONAL to `do --remote <url>` (target a foreign repo). Sliced as `work/backlog/do-isolated-in-place.md`.

`docs/adr/command-surface-and-journeys.md` currently frames the agent-execution targeting axis as a BINARY: "bare = current repo; `--remote` = anywhere" (it says this ~8 times across §§ on `do`/`work-on`/the resolution). `--isolated` adds a THIRD point the binary framing doesn't capture:

- `do <slug>` — current repo, IN the checkout (in-place).
- `do --isolated <slug>` — current repo, in a WORKTREE (off my arbiter). **(new)**
- `do --remote <url> <slug>` — a FOREIGN repo (no checkout; isolation implied).

So the axis is really two questions: WHICH repo (current vs foreign = `--remote`) and, for the current repo, WHERE to build (checkout vs worktree = `--isolated`).

## Disposition

The slice itself is purely additive and does NOT touch the ADR (correctly — ADR edits are maintainer-owned). This observation is the reminder to add a one-line note to the ADR so the surface doc stays coherent once `do --isolated` lands — e.g. fold the three-row table above into the § on `do`'s execution targeting. Low priority; do it when the slice merges (or batch it with the next ADR pass). Not a code change.
