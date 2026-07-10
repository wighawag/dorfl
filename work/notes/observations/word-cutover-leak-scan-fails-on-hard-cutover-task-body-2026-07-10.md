---
slug: word-cutover-leak-scan-fails-on-hard-cutover-task-body-2026-07-10
---

2026-07-10: `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails on `main` (verified via `git stash` before my task's edits) — the leak scan trips on the task body `work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md` (lines 2, 3, 26) using the standalone artifact word the leak scan bans. Pre-existing, unrelated to `in-place-scan-subtracts-held-locked-slugs-from-propose-matrix`.
