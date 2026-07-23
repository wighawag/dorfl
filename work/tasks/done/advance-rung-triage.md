---
title: 'advance — the observation TRIAGE rung + the NEW `autoTriage` gate: question-gated by default, conservative auto-disposition (high bar), promote-via-CAS new-item creation'
slug: advance-rung-triage
spec: advance-loop
blockedBy: [advance-rung-apply]
covers: [16, 17, 23, 24, 30]
---

## What to build

The observation TRIAGE rung + the NEW `autoTriage` repo-config gate. By DEFAULT, triage is QUESTION-GATED: the agent surfaces a promote/keep/delete disposition question and WAITS (so "is this worth building?" is never decided autonomously). A conservative auto-disposition EXCEPTION (option c, high bar) — gated by `autoTriage` — auto-dispositions ONLY the no-question cases (exact duplicate → suggest delete; unambiguous map onto an existing item). It NEVER auto-deletes a non-duplicate signal and NEVER auto-promotes a judgement call.

This rung is sequenced AFTER `advance-rung-apply` to serialize the shared rung-executor edits. It introduces the new `autoTriage` gate (the gate-FAMILY wiring — `allowAgents`/`autoSlice`/`autoTriage` resolution — and the build/slice gate composition land in `advance-drivers-and-gates`; this slice adds the `autoTriage` key + its use in the triage rung).

### Precise scope

- The triage rung: classify=triage-observation (an UNTRIAGED observation) →
  - **Default (question-gated):** spawn `surface-questions` (the observation-triage question: promote / keep / delete) → engine writes the sidecar (reuses the surface rung) → WAIT. The disposition routing is then executed by the apply rung when the human answers.
  - **`autoTriage` exception (high bar):** if `autoTriage` is on AND the case is a no-question one (exact-duplicate → suggest delete; unambiguous map onto an existing item), auto-disposition it WITHOUT a question. NEVER auto-delete a non-duplicate; NEVER auto-promote a judgement call.
- **Promote → CAS-create a new backlog stub (US #24):** an answered "promote" drafts a new `work/backlog/<new-slug>.md` routed THROUGH the CAS keyed on the NEW item's identity (reuse the new-item-creation helper from `advancing-lock-borrow`), records the triage, and deletes the sidecar.
- **Keep / delete:** "keep" → `triaged:keep` marker, drops out of the pool (shared with the apply rung's keep handling); "delete" → recommend deletion (the HUMAN deletes per the capture-bucket contract — the agent never auto-deletes a non-duplicate signal).
- **Add the `autoTriage` repo-config key** (default off) to `repo-config.ts`'s allowed keys, resolved through the SAME chain as `allowAgents`/`autoSlice` (`flag > DORFL_* env > dorfl.json > global > default false`). The triage rung RESPECTS it; surface + apply stay always-allowed.

## Acceptance criteria

- [ ] Triage is QUESTION-GATED by default: an untriaged observation surfaces a promote/keep/delete question and WAITS (no autonomous "worth building?" decision).
- [ ] `autoTriage` (NEW repo-config key, default off, resolved through the standard chain) gates a CONSERVATIVE auto-disposition: only exact-duplicate → suggest-delete or unambiguous-map cases; NEVER auto-deletes a non-duplicate, NEVER auto-promotes a judgement call.
- [ ] An answered "promote" CAS-creates a new `work/backlog/<new-slug>.md` keyed on the NEW item's identity (reusing the new-item-creation CAS helper), records the triage, and deletes the sidecar; a same-slug new-item race → loser fails CAS.
- [ ] "keep" → `triaged:keep` marker, drops out of the pool; "delete" → recommends deletion (human deletes — agent never auto-deletes a non-duplicate).
- [ ] Surface + apply remain ALWAYS allowed even with `autoTriage` off (the triage QUESTION still surfaces; only auto-disposition is gated).
- [ ] Tests: question-gated default; `autoTriage` exception bounds (duplicate-only, no auto-promote, no auto-delete-of-non-duplicate); promote-via-CAS new item + race loser; keep marker; delete recommendation. House CAS-seam + throwaway-repo style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-rung-apply` — serialized on the shared rung-executor module; reuses the surface rung (for the question-gated path), the apply rung's keep/disposition handling, and the new-item-creation CAS helper from `advancing-lock-borrow`.

## Prompt

> Build the observation TRIAGE rung + the NEW `autoTriage` gate. Read the SPEC `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/spec/`) (US #16/17/23/24/30, "Per-item-type transitions", "Repo-config: a FLAT per-action gate family", "Observation-triage option-c"). Triage is QUESTION-GATED by default (surface promote/keep/delete and WAIT — never decide "worth building?" autonomously). A conservative `autoTriage`-gated exception (high bar) auto-dispositions ONLY no-question cases (exact-duplicate → suggest delete; unambiguous map onto an existing item) — NEVER auto-delete a non-duplicate, NEVER auto-promote a judgement call. An answered "promote" CAS-creates a new `work/backlog/<new-slug>.md` keyed on the NEW item's identity (reuse the new-item-creation CAS helper from `advancing-lock-borrow`). "keep" → `triaged:keep` drop-out; "delete" → recommend deletion (human deletes). Add the `autoTriage` key to `repo-config.ts` (default off, standard resolution chain); surface + apply stay always-allowed.
>
> READ FIRST: `packages/dorfl/src/repo-config.ts` (`REPO_ALLOWED_KEYS` + `resolveRepoConfig` — add `autoTriage` alongside `allowAgents`/`autoSlice`), the new-item-creation CAS helper from `advancing-lock-borrow`, the surface rung (`advance-rung-surface`) and apply rung (`advance-rung-apply`) it reuses, and the capture-bucket contract (observations are append-only, leave by deletion — WORK-CONTRACT.md).
>
> FIRST, check this slice against current reality (drift). If a dependency landed differently than assumed, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house CAS-seam style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim advance-rung-triage --arbiter origin
git fetch origin && git switch -c work/advance-rung-triage origin/main
git mv work/in-progress/advance-rung-triage.md work/done/advance-rung-triage.md
```
