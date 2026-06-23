---
needsAnswers: true
---

# Observation: ADR §6 still cites the old `SLICING-PROTOCOL.md` filename (2026-06-23)

After renaming the protocol doc `SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` (task `rename-protocol-doc-slicing-to-tasking`), `docs/adr/methodology-and-skills.md:81` still references the old filename `SLICING-PROTOCOL.md` (and the verb "slicing") in its §6 refinement bullet — a now-dangling filename reference to a file that no longer exists.

This ADR is NOT in this task's named referencer list, and the follow-on prose-sweep task `rename-protocol-prose-and-skills-slicing-to-tasking` scopes only `REVIEW`/`CLAIM` protocol docs + templates + `skills/*/SKILL.md` (not `docs/adr/`). The brief mentions an "ADR-prose sweep" as a file-orthogonal unit, so an ADR sweep likely needs its own task (none currently in todo/backlog). Captured here so the dangling reference is not silently lost.
