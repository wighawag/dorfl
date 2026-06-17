---
title: the advancing lock is a file-ORTHOGONAL presence-marker (work/advancing/<type>-<slug>.md), NOT a lifecycle move — so a backlog CLAIM does not check it and a bare human `claim` is not mutually-excluded with an advance tick (only another advance tick is). Worth revisiting whether this is the right shape.
date: 2026-06-16
status: open
slug: advancing-lock-orthogonal-not-a-move-revisit
needsAnswers: true
---

## What was observed

The `advancing` lock (`src/advancing-lock.ts`, PRD `advance-loop` slice `advancing-lock-borrow`) is NOT a lifecycle file move. Unlike the build CLAIM (which IS the `work/backlog/<slug>.md → work/in-progress/<slug>.md` move) and the SLICING lock (which IS the `work/prd/<slug>.md → work/slicing/<slug>.md` move), the advancing lock is a SEPARATE presence-marker file `work/advancing/<type>-<slug>.md`, created by a CAS micro-commit on acquire and deleted on release. The locked item's OWN lifecycle file never moves.

Consequences (verified against the code):
- The build CLAIM path (`claim-cas.ts` / `start.ts`) does NOT check the `work/advancing/` namespace at all. They are DIFFERENT CAS refs (`claim/<slug>` vs `advancing/<type>-<slug>`), serialising on `main`, not on each other's lock.
- So the advancing lock does NOT prevent a backlog claim of the same slug. It only mutually-excludes ANOTHER advance tick (the rung order is classify → take advancing borrow → do work → release; a CAS loser backs off). A bare human `agent-runner claim <slug>` run in parallel with an advance tick mid-borrow is NOT blocked by the advancing lock — it would race the advance's own claim on `main` (claim CAS), and one wins. The module's own docstring states this: "MANDATORY for the autonomous driver … a no-op formality for a solo human."

## Why it is shaped this way (the design rationale, for fairness)

The advance loop has rungs that operate on UN-CLAIMABLE items: a `prd/` PRD (to surface a question on it), an `observations/` note (to triage it), a needs-attention sidecar (to apply an answer). None of those can be `claim`ed (backlog→in-progress) and the SLICING lock is specific to `prd→slicing/`. So the surface/triage/apply rungs had NO existing lock to reuse. Rather than invent N folder-moves (one destination per item type) and MUTATE each item's lifecycle just to lock it, the design uses ONE identity-keyed (`<type>-<slug>`) presence-marker that locks a slice, a PRD, OR an observation with one uniform mechanism, leaving the item resting exactly where it was. It REUSES the existing CAS primitive (`ledgerWrite.applyTransition`) — a new lock NAMESPACE, not a new lock mechanism. The orthogonality is the point: a lock that must work across folders without changing status cannot be a folder move.

## Why it is worth revisiting (the doubt)

The user is not sure this is the right shape. The concerns:
- It is SURPRISING that "take the advancing lock" does not stop a backlog claim — a reader (reasonably) expects a lock on an item to make it un-takeable, the way claim/slicing locks do (they move the file out of the claimable folder). The advancing lock breaks that mental model: locked-but-still-in-backlog.
- The safety against a human-vs-driver race rests ENTIRELY on the claim CAS, not on the advancing lock. The advancing lock is only a mutex between advance TICKS. If a human claim and an advance build-claim of the same slug ever raced, the claim CAS serialises them (safe), but the advancing lock contributes nothing to that — so it is a partial lock (driver-vs-driver only), which is easy to misread as a full mutex.
- A leaked marker (a tick that died mid-borrow) leaves `work/advancing/<type>-<slug>.md` lying around; it is documented as removable, but it is extra ledger surface that can drift (observed: advancing markers folding into unrelated PR squash commits via the sibling-ledger reconcile — see the transient-infra observation).

## Suggested disposition (do not auto-act — needs a human design call)

- Option A (keep): document the "advancing lock is driver-vs-driver only; the claim CAS is the human-vs-driver backstop" semantics MORE loudly (in CONTEXT.md's glossary + the module), so the partial-mutex shape is not misread. Cheapest; changes nothing.
- Option B (unify): make the advancing lock ALSO a lifecycle move where the item IS claimable (a slice), so a locked slice leaves the backlog like a claim does — but keep the presence-marker form for un-claimable items (PRD/observation). This restores the "locked ⇒ un-takeable" mental model for slices but adds a second shape (a slice advances differently than a PRD), which may be worse, not better.
- Option C (subsume): question whether the advancing lock is needed at all for the BUILD rung — building already goes through the claim (the file move), so the advancing borrow around a build is arguably redundant; the borrow may only be load-bearing for the surface/triage/apply rungs on un-claimable items. If so, NARROW the advancing lock to ONLY those rungs and let build rely on the claim alone — fewer locks, clearer story.

Lean: investigate Option C first (is the advancing borrow doing anything for the build rung that the claim does not already do?). If it is purely redundant around build, narrowing it removes the surprising "locked but claimable" case for the common slice path and confines the orthogonal-marker shape to the genuinely un-claimable items where it is unavoidable.

## Provenance

Grilled this session against `src/advancing-lock.ts` (the module docstring is explicit about the orthogonal-marker design + the "no-op for a solo human" caveat) and `src/claim-cas.ts` / `src/start.ts` (confirmed they do NOT check `work/advancing/`). The user asked "I thought the advancing lock would move the file so no one can take it from backlog — or does the backlog claim look for the advancing lock too?" — answer: it does not move the file and claim does not check it; the advancing lock is a driver-vs-driver mutex only. The user is not (yet) a fan and asked to record it.
