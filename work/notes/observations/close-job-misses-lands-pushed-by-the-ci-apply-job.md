---
title: 'The close-job never runs after a land the CI apply job pushes with GITHUB_TOKEN, so the landed item issue stays open'
date: 2026-09-29
status: spotted
---

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` while re-testing dorfl `main@071cb5a1` (release `sandbox-071cb5a1` on `wighawag/dorfl-ci-sandbox-builds`).

An answered `merge` on `task:add-slugify-text-helper-to-src-strings-js` (issue #14, a lone task from intake) landed on `main` from the item run's apply job (commits 3ee847f and 34ffc9f, run 36564305246). The generated `close-job.yml` triggers on `push` to `main`, but GitHub does not start workflows for a push made with the job's `GITHUB_TOKEN`, and the sandbox has no `DORFL_GH_TOKEN`. So no close-job ran after the land and issue #14 stayed open, though its task is in `work/tasks/done/`; it only closes on the next push by a human (or a PAT). The same applies to every land the CI pushes itself: merge-mode builds, answered merges, and any tree-less publish. Propose PRs merged by a human are unaffected (the merge push is the human's).

Possible fixes: have the apply job run the close-job step itself after a land (it already holds `issues: write`), or add a `schedule:` trigger to `close-job.yml`, or document that `DORFL_GH_TOKEN` is needed for it.

Minor, same job: every close-job run logs `>> closed issue #5 (...)` for an issue that was already closed hours earlier (it posts no new comment). The log reads as if it closed it again; it should say "already closed" and not count it in "closed N issue(s)".
