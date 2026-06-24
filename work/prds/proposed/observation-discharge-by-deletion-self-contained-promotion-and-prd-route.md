---
title: Discharge answered observations by deletion, with self-contained promotion and an observation→PRD route
slug: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

When a human answers an observation's triage/question sidecar, the `advance` apply/triage rung discharges it WRONGLY in three ways (verified on origin/main `4f02ce5`, 2026-06-24; full evidence in `work/notes/observations/advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24.md`):

- **A — no discharge by deletion.** A discharged observation is left RESTING in `work/notes/observations/` stamped `needsAnswers: false` + `triaged: keep`/`duplicate` (and, for drop, a `## Recommended: delete` body marker). This is the exact "resolved note kept in the inbox" state `WORK-CONTRACT.md` L65/L67 calls a contradiction ("there is no `resolved` status; discharge it by deleting it"). The inbox never drains — `ls work/notes/observations/` stops being the live-signal list the contract promises.

- **B — non-self-contained promotion.** `promoteObservation` (`triage-persist.ts`) mints a task whose body is a BACK-POINTER stub ("Promoted from observation … draft this into a buildable task"), not the mechanism + fix shape. All real detail stays in the observation, so the note CANNOT be safely deleted (the signal would be lost) — which is why the engine keeps it. The promote path produces a stub that depends on the note it is meant to replace.

- **C — no observation→PRD route.** The disposition vocabulary is `promote-task | promote-adr | keep | delete | dropped | needs-attention` — there is NO `promote-prd`, and `promoteObservation` is hardwired to `tasks-ready`. So a PRD-sized observation (a multi-task initiative needing a spec) cannot be converted in-loop. This is asymmetric with `intake`, which DOES decide task-vs-PRD at runtime and writes `prds/<proposed|ready>/` through the shared placement resolver.

The maintainer has RULED (2026-06-24) that an answered observation must leave the inbox by DELETION once discharged (dropped or promoted), and that the "never auto-delete a signal" clause is SATISFIED because the apply rung applies the human's RATIFIED answer — the deletion is human-authored, not a unilateral agent destruction of a live signal.

## Solution

From the operator's perspective: when I answer an observation's question (promote or drop), the `advance` loop discharges it CLEANLY — the note leaves the inbox by deletion, and what it spawned (a task, a PRD, or nothing) fully carries its signal. The inbox returns to being an accurate live-signal list. And when a signal is genuinely PRD-sized, I can answer `promote-prd` and get a real spec in `prds/proposed/` instead of being forced to cram it into a task or hand-author a PRD outside the loop.

## User Stories

1. As an operator answering a `promote` triage question, I want the spawned task to contain the observation's full mechanism + fix shape (not a back-pointer), so the observation can be safely deleted and the task is buildable on its own.
2. As an operator answering a `dropped`/`delete` triage question, I want the observation `git rm`-ed in the same discharge (reason recorded in the commit message; git history = archive), so no "resolved" note lingers in the inbox.
3. As an operator, I want the promote path to copy the observation's open-question scoping into the spawned artifact's `## Open questions` block (and set `needsAnswers: true`), so deleting the note loses no decision residue.
4. As an operator with a PRD-sized signal, I want a `promote-prd` disposition that mints `prds/proposed/<slug>.md`, so a multi-task initiative is converted into a spec in-loop rather than a single oversized task.
5. As an operator, I want the task-vs-PRD sizing choice to be MY judgement (offered as `promote-task` vs `promote-prd` at the surface), never an `observationTriage: auto` auto-pick, so an initiative is never silently mis-shaped by the engine.
6. As a contributor reading `WORK-CONTRACT.md`, I want L65/L67 amended to state deletion-on-apply explicitly (the human's ratified answer authorises it), so the "never auto-delete a signal" clause is not misread as barring it.
7. As an operator, I want the `triaged:` / `## Recommended: delete` resting-state machinery for NOTES retired (it was the workaround for not deleting), so there is one discharge path: deletion.
8. As an operator, I want the discharge (new-artifact create + note delete) to be ATOMIC for promote (one commit) so a crash never leaves the note deleted without its successor, or the successor created with the note still live.
9. As an operator, I want the per-item lock / CAS guarantees that protect task promotion today to equally protect PRD promotion, so concurrent CI legs cannot double-mint or strand a lock.

### Autonomy notes (the two gate axes)

- **`humanOnly` (DECIDED):** OMITTED — this PRD's tasking does not require a human to drive it; the four launch questions are answered (see Resolved decisions below), so the work is straightforwardly agent-taskable.
- **`needsAnswers` (DISCOVERED):** OMITTED — the four launch questions are RESOLVED (2026-06-24). The PRD launches fully tasking-ready.

## Resolved decisions (2026-06-24)

The four launch questions were answered by the maintainer:

1. **observation→PRD route = triage-local CAS analogue, NOT intake's prd-emit band.** `promote-prd` mints `prds/proposed/<slug>.md` through the SAME `createItemThroughCas` helper `promoteObservation` already uses for tasks (one local commit through the CAS), just targeting `prds-proposed` instead of `tasks-ready`. Rationale: it stays inside the advance loop's existing create/integrate machinery (no `switchToWorkBranch`/`performIntegration` branch+PR band dragged in from intake, which is a standalone front door); it preserves the CAS-loser-backs-off-leaving-the-note-intact guarantee uniformly across task and prd promotion; and a promoted PRD always lands in `proposed/` (staging) — the conservative default a human later promotes to `ready/`. The placement-resolver staged-vs-ready nuance is intake's concern (origin-trust etc.) and is NOT needed here. Sharing the prd-body RENDERING with intake may be extracted later, but the WRITER is the CAS one.
2. **Task-vs-PRD sizing = HUMAN judgement only; `observationTriage: auto` NEVER picks PRD.** `promote-prd` is offered at the surface alongside `promote-task` and chosen by the human answering the triage question. The `auto` gate already never auto-promotes (it only auto-disposes `duplicate`/`map`); that stays unchanged. We only add `promote-prd` to the set of dispositions a human may pick.
3. **Promotion MUST be self-contained, including the scoping (mandatory, not optional).** On promote, the spawned artifact's body carries the observation's mechanism + fix shape AND its open questions copied into the artifact's `## Open questions` block, with `needsAnswers: true` set when questions remain. This is the precondition for safe deletion (else the residue is lost on delete), not a nice-to-have.
4. **Two deletion-commit shapes, confirmed.** `promote` → the note `git rm` rides in the SAME atomic commit as the new artifact's CAS-create (a crash never leaves the note deleted without its successor, or vice versa; a CAS loser leaves the note intact for retry). `dropped`/`duplicate` → no spawned artifact, so the delete is a STANDALONE commit with the `reason:` in the commit message (git history = archive). A spawned artifact is NOT required for every deletion.

## Implementation Decisions

Decisions seeded at launch (to be confirmed/trimmed at tasking-time):

- **Vocabulary.** Add `promote-prd` to `SidecarDisposition` (`sidecar.ts`) and its parse set. (Open whether `promote-brief` is also needed — defer unless the brief regime requires a distinct route; this PRD scopes `promote-prd`.)
- **Promotion writer.** Rework `promoteObservation` (`triage-persist.ts`) to (i) build the spawned artifact's body FROM the observation's content (mechanism + fix + answered scoping → self-contained), (ii) BRANCH on the disposition's artifact type (task → `tasks-ready`; prd → `prds-proposed`) using the SAME `createItemThroughCas` writer for both (NOT intake's branch+integrate band), and (iii) `git rm` the observation in the SAME atomic commit as the create.
- **Drop/delete writer.** In the `dropped`/`delete` route (`apply-persist.ts`), `git rm` the note (reason → commit message) INSTEAD of appending `## Recommended: delete` + stamping `triaged:`.
- **Atomicity + CAS.** Reuse the `createItemThroughCas` guarantee that protects task promotion; the note-delete must be in the winning creator's commit so a CAS loser leaves the note intact for a retry (mirrors today's loser-backs-off behaviour).
- **Protocol docs.** Amend `WORK-CONTRACT.md` L65/L67 (SOURCE `skills/setup/protocol/` + byte-identical `work/protocol/` mirror per AGENTS.md) to sanction deletion-on-apply and retire the resting-state machinery description.
- **Auto gate.** `observationTriage: auto` MUST NOT auto-pick `promote-prd` (nor auto-promote at all — unchanged); `promote-prd` is a human answer only.

## Testing Decisions

- A promote (task) test: seed an observation with an answered sidecar, run the promote, assert the spawned task body CONTAINS the observation's mechanism text (self-containment) AND the observation file is gone (deleted) in the same commit.
- A `promote-prd` test: same shape, asserting a `prds/proposed/<slug>.md` is created (through the SAME `createItemThroughCas` writer as the task path) and the note is deleted.
- A `dropped` test: assert the note is `git rm`-ed with the reason in the commit message and NO `triaged:`/`## Recommended: delete` residue remains.
- A CAS-loser test: a same-slug create race leaves the observation INTACT (unresolved) for a retry.
- Prior art: the throwaway-git-repo test pattern already used by `triage-persist`/`apply-persist`; the existing observation→task CAS-create tests (the `promote-prd` test is the same shape with a `prds-proposed` target).

## Out of Scope

- Changing how observations are CAPTURED or SURFACED (the question-sidecar format, `surface-questions`/`answer-questions`) — this PRD only changes DISCHARGE (apply/triage promotion + deletion).
- `promote-brief` (the brief regime) unless an open-question answer pulls it in.
- Retroactively cleaning the ~78 already-stranded `triaged:`-stamped observations now resting in the inbox — a one-off janitorial sweep, trackable separately once the discharge path is fixed (so the sweep does not re-litter).
- Any change to `intake` itself (it already does task-vs-PRD correctly; per Resolved decision 1 this PRD does NOT reuse intake's prd-emit band — it uses the triage-local CAS writer — and does not modify intake).

## Further Notes

- Origin: `work/notes/observations/advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24.md` (Defects A/B/C + the maintainer ruling + file:line evidence). That observation should be discharged (deleted) when this PRD lands carrying its signal — which is itself an instance of the very behaviour this PRD fixes.
- The three defects are one family: B (self-containment) is the prerequisite for A (delete-on-discharge), and C (PRD route) folds into the same `promoteObservation` rework as B (branch on artifact type at the same point self-containment is built).
