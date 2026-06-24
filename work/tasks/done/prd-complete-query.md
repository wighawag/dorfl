---
title: "is this PRD complete?" read-only core query — ≥1 slice with prd:<slug> AND all such slices in work/done/ (pure work/-folder logic)
slug: prd-complete-query
prd: issue-intake
blockedBy: []
covers: [8]
---

## What to build

A read-only **"is this PRD complete?"** core query over the `work/` folder tree: a PRD is COMPLETE iff there is **≥1 slice carrying `prd:<slug>`** AND **all such slices are in `work/done/`**. Pure `work/`-folder logic — no seam, no git, no `gh`.

This is the LINKAGE half of loop-closure that the engine EMITS for CI to ACT on. The CI close-JOB that CONSUMES this query (calls it, then `closeIssue`) is **NOT built here** — it is `runner-in-ci`'s. This slice builds ONLY the read-only query.

Context (the loop-closure model — see the PRD):

- a lone SLICE's PR carries `Fixes #N` → its merge closes the issue directly;
- a PRD fans out to N slices = N PRs carrying `Refs #N` (NOT `Fixes #N`, which would close on the first of N merges); the issue is closed by CI's merge-to-main job running THIS query + `closeIssue`. The issue number lives ONLY on the PRD (`issue: N`); slices link via `slice → prd: → PRD issue:`.

The "PRD complete?" query is verified NOT to exist yet in `packages/dorfl/src` (PRD claim 2026-06-06; re-confirm at build time against `work/done/` + the code). The read path is concrete: scan the slice folders (`work/backlog/` + `work/in-progress/` + `work/needs-attention/` + `work/done/`), parse each slice's `prd:` via `parseFrontmatter` (`src/frontmatter.ts` exposes `prd:`), filter to those whose `prd:` equals `<slug>`, and check residence: COMPLETE iff that set is non-empty AND every member resides in `work/done/`. This is a `work/`-FOLDER residence scan keyed on the parsed `prd:` field — NOT the claim ledger (`ledger-read.ts` is claim-state, a different concern); do not reach for the ledger seam here. Reuse `parseFrontmatter`; do not hand-roll a YAML parse.

NOTE the consumer linkage (why this query matters): the CI close JOB (`runner-in-ci`'s, NOT built here) reaches the issue number via `slice.prd: → work/prd/<prd>.md → PRD `issue:``, then runs THIS query, then `closeIssue`iff complete. So this query keys on the SAME`prd:`field that hop uses — the issue number lives only on the PRD; slices carry no`issue:` field.

## Acceptance criteria

- [ ] A read-only function: given a PRD slug + a `work/` tree, returns whether the PRD is COMPLETE. COMPLETE iff ≥1 slice has `prd:<slug>` AND ALL such slices are in `work/done/`.
- [ ] Tested over FIXTURE `work/` trees: - no slices with `prd:<slug>` ⇒ NOT complete (≥1 required); - ≥1 such slice but some NOT in `work/done/` ⇒ NOT complete; - ≥1 such slice and ALL in `work/done/` ⇒ COMPLETE.
- [ ] The query is READ-ONLY (no git, no mutation, no `gh`, no seam) and reuses the existing frontmatter (`prd:`) + folder/ledger read rather than a new ad-hoc walk.
- [ ] The CI close-JOB that consumes it is NOT built (out of scope — `runner-in-ci`); this slice exposes only the query for that job to call.
- [ ] Tests mirror the repo's existing fixture-`work/`-tree style.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — fully independent (no seam, no command grammar). Can start immediately, in parallel with the rest of the `issue-intake` set.

## Prompt

> Build the read-only "is this PRD complete?" CORE QUERY: given a PRD slug + a `work/` tree, COMPLETE iff ≥1 slice carries `prd:<slug>` AND all such slices are in `work/done/` (US #8 — the closure-linkage half). Pure `work/`-folder logic — no seam, no git, no `gh`.
>
> CONTEXT (the loop-closure model, from `work/prd-sliced/issue-intake.md`): a lone slice's PR carries `Fixes #N` (its merge closes the issue); a PRD fans out to N slices = N PRs carrying `Refs #N`, and the issue is closed by CI's merge-to-main JOB that runs THIS query + `closeIssue`. That JOB is `runner-in-ci`'s — NOT built here. Build ONLY the query.
>
> WHAT TO BUILD: a read-only function over the `work/` tree returning the PRD's completeness per the rule above. REUSE the existing frontmatter read (`prd:` is on `src/frontmatter.ts`) + the existing folder/ledger read seam — do NOT reinvent a folder walk.
>
> SEAM TO TEST AT: the pure query over FIXTURE `work/` trees (the three cases: no such slice ⇒ not complete; some not in done ⇒ not complete; all in done ⇒ complete).
>
> SCOPE FENCE: ONLY the read-only query. Do NOT build the CI close-JOB, do NOT call `closeIssue`, do NOT touch the issue seam / dispatcher / lock / mode KNOBS / event-classification. No CI/install.
>
> FIRST run the drift check (PRD claim 2026-06-06): VERIFY this query does NOT already exist in `packages/dorfl/src` — re-check `work/done/` + the code, since slices land continuously. If it already exists, route this slice to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal") rather than duplicating it.
>
> "Done" = the read-only query returns complete iff ≥1 `prd:<slug>` slice AND all in `work/done/`, tested over fixture trees, no mutation/seam/gh, the CI job left out, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
