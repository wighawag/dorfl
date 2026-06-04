# gc.ts has no `work/` lifecycle-state reads to route through the read seam

2026-06-04 (while building `ledger-read-seam`)

The `ledger-read-seam` slice lists `gc.ts`'s "`work/`-state reads" as a route-
through target "where applicable". On inspection, `gc.ts` reads only **job
worktrees** under `<workspacesDir>/work/*` (the execution substrate — ADR §2/§4),
NOT the `work/backlog|done|in-progress|needs-attention` **lifecycle ledger** the
read seam resolves ("resolve the live `work/` state for a repo"). Two different
`work/` namespaces share the name. So gc has zero applicable lifecycle reads and
is intentionally left unchanged by the seam; the criterion is satisfied vacuously.
The reasoning is recorded in `src/ledger-read.ts`'s module doc. No action needed.
