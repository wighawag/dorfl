---
title: 'Self-contained promotion body + delete-on-promote (observation→task route)'
slug: promotion-self-contained-body-and-delete-on-promote-task-route
spec: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: []
covers: [1, 3, 8]
---

## What to build

Rework the observation→task promotion so that, when a human's ratified answer
promotes an observation, the spawned task is SELF-CONTAINED and the observation
is DELETED in the same atomic commit.

End-to-end behaviour:

- The minted task body is built FROM the observation's content — the mechanism +
  fix shape (not a back-pointer stub like today's "Promoted from observation …
  draft this into a buildable task").
- The observation's open-question scoping is COPIED into the spawned task's
  `## Open questions` block, and the task's `needsAnswers: true` is set when
  questions remain unresolved (cleared when none do). This is what makes the
  note safely deletable — no decision residue is lost.
- The observation file is `git rm`-ed in the SAME atomic commit as the
  CAS-create of the new task (promote = one commit). A crash must never leave
  the note deleted without its successor, nor the successor created with the
  note still live. A CAS LOSER (same-slug race) leaves the observation INTACT
  and unresolved for a retry — preserving today's loser-backs-off guarantee.

This is the keystone change the discharge model depends on (self-containment is
the precondition for deletion).

## Acceptance criteria

- [ ] A promoted observation's spawned task body contains the observation's
      mechanism + fix shape (assert it carries the real signal text, not a
      back-pointer phrase).
- [ ] The observation's open questions are transcribed into the task's
      `## Open questions` block; the task's `needsAnswers` reflects whether any
      remain.
- [ ] The observation file is deleted in the SAME commit as the task create
      (one atomic commit for promote).
- [ ] A same-slug CAS race: exactly one creator lands the task; the loser exits
      without resolving/deleting the observation (it stays for a retry).
- [ ] Tests cover the new behaviour, mirroring the throwaway-git-repo pattern
      already used by `triage-persist`/`apply-persist`.

## Blocked by

- None — can start immediately.

## Prompt

> Goal: make observation→task promotion self-contained and delete-on-promote,
> per the SPEC `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> and its origin observation
> `advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24`
> (Defects A + B; maintainer ruling: deletion-on-apply is correct because the
> apply rung is applying the human's RATIFIED answer, so the delete is
> human-authored).
>
> Where to look (by concept, not brittle paths): the observation-promote writer
> `promoteObservation` (in the triage-persist module) — today it mints a
> back-pointer stub via the new-item CAS-create helper, hardwired to the
> `tasks-ready` target, and does NOT delete the observation. You are changing
> WHAT it writes (self-contained body + transcribed open questions) and adding
> the note `git rm` INTO the winning creator's atomic commit. Keep the
> CAS-loser-backs-off semantics: a loser must not delete the observation.
>
> The "build the body from the observation" step: lift the observation's
> mechanism/fix prose and its `## Open questions` (the scoping) into the new
> task body so an agent could build from the task ALONE. Do not merely link back.
>
> Seams to test at: the promote function over a throwaway git repo (seed an
> observation + an answered sidecar; assert task body content, note deleted in
> the same commit, and the CAS-loser path leaves the note intact). Mirror the
> existing triage-persist/apply-persist tests.
>
> RECORD non-obvious in-scope decisions (e.g. exactly how the body is composed
> from the observation, how open-questions are matched/copied) in a `## Decisions`
> block on the done record or an ADR if they meet the ADR gate.
>
> Note: the `promote-spec` artifact-type branch and the drop/duplicate
> delete-on-discharge are SEPARATE tasks; scope this one to the TASK route only.
