---
title: The triage-observations skill ignores pending questions (sidecars / needsAnswers) when investigating a note
type: observation
status: spotted
spotted: 2026-06-20
needsAnswers: true
---

## What was seen

The `triage-observations` skill drains `work/notes/observations/` one note at a
time: READ → INVESTIGATE against "current reality (code/tasks/briefs/ADRs)" →
RECOMMEND a disposition (leave / delete / make-task / amend / fold-into-ADR) → WAIT
→ EXECUTE. Its INVESTIGATE step (step 2) enumerates the sources to check as "the
actual code, tasks, briefs, ADRs, and protocol docs it references" — it does NOT
include the **pending questions** surface:

- the question/answer SIDECARS in `work/questions/<type>-<slug>.md` (the `advance`
  answer-loop artifacts, `src/sidecar.ts`); and
- an item's DECLARED-open state (`needsAnswers: true` + the in-body
  `## Open questions`).

So when triaging an observation, the loop never checks whether there is an
OUTSTANDING QUESTION about the same item/area. Concretely it can:

1. recommend **delete** a note whose concern is actually still UNRESOLVED because a
   question about it is sitting unanswered in `work/questions/` (it looks "handled"
   from code/tasks alone, but the open question says otherwise);
2. recommend **make-task** for residue that a pending question is already about to
   resolve a different way — duplicating or pre-empting the human's answer;
3. miss that the right disposition is "leave — blocked on question `q3` of
   `work/questions/task-foo.md`".

## Why it matters

The triage loop's WHOLE value is "investigate before judging — a note is a spotted,
often-stale signal, not ground truth." A pending question is exactly the kind of
CURRENT-REALITY signal that can flip a disposition (a concern that looks dead from
the code may be alive in an unanswered question, and vice-versa). Omitting it from
the investigation sources means the loop can confidently discharge a note whose
matter is genuinely still open — the precise failure mode the investigate-first
discipline exists to prevent.

There is a sibling skill `surface-questions` that GATHERS the open-judgement residue
for an item and EMITS questions (the inverse direction). The two are not wired
together: triage doesn't read what surface produced. So the answer-loop state is a
blind spot for triage.

## The idea (NOT decided here)

Add the pending-questions surface to the triage INVESTIGATE step: before
recommending a disposition for an observation, check whether an OPEN sidecar entry
(`work/questions/`) or a `needsAnswers`/`## Open questions` block touches the same
item or area, and let that inform the recommendation (often "leave — blocked on
<question>"). To weigh:

- **Matching is fuzzy.** A sidecar is identity-keyed to a SPECIFIC item
  (`task:`/`brief:`/`observation:`); an observation is free-form prose that may
  concern an item, an area, or neither. Exact-item matches are cheap (does a
  sidecar exist for the item this note is about?); topical overlap is judgement —
  surface it to the human rather than auto-deciding (consistent with the skill's
  "never auto-decide" rule).
- **An observation CAN itself have a sidecar** (`SidecarType` includes
  `observation`), so an observation under triage may have its OWN pending
  promote/keep/delete question — triage should notice that before recommending,
  not race it.
- Scope: this is a SKILL-doc change (the investigate checklist + maybe the
  disposition guidance), not a code change.

## Provenance / refs

- Skill: `~/.agents/skills/triage-observations/SKILL.md` (the loop's step 2
  investigate-sources list; the disposition table). Sibling: `surface-questions`.
- Sidecar surface: `src/sidecar.ts` (`work/questions/<type>-<slug>.md`,
  `SidecarType` includes `observation`); the gate family
  `observationTriage`/`surfaceBlockers` (ADR `ci-config-policy-and-gate-family`)
  governs CREATING these questions.
- Related: `work/notes/observations/question-sidecar-has-no-visible-link-to-the-item-it-asks-about-2026-06-20.md`
  (same answer-loop surface, different gap).

## Note on scope

Process/skill-quality signal, not a repo-code bug. Captured so the blind spot is on
record; a human decides whether to amend the skill (and whether the matching should
be exact-item-only or also topical).
