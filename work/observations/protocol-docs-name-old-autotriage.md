---
title: protocol/ADR docs still name the old autoTriage in the gate-family parenthetical
date: 2026-06-13
---

While renaming `autoTriage` → `observationTriage` (slice
`observation-triage-tri-state-gate`), I left the historical/protocol mentions of
the OLD family naming `(autoBuild/autoSlice/autoTriage)` untouched in
`skills/setup/protocol/WORK-CONTRACT.md` (+ its `work/protocol/` mirror) and
`docs/adr/methodology-and-skills.md` — they sit in a protocol contract / ADRs
(records) and the parenthetical is incidental to the `autoBuild` definition, so
out of this engine slice's scope. The live CONTEXT.md glossary WAS updated. Worth
a sweep: those parentheticals now name a config key that no longer exists.
