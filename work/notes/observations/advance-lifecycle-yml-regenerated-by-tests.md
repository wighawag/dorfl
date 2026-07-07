---
needsAnswers: true
---

# 2026-06-26: `pnpm format:check` fails on main (pre-existing) due to `.github/workflows/advance-lifecycle.yml`

`pnpm format:check` fails at HEAD of `main` (independent of any task work):

```
[warn] .github/workflows/advance-lifecycle.yml
```

Reproduces on a clean stash of the branch. Additionally, running
`pnpm -r test` (and/or `build`) regenerates that same yml from
`advance-lifecycle-template.ts` with a quote-style diff on the
`integrationMode` description (single vs. double quoting on the apostrophe
escape). Last touch to the committed yml was the recent
`fix(ci-template): escape the apostrophe in the integrationMode description
(valid YAML)` commit, so the COMMITTED file has drifted from BOTH the
template's emit AND prettier's preferred form.

Noticed while completing `strict-merge-approval-gate`; reverted the
test-regenerated yml so the working tree only carries this task's
intentional changes. Likely fix lives near `advance-lifecycle-template.ts`'s
YAML-string emitter (emit the prettier-canonical form so a regenerated yml
matches `format:check`) — or simply re-commit a `pnpm format`-ed yml.
