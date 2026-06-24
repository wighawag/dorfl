<!-- dorfl-sidecar: item=observation:triage-observations-skill-ignores-pending-questions-2026-06-20 type=observation slug=triage-observations-skill-ignores-pending-questions-2026-06-20 allAnswered=false -->

## Q1

**Disposition for this observation: promote a slice that amends the `triage-observations` skill to add the pending-questions surface (open sidecars in `work/questions/` + an item's `needsAnswers` / `## Open questions` block) to step 2 INVESTIGATE — or keep / drop / route elsewhere?**

> The note reports that `triage-observations` step 2 enumerates 'code, tasks, briefs, ADRs, protocol docs' but omits the answer-loop surface (sidecars + declared-open state), so the loop can confidently recommend delete/make-task on a note whose concern is in fact alive in an unanswered question. The note explicitly scopes the fix as a SKILL-doc change (investigate checklist + maybe disposition guidance), not a code change, and flags a sibling `surface-questions` skill that is not wired in. No sidecar yet exists for this observation, and the body declares no `needsAnswers` / `## Open questions`, so the only open judgement is the triage routing itself.

_Suggested default: promote-slice (small skill-doc amendment to `~/.agents/skills/triage-observations/SKILL.md`: add pending-questions to the investigate-sources list and a 'leave — blocked on <question>' disposition note)_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

## Q2

**If the skill is amended, should the pending-questions check be exact-item-only (sidecar keyed to the same `observation:`/`task:`/`brief:` id, cheap and unambiguous) or also include topical/area overlap (judgement-based, surfaced to the human, never auto-decided)?**

> The note flags this as the main thing 'to weigh' for the amendment: exact-item matching is cheap and unambiguous (does a sidecar exist for THIS item, including the observation's own promote/keep/delete sidecar since `SidecarType` includes `observation`); topical matching catches more real overlaps but is fuzzy free-form-prose matching that must be surfaced to the human per the skill's never-auto-decide rule. This shapes the slice's scope (checklist line vs. checklist line + matching heuristics + surfacing guidance).

_Suggested default: both, but tiered — exact-item match is a hard check the loop MUST perform; topical/area overlap is a soft 'consider whether any open question touches this area' prompt that is surfaced to the human, never auto-decided_

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
