---
'dorfl': patch
---

Stop the generated `intake.yml` hardcoding `DORFL_AUTO_BUILD` / `DORFL_AUTO_TASK` env; read the resolved gates via `dorfl config --json` so the committed `dorfl.json` gates are honored in CI.

The intake workflow's `env:` block pinned `DORFL_AUTO_BUILD: 'false'` / `DORFL_AUTO_TASK: 'false'`. Since env outranks per-repo config in the resolution chain (flag > env > per-repo > global > default), those defaults SHADOWED a repo's committed gates: a repo with `autoBuild: true` in `dorfl.json` was silently overridden by the hardcoded `false`, contradicting the documented "the same dorfl.json applies in CI." The env lines are removed and the policy step now reads the resolved gates via `dorfl config --json` (the mechanism the `advance` workflow already uses). `validateIntakeWorkflow` gains `no-gate-env-auto-build` / `no-gate-env-auto-task` invariants (mirroring `advance-lifecycle-template.ts`) so the shadowing bug cannot regress. Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
