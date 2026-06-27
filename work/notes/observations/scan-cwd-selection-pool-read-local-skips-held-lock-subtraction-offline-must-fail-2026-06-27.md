---
title: scan's cwd selection pool reads the LOCAL working tree and skips the held-lock subtraction (empty held set), so CI re-enumerates in-flight items; offline selection must FAIL closed, not degrade to a wrong eligible pool
date: 2026-06-27
status: open
---

## What was observed

The scheduled `advance-lifecycle` (propose mode) reds on every tick. Each matrix
leg is `dorfl advance "task:<slug>" --propose ...` for an item that ALREADY has a
held per-item lock + an open PR, and each leg correctly hits the held-lock guard
(`claim-cas.ts`, "already claimed on origin/main (its per-item lock is held)") and
exits 2. Four such legs (the four open propose PRs from one batch) ⇒ the whole
lifecycle run fails.

The held-lock guard erroring is CORRECT (it is the last-line claim mutex). The
defect is UPSTREAM: the enumerator handed `advance` an in-flight item it should
have SUBTRACTED. The matrix is built from `dorfl scan --json | jq`, and the legs
came from the cwd-local pool `.cwd.repo.items[]`.

## Root cause (single, in `cwd-section.ts`)

`resolveCwdSection` builds the cwd selection pool from the LOCAL WORKING TREE and
passes an EMPTY held set:

```ts
const localReport = scanRepoPaths([cwd], config, new Set(), options.override);
//                                              ^^^^^^^^ no held-lock subtraction
```

`scanRepoPaths` does no lock read of its own (by design — it is the offline
working-tree scan and relies on the CALLER to supply the held set; `scoreItems`'s
`state.ready.filter(s => !held.has(s.slug))` then subtracts NOTHING). So every
in-flight, lock-held task stays in `.cwd.repo.items[]` as `eligibility.eligible:
true`, the matrix `jq` selects it, and it becomes a claim leg that then dies on
the guard.

The registry `scan()` path is NOT affected: it reads the held set via
`heldTaskSlugs(mirror.path, 'origin', env)` and subtracts. Only the IN-PLACE cwd
section skips it — and CI runs in-place, so the cwd pool is exactly what CI
enumerates.

This is DISTINCT from the (now-corrected) propose-window/fail-open-read
observation: here the held set is not "read then empty on a fault", it is NEVER
READ AT ALL on the cwd path — `new Set()` is hardcoded. The held locks for these
four items ARE present on the arbiter; the cwd selection simply never looks.

## The deeper decision (maintainer call, 2026-06-27)

`scan` (and `status`) was originally an all-LOCAL read; the remote-truth model was
layered on later for the registry path but never reached the cwd selection pool.
The held-lock set lives ONLY on the arbiter (`refs/dorfl/lock/*`), so a
local-only selection read is structurally incapable of being correct under
concurrency. Decisions:

1. The SELECTION pool (what becomes claim/enumerate legs) is REMOTE-AUTHORITATIVE.
   The cwd section must read the held-lock set from the arbiter it ALREADY fetches
   for the divergence line, and subtract it — exactly as the registry `scan()`
   does.

2. OFFLINE SELECTION FAILS CLOSED. If the cwd repo has a configured arbiter but
   the held-lock read cannot reach it, the cwd eligibility is UNKNOWN and `scan`
   must FAIL rather than emit a confident-but-wrong eligible pool. There is NO
   `--local` escape hatch (explicit maintainer call): a wrong eligible pool under
   concurrency is worse than a hard failure. An offline solo agent gets a clear
   error, not a silent mis-enumeration.

3. The pure read-only SURFACE concerns (the divergence line: "local main is N
   ahead of <arbiter>/main") keep their graceful warn+last-known behaviour — that
   is a reporting fact about the working tree, never an input to who-claims-what.
   The split is: SELECTION (held-lock subtraction, eligibility) = remote +
   fail-closed; SURFACE (divergence) = best-effort.

## The fix

In `resolveCwdSection`: resolve the arbiter FIRST, read `heldTaskSlugs(cwd,
arbiter.remote, env)` from it, and pass that set into `scanRepoPaths`. When the
cwd repo has a configured arbiter but the lock read fails, THROW (fail closed) so
`scan --json` errors rather than enumerating an untrusted pool. A repo with NO
configured arbiter has no remote coordination surface and keeps the local read
(nothing to subtract, nothing to fail against).

Mark RESOLVED when the cwd selection pool subtracts the arbiter-read held set and
offline selection fails closed.
