---
title: advance apply/triage does not discharge an answered observation by deletion (leaves a "resolved" note in the inbox), mints a non-self-contained back-pointer stub, and has NO observation→PRD route (asymmetric with intake) — maintainer ruled deletion-on-apply is correct
type: observation
status: spotted
spotted: 2026-06-24
needsAnswers: false
triaged: keep
---

## What was seen

After ratifying a batch of answered question sidecars (commit `39bed83`), the
`advance` apply/triage rung ran on origin/main (latest tip `4f02ce5`,
2026-06-24) and discharged the answered observations. Two resting states it
produced look wrong against `work/protocol/WORK-CONTRACT.md`:

### Defect A — a `promote-task` (and a `dropped`/`delete`) observation is left RESTING in the inbox in a "resolved" state

For every promoted observation, the file STAYS in `work/notes/observations/`
with frontmatter stamped `needsAnswers: false` + `triaged: keep` (promote/map)
or a `## Recommended: delete` body marker + `triaged: duplicate` (dropped/
duplicate). Concrete, verified on origin/main `4f02ce5`:

- `observation:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21`
  — frontmatter now `needsAnswers: false`, `triaged: keep`; file still in inbox;
  a task was minted at `work/tasks/ready/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`.
- `observation:adr-methodology-still-cites-slicing-protocol-doc-filename-2026-06-23`
  — `needsAnswers: false`, body carries `disposition: dropped` + `## Recommended: delete`; file still in inbox.
- The inbox count did not fall after discharge: `git ls-tree -r --name-only origin/main work/notes/observations/ | wc -l` = 78.

This is the exact resting state WORK-CONTRACT.md calls a contradiction:

- L67: "a note annotated 'resolved' and kept is a contradiction (there is no
  `resolved` status; discharge it by deleting it, its lasting product being the
  task/ADR/commit it spawned)."
- L65: capture-bucket notes "leave only by **deletion** (git history is the
  archive). A note ... does not 'become' or `git mv` into that work; it is
  simply **deleted** once it is no longer a useful signal."
- L59 / L74 / `work-layout.ts:58`: "A dropped OBSERVATION needs no terminal —
  notes leave by deletion."

### Defect B — the minted promote-task is a NON-SELF-CONTAINED back-pointer stub

The task `promoteObservation` mints (`triage-persist.ts:294`, drafting
`work/tasks/ready/<slug>.md`) carries only a pointer, not the signal. Verified
body of the minted task:

> "## What to build
> Promoted from observation `observation:advance-leg-on-stale-snapshot-...`. A
> human answered "promote": draft this into a buildable task. Carries
> `needsAnswers:true` so the advance loop surfaces the open scoping questions
> before it is built."

All the actual mechanism + fix shape (the `src/claim-cas.ts:270`/`:332`
analysis, the `--quiet-if-gone` flag direction, the new-tolerated-exit-code
design) lives in the OBSERVATION body, not the task. Per the contract's
operational discharge test (L65): "a note is dischargeable (deletable) the
moment a **self-contained** artifact carries its signal — verify the spawned
task/ADR actually contains the mechanism + fix shape (not just a back-pointer),
then delete the note. ... If the spawned artifact is NOT self-contained, the bug
is the artifact (fix it to carry the signal), not a reason to keep the note."

So B is the ROOT of A: the engine cannot delete the note (it would lose the
signal) precisely because the stub it minted is a back-pointer. The two defects
are linked — the promote path produces a stub that DEPENDS on the note it is
meant to discharge.

## Why this matters

- The inbox never drains: every promoted/dropped observation accumulates as a
  `triaged:`-stamped "resolved" note. `ls work/notes/observations/` stops being
  the live-signal list the contract says it is (L65: "the folder is the inbox").
- It silently relies on an unscheduled human janitorial `git rm` pass that the
  contract does not describe as a separate step — and that a human cannot safely
  do for the promote case anyway, because the signal only lives in the note.

## The tension — RESOLVED by the maintainer (2026-06-24)

The apply/triage code is DELIBERATE and cites a real contract clause — the
opposite pull:

- `triage-persist.ts:33`, `:53-55`, `:167-168`; `apply-persist.ts:195`,
  `:540`; `triage-gate.ts:23-25`; `config.ts:74`: "the agent NEVER auto-deletes
  a signal; a human deletes the file." The `## Recommended: delete` marker is
  the designed hand-off.

WORK-CONTRACT.md thus carried two clauses that, for a DISCHARGED note, pointed
in opposite directions: (1) "never auto-delete a signal" (obeyed by the code →
recommend + keep), vs (2) "no resolved-and-kept note; discharge by deletion" +
"make the spawned artifact self-contained THEN delete" (L65/L67).

**Maintainer ruling (2026-06-24):** an answered observation MUST leave the
inbox by DELETION once discharged — `dropped` (deleted as moot) or `promote`
(converted). There is NO `triaged:`/`needsAnswers:false` resting state for a
note. Clause (1) — "never auto-delete a signal; a human deletes" — is SATISFIED
by deletion-on-apply, because the apply rung is APPLYING THE HUMAN'S RATIFIED
ANSWER: the deletion is human-AUTHORED (the human said promote/drop), not the
agent unilaterally destroying a live signal. So the two clauses do NOT actually
conflict; deletion-on-apply is the correct discharge, and (1) only ever barred
the agent from deleting a note the human had NOT dispositioned.

The self-containment requirement (B) stands independently: on `promote`, the
spawned task/prd must carry ALL the detail BEFORE the note is deleted (else the
signal is lost on delete).

## Defect C — there is NO observation → PRD route (asymmetric with `intake`)

WHAT IF an observation is too big for a task and should be a PRD (a multi-task
initiative needing a spec + user-story fan-out)? The current apply/triage path
cannot route it:

- The disposition vocabulary is `promote-task | promote-adr | keep | delete |
  dropped | needs-attention` (`sidecar.ts:84-90`, `:243-250`) — there is NO
  `promote-prd` (or `promote-brief`).
- `promoteObservation` is HARDWIRED to one destination:
  `const newItemPath = workItemRel('tasks-ready', ...)` (`triage-persist.ts:309`).
  It always mints a task; it cannot write `prds/proposed/<slug>.md`.
- `grep` over `work/protocol/` finds NO observation→prd mention, so this is an
  unhandled gap, not a deliberate "observations are task-sized only" cap.

This is asymmetric with `intake`, which DECIDES the artifact TYPE at runtime —
a `task` verdict writes `tasks/backlog`, a `prd` verdict writes
`work/prds/<proposed|ready>/<slug>.md` through the SHARED placement resolver
(`intake.ts:371-372`, `:1249-1304`, outcome `prd-written`). The issue front
door can produce a PRD; the observation front door cannot.

Consequence today: a PRD-sized observation must be (a) crammed into one
oversized `promote-task` (wrong shape), (b) reduced to `promote-adr` (captures
the decision, not the initiative), or (c) hand-authored as a PRD in
`prds/proposed/` with the observation `dropped` MANUALLY — outside the loop,
the exact seam intake was built to own.

Note: Defect C is the SAME family as the self-containment fix (B). If
`promoteObservation` is reworked to copy the full signal into the spawned
artifact, that is the natural place to also BRANCH on artifact type (task vs
prd), mirroring how `intake` keys placement + integration on the runtime type.

## Open questions to NOT guess

1. Confirmed by the ruling above: the apply/triage rung SHOULD delete a
   discharged note in the same atomic commit (reason in the commit message; git
   history = archive). The remaining doc work is to AMEND WORK-CONTRACT.md L65/
   L67 to state deletion-on-apply explicitly (the human's ratified answer is
   what authorises it), so the "never auto-delete" clause is not misread as
   barring it. (Open only as: do the protocol edit, and retire the
   `triaged:`/`## Recommended: delete` resting-state machinery for notes.)
2. (B) Must `promoteObservation` make the minted task SELF-CONTAINED — copy the
   observation's mechanism + fix shape (and any answered scoping) into the task
   body — rather than emitting a back-pointer stub? (Required either way before
   any deletion is safe.)
3. (C) Should the disposition vocabulary GAIN `promote-prd` (and route through
   the shared placement resolver like `intake` does), so a PRD-sized observation
   can be converted in-loop? If yes: does it reuse intake's prd-emit seam
   (`emitPrd`/placement) or a triage-local analogue? What is the threshold /
   who judges "too big for a task" (the human answering the triage question, via
   a `promote-prd` disposition the surface offers)?
4. Does the `dropped`/`duplicate` path (no spawned artifact; signal judged moot)
   differ from `promote` (signal moved into a task/prd)? A `dropped` note has
   nothing downstream carrying it, so deleting it loses nothing but the body's
   recorded reason — which the commit message can hold.

## Suggested fix shape (per the maintainer ruling: deletion-on-apply is correct)

- `promoteObservation` (`triage-persist.ts:294`): draft the new artifact body
  from the observation's content (mechanism + fix + answered scoping), assert
  self-containment (B), THEN `git rm` the observation in the SAME atomic commit
  (the human's promote answer authorises the delete).
- BRANCH on artifact type (C): on a `promote-prd` disposition, mint
  `prds/proposed/<slug>.md` through the shared placement resolver (reuse
  intake's prd-emit seam) instead of the hardwired `tasks-ready` task.
- `applyAnsweredQuestions` (`apply-persist.ts`, the `dropped`/`delete` route):
  `git rm` the note instead of appending `## Recommended: delete`, recording the
  `reason:` in the commit message.
- Retire the `triaged:`/`## Recommended: delete` resting-state machinery for
  notes, AND amend WORK-CONTRACT.md L65/L67 to state deletion-on-apply
  explicitly (so the "never auto-delete" clause is not misread as barring it).
- This is likely PRD-sized itself (vocabulary change + promoteObservation
  rework + intake-seam reuse + protocol-doc edits + the delete-on-apply
  semantics across triage and apply) — consider `promote-prd` for THIS note
  once that route exists, or a PRD authored by hand meanwhile.

Refs: `packages/dorfl/src/triage-persist.ts:294` (`promoteObservation`),
`:176` (`autoDispositionObservation`), `:63-65` (marker headings);
`packages/dorfl/src/apply-persist.ts:538-565`, `:689` (`DELETE_HEADING`);
`work/protocol/WORK-CONTRACT.md` L59/L65/L67/L74; `packages/dorfl/src/work-layout.ts:58`.
Evidence tip: origin/main `4f02ce5` (2026-06-24).

## Applied answers 2026-06-24

### q1: What becomes of this observation? The maintainer has already ruled on the core tension (deletion-on-apply is correct), and the body itself suggests the remaining fix is PRD-sized (vocabulary change for `promote-prd` + `promoteObservation` rework to be self-contained and branch on artifact type + intake-seam reuse + WORK-CONTRACT.md L65/L67 amendment + retiring `triaged:`/`## Recommended: delete` resting-state machinery across triage and apply). A single `promote-task` would understate the scope; `promote-adr` would capture only the protocol-clause clarification, not the engine rework; a hand-authored PRD with the note `dropped` is the explicit fallback the body names. Note: `promote-prd` is not currently in the disposition vocabulary (`sidecar.ts:84-90`) — that is itself one of the things this observation is asking for; until it exists, the in-loop choice reduces to `promote-task` (oversized) or `dropped` + hand-authored PRD in `prds/proposed/`.

dropped. reason: superseded by the now-merged PRD observation-discharge-by-deletion-self-contained-promotion-and-prd-route (in prds/tasked/) and its 5 tasks (PRs #231-#235), which carry all of this note's signal end to end. The in-loop promote-prd route this note asked for now exists, so the note's purpose is fully discharged; drop it.

disposition: dropped

### q2: Protocol-edit follow-through: amend WORK-CONTRACT.md L65/L67 to state deletion-on-apply explicitly (the human's ratified promote/drop answer is what authorises the delete), so the 'never auto-delete a signal' clause is not misread as barring it — and retire the `triaged:`/`## Recommended: delete` resting-state machinery for notes. Confirm this doc edit + machinery retirement is in scope of whatever artifact is spawned, and that the SOURCE-OF-TRUTH copy at `skills/setup/protocol/WORK-CONTRACT.md` is edited (not just the propagated `work/protocol/` copy — see repo AGENTS.md).

Done. WORK-CONTRACT.md was amended (task work-contract-sanction-deletion-on-apply-discharge, PR #233) stating deletion-on-apply is human-authored and not barred by the never-auto-delete clause; the SOURCE skills/setup/protocol/ copy was edited and the work/protocol/ mirror kept byte-identical. The triaged:/## Recommended: delete resting-state machinery for notes was retired (task delete-on-discharge-for-dropped-and-duplicate-routes, PR #232).

### q3: (Defect B) Must `promoteObservation` produce a SELF-CONTAINED spawned artifact — copying the observation's mechanism + fix shape + any answered scoping into the task/PRD body — rather than the current back-pointer stub at `triage-persist.ts:294`/`:309`? Is the self-containment asserted/verified by the engine (a structural check) before the note is deleted, or only by reviewer judgement?

Yes, and done. promoteObservation now builds a self-contained body (buildPromotedBody lifts the observation's mechanism + transcribes its ## Open questions; needsAnswers reflects them) and git rm's the note+sidecar in the SAME atomic commit as the create (keystone task promotion-self-contained-body-and-delete-on-promote-task-route, PR #231). Self-containment is the precondition for the same-commit deletion.

### q4: (Defect C) Should the disposition vocabulary GAIN `promote-prd` (and `promoteObservation` BRANCH on artifact type, routing through the shared placement resolver `intake` uses — `intake.ts:371-372`, `:1249-1304`)? If yes: reuse intake's `emitPrd`/placement seam directly, or a triage-local analogue that calls into the same resolver? Who judges 'too big for a task' — the human via the `promote-prd` answer the surface offers, or an automated heuristic?

Yes, and done. promote-prd was added to the disposition vocabulary and promoteObservation branches on artifact type (task -> tasks-ready, prd -> prds-proposed) via the SAME triage-local createItemThroughCas writer (NOT intake's branch+integrate band), per the maintainer's Resolved decision 1 (tasks promote-prd-disposition-and-triage-local-cas-prd-writer #234 + surface-promote-prd-as-human-only-disposition #235). The human is the judge via the promote-prd disposition offered at the surface; the auto gate never picks it.

### q5: (Dropped vs promote symmetry) Does the `dropped`/`duplicate` path need the same self-containment guarantee as `promote`, or is it sufficient to `git rm` the note and record the `reason:` in the commit message (since nothing downstream carries the signal and it has been judged moot)? Should the commit-message format for the drop be specified (e.g. `reason: <out-of-scope|superseded by <x>|duplicate|abandoned>`)?

Git rm in the apply atomic commit with the reason in the commit message is sufficient (a dropped note has nothing downstream carrying it). Implemented: the dropped/delete/duplicate routes now git rm the note in a standalone commit with the reason recorded in the message (task delete-on-discharge-for-dropped-and-duplicate-routes, PR #232).

## Recommended: delete

A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.

## Triaged: maps onto an existing item

This observation maps UNAMBIGUOUSLY onto `prd:observation-discharge-by-deletion-self-contained-promotion-and-prd-route` (already
covered there), so it is settled — marked triaged:keep and dropped out
of the candidate pool (never re-asked).

Reason: The observation's own applied answers (2026-06-24) explicitly state it is superseded by the now-merged PRD `observation-discharge-by-deletion-self-contained-promotion-and-prd-route` (in work/prds/tasked/) and its 5 tasks (PRs #231–#235), which carry all of this note's signal — Defects A, B, C and the WORK-CONTRACT.md L65/L67 amendment — end to end. Disposition is recorded as `dropped` with a `## Recommended: delete` marker. Unambiguous map onto the existing PRD.
