---
date: 2026-07-10
---

`prd-word-cutover-leak-scan.test.ts` fails on main (independent of the
answered-observation-sidecar follow-up nits task): the `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb`
task body in `work/tasks/ready/` legitimately talks about the artifact word
`prd` (title + body), which the tree-wide word-leak scan flags. Reproduced by
stashing all local edits + running the scan — the failure is unchanged. The
in-flight hard-cutover task itself is the intended fix (either by allow-list
adjustment or by that task landing).
