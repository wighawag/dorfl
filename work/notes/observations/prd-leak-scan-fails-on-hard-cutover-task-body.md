---
date: 2026-07-10
seen-from-task: pi-harness-polish
---

`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails on `origin/main`
(pre-existing, not caused by pi-harness-polish) because the task body
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
mentions the artifact word `prd` on lines 2, 3, 26 and is not on the leak-scan
PRESERVE allow-list. The task IS the fix (it removes the last `prd` back-compat),
so this will self-heal when it lands; noted here because it makes the acceptance
gate red for any concurrent branch.
