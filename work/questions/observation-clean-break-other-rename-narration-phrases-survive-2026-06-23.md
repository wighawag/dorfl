<!-- agent-runner-sidecar: item=observation:clean-break-other-rename-narration-phrases-survive-2026-06-23 type=observation slug=clean-break-other-rename-narration-phrases-survive-2026-06-23 allAnswered=false -->

## Q1

**Triage: what becomes of this observation that five non-slice/prd rename-narration phrases survive in the prose (the `pr`→`propose` rename, `return`→`requeue`, the untrusted-origin prior-state line, and the two `allowAgents` mentions)?**

> Observation `work/notes/observations/clean-break-other-rename-narration-phrases-survive-2026-06-23.md` notes the clean-break sweep (task `clean-break-context-adr-and-skills-prose`) was scoped verbatim by the maintainer to slice/prd/slicing terminology, so these OTHER rename-narration clauses are out of scope for that brief — but AC #5's broader wording ('no rename-narration anywhere') could be read to cover them. Concrete hits: docs/adr/execution-substrate-decisions.md:75; docs/adr/command-surface-and-journeys.md:120; docs/adr/untrusted-origin-build-checkpoint.md:17; skills/setup/SKILL.md:254; skills/setup/protocol/WORK-CONTRACT.md:198. The observation explicitly frames this as 'a separate editorial decision (a possible follow-up prose task)', not a miss of the completed brief.
>
> Disposition options: `promote-task` (spawn a follow-up prose sweep that strips these other-rename clauses); `keep` (leave as a tracked signal pending more evidence); `dropped` (record the editorial decision NOT to strip them — these narrations are arguably load-bearing reader context for the renamed concepts, and a `reason:` line in the body would capture why); `needs-attention` (escalate to maintainer for the editorial call).

_Suggested default: promote-task — spin a small follow-up prose task to remove the five surviving rename-narration clauses, since each is a fossil of a completed rename whose old name is no longer reachable from current docs (matching the spirit of AC #5's broader wording). If the maintainer prefers to retain them as reader hand-holds, flip to `dropped` with `reason: editorial — rename narration retained as reader context`._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
