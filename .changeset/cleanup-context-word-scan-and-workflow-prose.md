---
'dorfl': patch
---

Cleanup residual `prd` artifact-word after the hard cutover: flip the now-dead `prd:` field / `do prd:` verb references in `CONTEXT.md` to `spec:` / `do spec:`, and sweep the stale `prd`/`PRD` comment prose in a few living docs (`skills/orchestrate`, two ADRs) + dorfl's own generated `.github/workflows/*.yml` comments (the functional YAML was already `spec`; only comment prose was stale — a `dorfl install-ci` regen produces the same). Tighten the WORD leak scan (`prd-word-cutover-leak-scan.test.ts`) so the `prd:` field / `do prd:` verb PROSE exemption applies ONLY inside TERMINAL-HISTORY trees (`work/tasks/done|cancelled`, `work/specs/tasked|dropped`, append-only notes) where rewriting would falsify the record — a `prd:` / `do prd:` in a LIVING doc (CONTEXT/README/AGENTS/skills/docs/active-work) is now flagged as a leak, since the hard cutover made those forms dead. This caught (and fixed) 3 stale references the earlier sweep missed.
