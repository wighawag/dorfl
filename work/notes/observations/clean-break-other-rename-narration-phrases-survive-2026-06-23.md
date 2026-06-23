# Non-slice/prd rename-narration phrases survive the clean-break prose sweep (2026-06-23)

Task `clean-break-context-adr-and-skills-prose` (brief `code-identifier-slice-prd-to-task-brief-rename`)
swept ALL slice/prd/slicing transition scaffolding cleanly (verified: zero `code-identifier-...` Forward
notes, zero `as-yet-unrenamed`/`NOT yet reflected`/`tracked as a separate brief`; CONTEXT.md 2026-06-22
vocab note gone; the slices-land-in ADR git mv'd; the slice/prd current-concept sweep complete).

Its AC #5 also listed the generic phrase-patterns "renamed from"/"used to be"/"the old name". Five hits
of THOSE patterns survive, but every one narrates a DIFFERENT rename, not slice->task:
- `docs/adr/execution-substrate-decisions.md:75` — "_(Renamed from `pr`...)_" (the `pr`->`propose` mode rename).
- `docs/adr/command-surface-and-journeys.md:120` — "`requeue <slug>` (renamed from `return`)".
- `docs/adr/untrusted-origin-build-checkpoint.md:17` — "its untrusted origin used to be invisible" (prior-state narration).
- `skills/setup/SKILL.md:254` + `skills/setup/protocol/WORK-CONTRACT.md:198` — "renamed from the now-removed `allowAgents`".
- (`docs/adr/methodology-and-skills.md:10` keeps a `Forward note (2026-06-21 — Matt Pocock skills v1.0.0)`
  block — a non-rename versioning note, correctly NOT a slice/prd transition artifact.)

These are out of THIS brief's slice->task mandate (the maintainer's verbatim rule scoped the sweep to
slice/prd/slicing). Whether the broader AC-#5 "no rename-narration anywhere" wording should also strip
these OTHER-rename clauses is a separate editorial decision (a possible follow-up prose task), NOT a
slice/prd-rename miss. Filed so the choice is explicit, not silently dropped.
