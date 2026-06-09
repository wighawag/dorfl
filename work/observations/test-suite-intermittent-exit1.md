# Observation: `pnpm -r test` occasionally exits non-zero with all tests passing

**2026-06-07** — During the `human-face-verbs` slice, one `pnpm -r test` run reported `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` / `Exit status 1` while the vitest summary still showed `Test Files 59 passed (59)` / `Tests 832 passed (832)`. Immediate re-runs exited 0 cleanly (832/832). Looks like an intermittent runner/process flake (no named failing test, ~110s suite). Not investigated — out of this slice's scope; captured here so the signal isn't lost.
