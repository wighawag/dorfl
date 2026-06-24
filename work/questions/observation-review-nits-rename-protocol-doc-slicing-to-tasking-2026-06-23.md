<!-- dorfl-sidecar: item=observation:review-nits-rename-protocol-doc-slicing-to-tasking-2026-06-23 type=observation slug=review-nits-rename-protocol-doc-slicing-to-tasking-2026-06-23 allAnswered=false -->

## Q1

**Should a docs/adr/ prose-sweep task be created to fix the dangling `SLICING-PROTOCOL.md` / 'slicing' reference at `docs/adr/methodology-and-skills.md:81`, and who owns it?**

> Nit #1 in the observation ratifies the agent's scoping decision (this task deliberately did NOT touch the ADR — capturing-not-guessing). The brief `code-identifier-slice-prd-to-task-brief-rename` Decision 6 names a CLOSED referencer list that excludes docs/adr/. The follow-on `rename-protocol-prose-and-skills-slicing-to-tasking` task scopes REVIEW/CLAIM docs + templates + skills/*/SKILL.md and explicitly EXCLUDES docs/adr/. The brief Solution mentions an 'ADR-prose sweep' as a separate file-orthogonal unit. Sister observation `adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23.md` confirms no current todo/backlog task owns this. Grep verifies `docs/adr/methodology-and-skills.md:81` still cites the old filename.

_Suggested default: Yes — promote a small ADR-sweep task (e.g. `rename-adr-prose-slicing-to-tasking`) covering docs/adr/*.md, with the same author/runner ownership as the other sister sweep tasks. The scoping decision itself was correct; the residue is just the missing task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**How should this observation be triaged once the ADR-sweep question above is answered?**

> Native observation triage. Nit #1 is actionable (promote → create the ADR-sweep task, OR fold into the existing `rename-protocol-prose-and-skills-slicing-to-tasking` task by expanding its scope to include docs/adr/). Nit #2 ('PR body had no explicit ## Decisions block') is explicitly flagged 'no action needed beyond noting' — purely retrospective guidance for future renamer slices, not a unit of work. So the observation as a whole resolves once the ADR-sweep decision lands.

_Suggested default: promote-task — promote the ADR-sweep work (per the answer to Q1) and drop nit #2 as informational-only in the body. If the human prefers to fold the ADR sweep into the existing sister task instead of creating a new one, `keep` until that task is updated, then `dropped`._

<!-- q2 fields: id=q2 disposition=promote-task -->

**Your answer** (write below this line):
