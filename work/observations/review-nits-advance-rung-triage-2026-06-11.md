---
title: review-gate non-blocking nits for 'advance-rung-triage' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-rung-triage
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-rung-triage' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the NEW frontmatter marker value `triaged: duplicate` (distinct from the existing `triaged: keep`) introduced by the auto-disposition duplicate path. Is a second `triaged:` value the intended vocabulary, and should the marker family be documented (it has no home in WORK-CONTRACT.md / CONTEXT.md today — both `keep` and `duplicate` are code-only conventions)?
  (autoDispositionObservation() stamps `triaged: duplicate` for the duplicate case and `triaged: keep` for map. The existing pool-drop predicate `isTriagedKeep` in apply-persist.ts matches ONLY `triaged: keep`. A safe, conservative choice, but the growing marker vocabulary is undocumented.)
- CROSS-SLICE INTERACTION to ratify: the not-yet-built pool scan (`advance-drivers-and-gates`) must drop BOTH `triaged: keep` AND `triaged: duplicate` observations out of the candidate pool, but the only existing drop predicate (`isTriagedKeep`) matches `keep` alone. If the pool scan reuses `isTriagedKeep` as-is, a `duplicate`-auto-disposed observation will be re-classified `triage-observation` on every tick (the classifier reads only needsAnswers + sidecar and a duplicate-marked observation has neither), defeating the auto-disposition's 'drops out of the pool, never re-asked' guarantee. Confirm the driver slice will generalise the drop predicate to any `triaged:` value.
  (advance-classify.ts maps any (needsAnswers-unset, no-sidecar) observation to `triage-observation`; the 'drops out' guarantee lives entirely in the upstream pool/eligibility layer, which this slice does not build. This is a real seam between this slice and the driver slice.)
- Ratify the asymmetry: the auto-`duplicate`/`map` paths stamp a `triaged:` marker so the observation drops out, but the ANSWERED-`delete` apply path (apply-persist.ts) stamps NO marker — it only appends a delete recommendation, leaving the observation re-classifiable as `triage-observation` until the human deletes the file. Is the auto-duplicate path correct to additionally mark `triaged: duplicate` where the human-answered delete does not?
  (The auto path deliberately marks-and-drops; the answered-delete path relies on the human deleting. Both are defensible (an answered delete is a stronger human signal), but the two delete-ish paths diverge in whether they drop out of the pool before the human acts.)
- Ratify the default promoted-item identity: an answered promote with no `promoteSlug` drafts `work/backlog/<observation-slug>.md` (the observation's OWN slug). Is reusing the observation's slug for the new backlog item the intended default, given it makes the same-slug new-item race the COMMON case rather than the unlikely one when two runners promote the same observation?
  (promoteObservation() defaults newSlug to the observation slug. The CAS handles the race safely (loser backs off, observation left unresolved for retry), so this is correct-and-safe, but it means two concurrent promotes of one observation always collide on the new path by construction.)
- Ratify the gate-failure fallback: if the triage gate throws (launch failure / unparseable emit) while autoTriage is on, the rung silently falls back to the question-gated surface path (logging a note) rather than erroring. Confirm 'a broken auto-triage gate degrades to surfacing the question' is the desired refusal behaviour.
  (triageRung() catches the gate error and sets decision = {auto:false}, then surfaces. This is the safe direction (never auto-act on a failed gate), but it means a misconfigured triage agent is invisible except in the progress note — no hard signal that autoTriage is non-functional.)
