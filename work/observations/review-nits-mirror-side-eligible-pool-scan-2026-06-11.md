---
title: review-gate non-blocking nits for 'mirror-side-eligible-pool-scan' (Gate 2 approve)
date: 2026-06-11
status: open
slug: mirror-side-eligible-pool-scan
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'mirror-side-eligible-pool-scan' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the mirror-side scan resolves per-repo policy by reading the COMMITTED `.agent-runner.json` from the mirror's `main` (via the new `resolveRepoConfigFromMirror`), so `allowAgents`/`autoSlice` resolve per-repo exactly as an in-place checkout would. The existing registry `scan` (scan.ts) does NOT do this — it resolves only global policy and its docstring explicitly states the per-repo file 'cannot be read from a bare mirror'. This slice diverges from that sibling (arguably an improvement, and it is what the slice's in-place-parity requirement demands), but it means two mirror-reading scans now resolve per-repo policy differently. Confirm the divergence is intended and that registry `scan` should NOT be brought into line (or a follow-up filed to do so).
  (mirror-pool-scan.ts `scanMirrorPool` calls `resolveRepoConfigFromMirror({mirrorPath, global: config})`; scan.ts `scan()` uses `resolveRepoConfig({repoPath: mirror.path, global: config})` with a docstring noting the per-repo override 'is a working-checkout concern, served by scanRepoPaths'. The reusable helper `resolveRepoConfigFromMirror` is a new extraction of cli.ts's inline `resolveRemoteRepoConfig`.)
- Ratify the in-scope resilience default: a per-repo-config read fault from the mirror's `main` is swallowed — the scan emits an optional `warn(...)` and falls back to global+default rather than erroring. This is correct for a read-only enumeration (it must never block the queue), and it mirrors `scan`'s fetch-first-never-fatal stance, but it is a user-visible default (a corrupt/unreadable committed `.agent-runner.json` silently degrades to global policy) that the slice did not explicitly specify. Confirm silent-degrade-with-warning is the desired behaviour here.
  (mirror-pool-scan.ts `scanMirrorPool`: the try/catch around `resolveRepoConfigFromMirror` sets `repoConfig = config` and calls `warn?.(...)` on failure. Exercised indirectly by the per-repo-config-layering test; no test seeds a deliberately-corrupt committed config to assert the warn-and-fallback branch directly (a follow-up test could pin it, paralleling the standing observation about the untested catch branch in cli.ts's `resolveRemoteRepoConfig`).)
