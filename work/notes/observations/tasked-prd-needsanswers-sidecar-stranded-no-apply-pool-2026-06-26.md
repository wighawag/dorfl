---
needsAnswers: false
---

# A `needsAnswers` PRD in `prds/tasked/` strands its answered sidecar: no lifecycle pool enumerates it (neither surface nor apply)

2026-06-26

## What was noticed

We deliberately codified (WORK-CONTRACT, "Drift is a needs-attention signal" ->
"A PRD that has drifted AFTER it was TASKED") that a tasked PRD which drifts
should set `needsAnswers: true` IN PLACE while staying in `prds/tasked/`, rather
than move back to `prds/proposed/`. We then exercised it end-to-end on
`land-time-reverify-and-parallel-merge-ceiling`.

The advance/surface system DID surface a question sidecar for that PRD
(`work/questions/prd-land-time-reverify-and-parallel-merge-ceiling.md`, 5 well-formed
questions) -- but that sidecar predated our move-back fix (it was minted on
2026-06-25 while the PRD was briefly in `prds/proposed/`). Once we answered it and
pushed, the `push: work/questions/**` advance tick fired and APPLIED the three
TASK sidecars correctly (cleared `needsAnswers`, deleted each sidecar), but the
PRD's answered sidecar was NEVER consumed. Verified via `dorfl scan --json`: with
the PRD resting in `prds/tasked/`, BOTH lifecycle pools are empty for it
(`surface: []`, `apply: []`). The human's answer was STRANDED; a human had to
apply it directly (clear the flag + delete the sidecar by hand).

## Why it happens (verified in code)

`lifecycle-gather.ts` (`blockedItemsInPlace` / the mirror counterpart) gathers
`needsAnswers` candidates from:
  - `state.ready` (the POOL: `tasks/ready/` + `prds/ready/`), and
  - when `surfaceStaging` is on: STAGING = `tasks/backlog/` + `prds/proposed/`.

It does NOT read `prds/tasked/`. So a `needsAnswers: true` PRD in `prds/tasked/`
is invisible to the surface pool AND the apply pool (the apply pool is the same
candidate set, split by sidecar-answered-state). The classifier never sees it, so
neither `surface` nor `apply` ever runs on it.

This was a latent assumption: before we codified in-place tasked-PRD drift, a
`needsAnswers` PRD only ever existed in `prds/ready`/`prds/proposed`, both of which
ARE gathered. Our new sanctioned state (`needsAnswers: true` in `prds/tasked/`)
has no pool, so the answer loop cannot close for it.

## Why it matters

A stranded human answer is the worst-shaped failure: the human did the work, the
system silently did nothing with it. The `needsAnswers <=> active sidecar`
invariant (`advance-classify.ts`) would eventually HALT the item's tick with an
`invariant-violation` if the flag were cleared without the sidecar removed -- but
a tasked PRD never reaches a tick at all, so even that backstop does not fire. It
is silent.

## Suggested fix direction (do NOT build from this note; surface/decide first)

Make the `needsAnswers` candidate gather ALSO enumerate `prds/tasked/` (at least
for the APPLY pool, which is consume/always-on and must never strand an answer;
arguably for SURFACE too, so a tasked PRD's questions get minted in the first
place). Options:
  1. Add `prds/tasked/` to the gather's candidate set for `needsAnswers` items
     (simplest; mirrors that apply is always-on / never gated).
  2. Or, narrower: only the APPLY side reads `prds/tasked/` (an answered sidecar
     always applies), while SURFACE stays pool/staging-only -- but then a tasked
     PRD's questions must be surfaced by some other path (e.g. the human writes
     the sidecar directly), which is the case that just bit us.

Whichever, the invariant to preserve: an ANSWERED sidecar must NEVER be
un-consumable because of WHERE its item rests. Apply is the consume phase
(always-on); a folder that can hold a `needsAnswers` item must be in the apply
gather.

## Cross-links

- WORK-CONTRACT "A PRD that has drifted AFTER it was TASKED" (the rule this gap
  is the dual of).
- `lifecycle-gather.ts` `blockedItemsInPlace` (the candidate set that omits
  `prds/tasked/`).
- The exercised PRD: `work/prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md`
  (its RESOLVED block notes the manual application this gap forced).
