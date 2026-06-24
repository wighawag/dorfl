---
needsAnswers: false
---

# Observation: ADR §6 still cites the old `SLICING-PROTOCOL.md` filename (2026-06-23)

After renaming the protocol doc `SLICING-PROTOCOL.md` → `TASKING-PROTOCOL.md` (task `rename-protocol-doc-slicing-to-tasking`), `docs/adr/methodology-and-skills.md:81` still references the old filename `SLICING-PROTOCOL.md` (and the verb "slicing") in its §6 refinement bullet — a now-dangling filename reference to a file that no longer exists.

This ADR is NOT in this task's named referencer list, and the follow-on prose-sweep task `rename-protocol-prose-and-skills-slicing-to-tasking` scopes only `REVIEW`/`CLAIM` protocol docs + templates + `skills/*/SKILL.md` (not `docs/adr/`). The brief mentions an "ADR-prose sweep" as a file-orthogonal unit, so an ADR sweep likely needs its own task (none currently in todo/backlog). Captured here so the dangling reference is not silently lost.

## Applied answers 2026-06-24

### q1: Drop this observation as superseded: the claimed dangling `SLICING-PROTOCOL.md` filename reference at `docs/adr/methodology-and-skills.md:81` no longer exists — line 81 already cites `TASKING-PROTOCOL.md`, and the only remaining `slicing`/`slice` mentions (lines 38/44/49) are intentional historical prose protected by the §0 forward note at line 14 ("read every `slice` below as **task** … the verb `slicing` as **tasking** … the original text is left intact to preserve the decision history"). Agree to drop, or is there still something to sweep here?

dropped (reason: superseded by current docs state). Verified: `grep -n 'SLICING-PROTOCOL' docs/adr/methodology-and-skills.md` returns no matches; line 81 already cites `TASKING-PROTOCOL.md`; the residual `slicing`/`slice` prose (lines 38/44/49) is intentional historical decision-record text grandfathered by the §0 forward note at line 14. No dangling filename and no ADR sweep needed.

disposition: dropped

## Recommended: delete

A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.
