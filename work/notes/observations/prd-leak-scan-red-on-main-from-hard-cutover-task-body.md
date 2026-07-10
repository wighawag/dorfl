# prd-word-cutover-leak-scan red on main from the hard-cutover task's own ready body

Date: 2026-07-10

`packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` fails on `origin/main`
(and therefore on every task branch built from it) because
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(introduced by commit `1b1b2676`) contains the standalone artifact-word "prd" at
lines 2, 3, and 26. Those occurrences are load-bearing for that task (its whole
point is to remove the prd back-compat, so it must literally name "prd"), but
the leak-scan's PRESERVE allow-list does not exempt them, so `pnpm -r test`
cannot be made green without either sweeping/aliasing those references or
extending the allow-list — either move belongs to that task's own execution, not
to unrelated follow-up tasks that inherit the red gate.

Noticed while working on
`complete-propose-honour-already-landed-and-rename-continue-branch-module`; its
own tests + build are clean.
