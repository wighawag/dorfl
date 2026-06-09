---
title: advance — the `work/advancing/` CAS lock BORROW (one primitive, action=folder, identity=entry), type-encoded, never colliding with slicing/build
slug: advancing-lock-borrow
prd: advance-loop
blockedBy: []
covers: [19, 20, 21, 22, 24]
---

## What to build

A NEW action-folder lock-BORROW, `work/advancing/`, for the surface/apply/triage
phase — a SHORT borrow shaped like `slicing/` (NOT the long-held `in-progress/`
build claim), using the EXISTING CAS ledger-write primitive (no new lock
semantics). The lock-FOLDER encodes the ACTION (`advancing`); the entry name
(`<type>-<slug>`) encodes the IDENTITY (the same type-encoded scheme the sidecar
uses), so a slice, a PRD, and an observation sharing a slug never collide on the
CAS ref — and a PRD may hold an `advancing` borrow and LATER a `slicing` borrow
(different actions, different refs, never co-held).

This slice delivers acquire/release for the `advancing` borrow + the new-item
creation CAS + tests. It is file-orthogonal to the tick classifier (different
module), so it can be built in parallel with `advance-tick-classifier`. It does
NOT wire the rungs to the lock (that is the rung slices).

### Precise scope

- A `acquireAdvancingLock` / `releaseAdvancingLock` pair MIRRORING
  `slicing-lock.ts` (`acquireSlicingLock`/`releaseSlicingLock`) — same CAS
  micro-commit / force-with-lease on a DISTINCT branch ref/folder for namespace
  hygiene, same winner/loser/exit-code shape. The borrow is SHORT (acquire →
  surface/apply/triage → release), not one-way like the build claim.
- Entries are **type-encoded** (`<type>-<slug>`) — the SAME identity scheme as the
  sidecar (derived via the existing resolver). Assert an advancing-borrow vs a
  slicing-borrow vs a build-claim on the SAME slug do NOT collide (distinct refs).
- **`needsAnswers` is the PURE answer-required axis, NOT a lock** (US #21): the
  human edit-handshake becomes "take the `advancing` lock via CAS", so a human and
  the autonomous driver contend honestly on the SAME lock (supersede the old "flip
  `needsAnswers` to claim an edit-lock" framing — see `Supersedes` below).
- **New-item creation routed THROUGH the CAS** (US #24): observation→promote
  drafting a new `work/backlog/<new-slug>.md` is CAS-keyed on the NEW item's
  identity, so the (unlikely) same-slug new-item race needs NO special case (loser
  fails the CAS and backs off). Deliver this acquire-keyed-on-new-identity here as
  a reusable helper (the triage rung consumes it).
- **Lock discipline:** MANDATORY for the autonomous driver, a no-op formality for
  a solo human (no contender). The per-repo "agents may advance here" policy is the
  signal that a contender may be active — so the common solo case stays simple.

## Acceptance criteria

- [ ] `acquireAdvancingLock`/`releaseAdvancingLock` use the existing CAS
      ledger-write primitive (NO new lock semantics) on a DISTINCT `advancing` ref,
      mirroring `slicing-lock.ts`'s acquire/release shape and exit codes.
- [ ] Lock entries are type-encoded (`<type>-<slug>`) via the existing resolver;
      an advancing-borrow vs slicing-borrow vs build-claim on the SAME slug do NOT
      collide (distinct refs) — proven by test.
- [ ] Two concurrent ticks on the SAME `<type>-<slug>` advancing-ref → exactly one
      winner; the loser exit-2 backs off (reuse the existing CAS-seam test harness).
- [ ] New-item creation goes through the CAS keyed on the NEW item's identity; a
      same-slug new-item race → loser fails the CAS (no special case).
- [ ] A PRD can hold `advancing` then later `slicing` (never co-held) without
      collision.
- [ ] The borrow is SHORT (acquire → release), not a one-way claim; release
      returns the item without a status-folder move (the borrow is a lock, not a
      lifecycle transition) — verified.
- [ ] Tests reuse the throwaway-git-repo + `--bare` arbiter CAS-seam harness; no
      shared/global location is touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — file-orthogonal to the tick classifier; build in parallel with
  `advance-tick-classifier`.

## Supersedes / connects

- Supersedes the `needsAnswers`-as-edit-lock framing in
  `work/ideas/folder-taxonomy-and-prd-edit-handshake.md` (the edit-handshake moves
  to the `advancing` lock via CAS). Leave that idea pointing here (do NOT rewrite
  it in this slice beyond a pointer note if the contract requires it; capture as an
  observation if uncertain).

## Prompt

> Build the `work/advancing/` CAS lock BORROW — a SHORT borrow shaped like
> `slicing/`, using the EXISTING CAS ledger-write primitive (no new lock semantics).
> Read the PRD `advance-loop` (in `work/prd-sliced/advance-loop.md` or
> `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("The lock model", "Classify → lock →
> execute, and new-item creation", US #19–24). The lock-FOLDER encodes the ACTION
> (`advancing`); the entry name `<type>-<slug>` encodes IDENTITY (same type-encoded
> scheme as the sidecar, via the resolver). It is file-orthogonal to the tick
> classifier — build in parallel.
>
> Mirror `packages/agent-runner/src/slicing-lock.ts`
> (`acquireSlicingLock`/`releaseSlicingLock` — the CAS micro-commit / force-with-lease
> on a distinct branch ref, the winner/loser/exit-code shape) on a DISTINCT
> `advancing` ref so an advancing-borrow NEVER collides with a slicing-borrow or a
> build-claim on the same slug. Deliver new-item-creation-through-CAS (keyed on the
> NEW item's identity) as a reusable helper for the later triage rung. `needsAnswers`
> is the PURE answer-required axis (NOT a lock); the human edit-handshake becomes
> taking the `advancing` lock via CAS (supersedes
> `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`). Lock discipline: MANDATORY
> for the autonomous driver, no-op for a solo human.
>
> READ FIRST: `packages/agent-runner/src/slicing-lock.ts` (the borrow to mirror),
> `packages/agent-runner/src/claim-cas.ts` + `ledger-write.ts` (the CAS primitive),
> the slug resolver `slug-namespace.ts` (the `<type>-<slug>` identity), and the
> existing CAS-seam tests (the two-concurrent-actors harness).
>
> FIRST, check this slice against current reality (drift). The ledger CAS seam and the
> slicing lock are LANDED substrate (PRD 2026-06-09 UPDATE). If they landed
> differently than assumed, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house CAS-seam style. "Done" = acceptance criteria met and the gate
> green.

---

### Claiming this slice

```sh
agent-runner claim advancing-lock-borrow --arbiter origin
git fetch origin && git switch -c work/advancing-lock-borrow origin/main
git mv work/in-progress/advancing-lock-borrow.md work/done/advancing-lock-borrow.md
```
