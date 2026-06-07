---
title: scan/status give a dead-end "No participating repos found" when run INSIDE a participating-but-unregistered repo — the tool is literally in a work/-bearing repo and says it sees nothing
date: 2026-06-07
status: open
---

## The signal (observed live)

Running `agent-runner scan` inside the agent-runner repo itself:

```
No participating repos found.
(A repo participates iff it has a work/backlog/ with >= 1 .md file.)
```

and `agent-runner status`:

```
Active jobs (running): (none)
Failed / retained jobs (look here): (none)
Summary: 0 active, 0 failed/retained job(s).
Arbiter: no 'arbiter' remote configured in this repo.
```

— even though the cwd IS a participating repo (it has `work/backlog/*.md`).

## Why it happens (NOT a bug — the registry model working as designed)

`scan`/`status` read the REGISTRY (the hub-mirror set under
`<workspacesDir>/repos/`), NOT the cwd repo — confirmed in `src/scan.ts` (`scan()`
→ `listMirrors()` → mirror-ref read) and `src/status.ts` (`listMirrors` +
`resolveMirrorState`). This is the §1 registry model (`registry-remote`, done): the
remote/registry is the source of truth for the autonomous daemon's claims. The repo
simply was never `remote add`-ed into the registry, so the registry is empty. The
"no 'arbiter' remote" line is also literally true — this repo's git remote is
`origin`, not `arbiter`.

So the behaviour is CORRECT for the model — but the UX is a dead-end: a human
standing inside a participating repo is told "nothing here", with no hint of why or
how to fix it.

## What it is NOT

It is NOT what `scan-status-fetch-first` fixes — that slice adds a `git fetch` of
the REGISTRY mirrors before reading; it does not make an unregistered cwd repo
appear, and does not change WHAT is read. Conflating the two would be wrong.

## Disposition — SLICED 2026-06-07 → `work/backlog/scan-status-read-cwd-repo.md`

Maintainer decision (2026-06-07): `scan`/`status` SHOULD also read the cwd repo
(yes), and SHOULD fetch its arbiter first too. The fix is the slice
`scan-status-read-cwd-repo`:

- report the cwd repo as a DISTINCT, separately-counted LOCAL section (never merged
  into the registry total — the one real inconsistency trap: registry = bare-mirror
  arbiter state; cwd = local working tree, possibly diverged);
- fetch the cwd's OWN arbiter first (extend the fetch-first discipline to the local
  repo), warn + fall back on failure;
- show divergence-vs-arbiter (the `main-divergence-guard` framing);
- replace this dead-end message with a self-registration hint
  (`remote add . --local`);
- de-dup if the cwd is also registered.

The registry model is unchanged (read-only display ≠ claim target; the daemon/CAS
still claim against the registry). Consonant with `advance-loop`'s cwd-local
`ls work/questions/` direction.

(Captured 2026-06-07 from a live `scan`/`status` run during the backlog-organisation
review; sliced the same session.)
