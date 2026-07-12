---
date: 2026-07-12
---

`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts > NO standalone artifact-word prd/PRD/Prd …` is RED on main (reproducible with a stashed working tree on this branch's base). Many un-swept `prd`/`PRD` tokens under `work/questions/observation-*` note files (e.g. `observation-erase-prd-word-cutover-decisions-2026-07-10.md`, `observation-installed-close-job-workflow-yml-stale-prd-prose-2026-07-10.md`, …). Unrelated to `make-isolated-default-build-mode` (which touches only `packages/dorfl/src/cli.ts`, its new default test file, and the ADR); flagging so it isn't attributed to this task.
