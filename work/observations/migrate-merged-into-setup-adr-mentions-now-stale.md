---
title: migrate skill was merged INTO setup (one onboarding skill); two ADR mentions of `migrate` as a separate/future skill are now stale
date: 2026-06-09
kind: observation
area: docs/adr/command-surface-and-journeys.md (§ adopt=skill)
severity: low
status: open
---

## The signal

The `migrate` skill was **deleted and folded into `setup`** — `setup` is now the single onboarding skill: it detects the repo's state and does the right depth (empty → scaffold only; populated → scaffold + convert, with the decision hunt + ADR elicitation). Rationale: the migrate-vs-setup split was an artificial seam the user had to know about; on an empty repo, migrate would correctly say "wrong tool, use setup" yet still offer to do setup's job — friction the user shouldn't face. One entry point, auto-detected depth, is the honest design.

Two references in **`docs/adr/command-surface-and-journeys.md`** still name `migrate` as a separate/future skill:

- §(adopt=skill): "...this is why `to-slices`, `to-prd`, and the future `setup`/`migrate` are SKILLS."
- the deferred-items note: "Future protocol-layer items (`setup`, `migrate` skills) ... captured separately, NOT built in this pass."

These are now stale: there is no `migrate` skill; `setup` subsumes it.

## Why only an observation (not a fix)

`command-surface-and-journeys.md` is an **accepted ADR** (a decision record). The merge IS a real decision and arguably warrants a small ADR update (or a short new ADR recording "migrate merged into setup; one onboarding skill"), but that should be a deliberate, human-ratified edit to the decision record — not an agent silently rewriting an ADR while doing the merge. The references are historical/forward-looking prose and break nothing operationally, so `severity: low`.

## Suggested resolution (for a human)

Either (a) update the two mentions in `command-surface-and-journeys.md` to "`setup` (the single onboarding/migration skill)", or (b) add a short ADR recording the merge decision and let the old mentions stand as historical context. CONTEXT.md's glossary line was already updated to "`setup` — the single onboarding/migration skill" (glossary is current-truth, safe to edit; the ADR is the decision record, left for the human).

## Provenance

Spotted 2026-06-09 while merging `skills/migrate/` into `skills/setup/` and grepping for residual `migrate` references.
