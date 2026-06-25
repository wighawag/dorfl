---
needsAnswers: true
---

# in-progress/ folder also appears unwritten — follow-up candidate

2026-06-25 — while finishing
`finish-needs-attention-folder-cutover-remove-legacy-recovery-readers`, a quick
grep for actual writers into `work/in-progress/` (real `git mv`/`writeFile` INTO
that folder, not comments/log text) under `packages/dorfl/src/` returned only
historical/prose hits. The per-item-lock cutover moved claim OFF writing
`work/in-progress/` and the body now rests in `work/tasks/backlog/`. If a deeper
diagnosis confirms this, the `in-progress/` folder probes (notably
`complete.ts`'s `onInProgress` arm + `start.ts`'s `--resume` folder-based
decision called out by the parent task's scope fence) could be retired the same
way `needs-attention/` was. Deliberately NOT acted on here — scope fence in
parent task.
