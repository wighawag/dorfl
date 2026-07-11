---
title: Amend triage-observations skill to include the pending-questions surface
slug: amend-triage-observations-skill-to-include-pending-questions-surface
reason: superseded-by-done — the primary and highest-value deliverable (step 2 INVESTIGATE also reads the item's own `work/questions/<type>-<slug>.md` sidecar + `needsAnswers` / `## Open questions` state, with the exact-item-match-required vs topical-overlap-surface distinction) already landed in `skills/triage-observations/SKILL.md` via commit 115b65af. Verified on main 2026-07-11. The only unshipped fragment was the cosmetic "leave — blocked on <question>" disposition-guidance line; too thin to carry a whole task. Drop clean per the human's instruction; if that reasoning line ever proves needed it can re-surface as a fresh observation.
---

> **CANCELLED 2026-07-11 (ready-pool analysis).** Primary deliverable already landed (commit 115b65af); see `reason:` above.

## Context

The `triage-observations` skill drains `work/notes/observations/` one note at a time (READ → INVESTIGATE → RECOMMEND → WAIT → EXECUTE). Its INVESTIGATE step (step 2) enumerates current-reality sources as "the actual code, tasks, briefs, ADRs, and protocol docs it references" — it does NOT include the **pending-questions surface**:

- the question/answer SIDECARS in `work/questions/<type>-<slug>.md` (the `advance` answer-loop artifacts, `src/sidecar.ts`); and
- an item's DECLARED-open state (`needsAnswers: true` + the in-body `## Open questions` block).

That blind spot is a verified live failure mode: triage can confidently recommend `delete` / `make-task` on a note whose matter is actually still OPEN because a question about it is sitting unanswered in `work/questions/`, or race a pending answer. See the parent observation `observation:triage-observations-skill-ignores-pending-questions-2026-06-20` for the full failure-mode enumeration and the sibling-skill (`surface-questions`) context.

The human has ratified: **amend the skill** (option a). Low-risk doc change against a verified live blind spot. This task can be folded into the same E-task as the sibling `sidecar-rebuild-sweep` note if convenient, but is self-contained on its own.

## Scope

SKILL-doc change only. No code change. Edit `~/.agents/skills/triage-observations/SKILL.md` (the skill lives OUTSIDE this repo under `~/.agents/skills/`; the change is authored here as a diff/patch description and applied wherever the skill source of truth lives — confirm the canonical path before editing).

## What to change

### 1. Step 2 (INVESTIGATE) — extend the sources list

Add the pending-questions surface to the enumerated current-reality sources, alongside code/tasks/briefs/ADRs/protocol docs. Concretely, when investigating an observation, ALSO check:

- **Exact-item match (cheap, REQUIRED):** does a sidecar exist at `work/questions/<type>-<slug>.md` for an item the note is about? Does that item's frontmatter have `needsAnswers: true` and/or an in-body `## Open questions` block? An observation under triage may ITSELF have a sidecar (`SidecarType` includes `observation`) — check for its own pending promote/keep/delete question BEFORE recommending, so triage does not race the answer-loop.
- **Topical overlap (judgement, SURFACE don't decide):** if no exact-item match but an open sidecar/`## Open questions` block plausibly touches the same area/concern, surface that to the human as part of the recommendation rather than auto-deciding. This is consistent with the skill's existing "never auto-decide" rule.

### 2. Recommendation guidance — add a new reasoning note

In the disposition guidance, add a "**leave — blocked on `<question>`**" reasoning pattern: when an open sidecar entry or `needsAnswers`/`## Open questions` item touches the same matter, the right recommendation is usually `leave` with an explicit pointer to the blocking question (e.g. "leave — blocked on q3 of `work/questions/task-foo.md`"), NOT `delete` or `make-task`.

## Constraints / notes

- Exact-item matching is cheap and required; topical matching is judgement and must be surfaced, not auto-applied.
- Do not wire triage to MUTATE sidecars — it only READS them as a current-reality source.
- The observation body mentions a disposition-token framing (leave/delete/make-task/amend/fold-into-ADR); that vocabulary has since been retired/cut over. Use the CURRENT disposition vocabulary of the skill as it stands when editing — the investigate blind spot is independent of that vocabulary change and still real.
- Sibling skill `surface-questions` is the INVERSE direction (it EMITS questions from open-judgement residue). No change needed there; this task only teaches `triage-observations` to READ what surface produced.

## Acceptance

- `triage-observations` SKILL.md step 2 investigate-sources list explicitly names the pending-questions surface (sidecars in `work/questions/` + `needsAnswers` / `## Open questions` on the item), including the observation's OWN possible sidecar.
- The exact-item vs. topical distinction is stated, with topical overlap explicitly surfaced-to-human rather than auto-decided.
- The disposition/recommendation guidance includes the "leave — blocked on `<question>`" pattern with an example pointer.
- Repo acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check` (if the skill edit is in-repo; if the skill lives under `~/.agents/skills/` only, this task's deliverable is the edited SKILL.md and no repo gate applies — note which in the done-move).

## Refs

- Parent signal: `observation:triage-observations-skill-ignores-pending-questions-2026-06-20`
- Skill: `~/.agents/skills/triage-observations/SKILL.md` (step 2 investigate-sources; disposition table). Sibling: `surface-questions`.
- Sidecar surface: `src/sidecar.ts` (`work/questions/<type>-<slug>.md`, `SidecarType` includes `observation`); gate family `observationTriage`/`surfaceBlockers` (ADR `ci-config-policy-and-gate-family`) governs CREATING these questions.
- Related sibling observation: `work/notes/observations/question-sidecar-has-no-visible-link-to-the-item-it-asks-about-2026-06-20.md` (same answer-loop surface, different gap — MAY be folded into the same E-task).

## Prompt

> Build the task 'amend-triage-observations-skill-to-include-pending-questions-surface', described above.
