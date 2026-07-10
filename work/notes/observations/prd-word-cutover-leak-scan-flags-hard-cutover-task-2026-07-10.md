# prd-word-cutover-leak-scan flags `hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`

Date: 2026-07-10

While completing the docs-only task
`ratify-sidecar-kind-field-decisions-in-surface-protocol`, the acceptance gate
(`pnpm -r test`) failed in `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts`.
The failure is pre-existing (reproduces cleanly on a stashed working tree — my
edits touch only `skills/setup/protocol/SURFACE-PROTOCOL.md` +
`work/protocol/SURFACE-PROTOCOL.md`).

The leak-scan flags three occurrences of the standalone artifact-word `prd` in
`work/tasks/ready/hard-cutover-remove-last-prd-back-compat-key-and-dead-verb.md`
(lines 2, 3, 26). That task is BY NATURE about removing prd back-compat, so the
mentions are load-bearing — either its slug/task-title needs a PRESERVE
allow-list entry, or the prose should route via the escape hatch the scan
already recognises. Signal only; not fixed here (outside this task's scope).
