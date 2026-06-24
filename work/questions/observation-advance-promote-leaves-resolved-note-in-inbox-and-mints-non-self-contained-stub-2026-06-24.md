<!-- dorfl-sidecar: item=observation:advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24 type=observation slug=advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24 allAnswered=false -->

## Q1

**What becomes of this observation? The maintainer has already ruled on the core tension (deletion-on-apply is correct), and the body itself suggests the remaining fix is PRD-sized (vocabulary change for `promote-prd` + `promoteObservation` rework to be self-contained and branch on artifact type + intake-seam reuse + WORK-CONTRACT.md L65/L67 amendment + retiring `triaged:`/`## Recommended: delete` resting-state machinery across triage and apply). A single `promote-task` would understate the scope; `promote-adr` would capture only the protocol-clause clarification, not the engine rework; a hand-authored PRD with the note `dropped` is the explicit fallback the body names. Note: `promote-prd` is not currently in the disposition vocabulary (`sidecar.ts:84-90`) — that is itself one of the things this observation is asking for; until it exists, the in-loop choice reduces to `promote-task` (oversized) or `dropped` + hand-authored PRD in `prds/proposed/`.**

> Body §'Suggested fix shape' final bullet: 'This is likely PRD-sized itself (vocabulary change + promoteObservation rework + intake-seam reuse + protocol-doc edits + the delete-on-apply semantics across triage and apply) — consider promote-prd for THIS note once that route exists, or a PRD authored by hand meanwhile.' Maintainer ruling (2026-06-24) already in the body resolves the doctrinal conflict; what remains is execution, which spans code + protocol docs.

_Suggested default: dropped (with `reason: superseded by hand-authored PRD in prds/proposed/` recorded in the commit message), and hand-author the PRD covering all three defects A+B+C plus the WORK-CONTRACT.md L65/L67 amendment — because the in-loop `promote-prd` route this observation itself asks for does not yet exist, so promoting in-loop would force the wrong shape (`promote-task` for a multi-part initiative)._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

## Q2

**Protocol-edit follow-through: amend WORK-CONTRACT.md L65/L67 to state deletion-on-apply explicitly (the human's ratified promote/drop answer is what authorises the delete), so the 'never auto-delete a signal' clause is not misread as barring it — and retire the `triaged:`/`## Recommended: delete` resting-state machinery for notes. Confirm this doc edit + machinery retirement is in scope of whatever artifact is spawned, and that the SOURCE-OF-TRUTH copy at `skills/setup/protocol/WORK-CONTRACT.md` is edited (not just the propagated `work/protocol/` copy — see repo AGENTS.md).**

> Open question 1 in the note body, post-maintainer-ruling: 'The remaining doc work is to AMEND WORK-CONTRACT.md L65/L67 to state deletion-on-apply explicitly … so the "never auto-delete" clause is not misread as barring it. (Open only as: do the protocol edit, and retire the `triaged:`/`## Recommended: delete` resting-state machinery for notes.)' Repo AGENTS.md: edit `skills/setup/protocol/` and mirror to `work/protocol/`.

_Suggested default: Yes — include the L65/L67 amendment AND the resting-state-machinery retirement (triage-persist.ts marker headings, apply-persist.ts DELETE_HEADING, the `triaged:` frontmatter writes) as a scoped slice of the spawned artifact; edit the source-of-truth copy and mirror._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**(Defect B) Must `promoteObservation` produce a SELF-CONTAINED spawned artifact — copying the observation's mechanism + fix shape + any answered scoping into the task/PRD body — rather than the current back-pointer stub at `triage-persist.ts:294`/`:309`? Is the self-containment asserted/verified by the engine (a structural check) before the note is deleted, or only by reviewer judgement?**

> Open question 2 in the note body. WORK-CONTRACT.md L65 operational discharge test: 'a note is dischargeable (deletable) the moment a self-contained artifact carries its signal — verify the spawned task/ADR actually contains the mechanism + fix shape (not just a back-pointer), then delete.' Today's stub body is quoted verbatim under Defect B.

_Suggested default: Yes — self-containment is required before delete. Engine asserts it structurally (e.g. minted body must contain a non-trivial 'What to build' / PRD sections AND must not consist solely of a back-pointer line); the same atomic commit performs draft + `git rm` of the note._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

## Q4

**(Defect C) Should the disposition vocabulary GAIN `promote-prd` (and `promoteObservation` BRANCH on artifact type, routing through the shared placement resolver `intake` uses — `intake.ts:371-372`, `:1249-1304`)? If yes: reuse intake's `emitPrd`/placement seam directly, or a triage-local analogue that calls into the same resolver? Who judges 'too big for a task' — the human via the `promote-prd` answer the surface offers, or an automated heuristic?**

> Open question 3 in the note body. Asymmetry with `intake`, which decides artifact type at runtime; `promoteObservation` is hardwired to `workItemRel('tasks-ready', ...)` at `triage-persist.ts:309`. Disposition vocabulary at `sidecar.ts:84-90`, `:243-250`.

_Suggested default: Yes — add `promote-prd` to the disposition vocabulary; reuse intake's `emitPrd`/placement seam (single source of truth for PRD placement); the human is the judge, via the `promote-prd` disposition the surface offers (no heuristic)._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

## Q5

**(Dropped vs promote symmetry) Does the `dropped`/`duplicate` path need the same self-containment guarantee as `promote`, or is it sufficient to `git rm` the note and record the `reason:` in the commit message (since nothing downstream carries the signal and it has been judged moot)? Should the commit-message format for the drop be specified (e.g. `reason: <out-of-scope|superseded by <x>|duplicate|abandoned>`)?**

> Open question 4 in the note body: 'A `dropped` note has nothing downstream carrying it, so deleting it loses nothing but the body's recorded reason — which the commit message can hold.' Today: `applyAnsweredQuestions` appends `## Recommended: delete` instead of `git rm` (`apply-persist.ts:538-565`, `:689` DELETE_HEADING).

_Suggested default: `dropped`/`duplicate` `git rm`s the note in the apply atomic commit; the commit message MUST include a structured `reason:` line drawn from the body's `reason:` field (the same four-value vocabulary the SURFACE-PROTOCOL §emitted-question-shape names: `out-of-scope` / `superseded by <x>` / `duplicate` / `abandoned`)._

<!-- q5 fields: id=q5 -->

**Your answer** (write below this line):
