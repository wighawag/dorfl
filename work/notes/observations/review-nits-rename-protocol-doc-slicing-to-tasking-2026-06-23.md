---
title: review-gate non-blocking nits for 'rename-protocol-doc-slicing-to-tasking' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: rename-protocol-doc-slicing-to-tasking
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'rename-protocol-doc-slicing-to-tasking' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the agent's scoping decision: the dangling protocol-doc reference in `docs/adr/methodology-and-skills.md:81` (still citing `SLICING-PROTOCOL.md` + the verb 'slicing', now a filename that does not exist) was DELIBERATELY left out of this task and captured as observation note `work/notes/observations/adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23.md` instead of fixed. Is that the right call, and who owns the fix? The brief's Decision 6 names a closed referencer list (vendor script, prompt builder, to-task/SKILL.md, doc test, mirror, VERSION) that does NOT include the ADR; the existing follow-on `rename-protocol-prose-and-skills-slicing-to-tasking` scopes only REVIEW/CLAIM docs + templates + skills/*/SKILL.md and EXCLUDES docs/adr/. So no current todo/backlog task owns this dangling reference. The scoping is correct (this task should not have expanded), and capturing-not-guessing is the right move, but the human should confirm a docs/adr/ sweep task gets created so the reference is not silently lost.
  (brief code-identifier-slice-prd-to-task-brief-rename Decision 6 (closed referencer list) + Solution (ADR-prose sweep listed as a separate file-orthogonal unit); observation note adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23.md; grep shows docs/adr/methodology-and-skills.md:81 still references SLICING-PROTOCOL.md)
- Minor: the PR description (commit body) carries no explicit '## Decisions' block. The one in-scope judgement call (defer the ADR reference to a separate sweep) was instead recorded as a work/ observation note, which is arguably a better home for it. No action needed beyond noting that future renamer slices touching ambiguous scope boundaries would be easier to ratify with the decision stated in the PR body too.
  (git show HEAD commit body; work/notes/observations/adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23.md)
