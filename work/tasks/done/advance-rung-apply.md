---
title: advance — the APPLY-answers rung: all-answered → apply atomically (mutate item + sidecar in one commit), append-new-Qs OR clear+delete, disposition to any terminal (always allowed)
slug: advance-rung-apply
spec: advance-loop
blockedBy: [advance-rung-surface]
covers: [11, 14, 15, 29, 30]
---

## What to build

The APPLY rung: when the classifier says "apply" (all sidecar entries answered), the engine applies the human's answers to the item ATOMICALLY (mutate the item body AND update/remove the sidecar in ONE commit), then either APPENDS newly discovered questions (→ stays `needsAnswers:true`, re-pauses) OR resolves fully (→ clears `needsAnswers` + DELETES the sidecar, atomically). Applying an answer is ALWAYS allowed (no gate). NO human answer is ever invented — the rung only applies HUMAN-authored answers.

This rung is sequenced AFTER `advance-rung-surface` to serialize edits to the shared rung-executor module (file-orthogonality). It reuses the atomic-apply primitive from `advance-sidecar-contract`.

### Precise scope

- On classify=apply (all entries answered): under the `advancing` CAS lock, read the answered entries, APPLY them to the item — using the `applyAtomic` primitive from `advance-sidecar-contract` (item body + sidecar in ONE commit).
- **Two outcomes:** (a) the apply discovers/appends NEW questions → append `qN+1…`, stay `needsAnswers:true`, re-pause (the "all answered?" flips back to false); or (b) the answers resolve the item → clear `needsAnswers` + DELETE the sidecar in the SAME atomic commit (invariant `needsAnswers:false ⟺ no sidecar`).
- **Disposition to ANY terminal state (US #29):** an answer may disposition the item to advance-toward-build, out-of-scope (`out-of-scope/`), needs-attention (the existing bounce), or — for observations — keep/delete. The `disposition` field on a sidecar entry carries the routing the apply rung executes (promote-slice / promote-adr / keep / delete / out-of-scope / needs-attention). So no item loops forever (always progressing / terminal / idle-pending).
- **A "keep" answer records a marker (US #30):** a `triaged:keep` marker on the item + an answered entry, so the item drops out of the candidate pool and is never re-asked. (Observation keep/delete routing is shared with — and finalised in — the triage rung; here the apply rung executes the recorded disposition.)
- Applying is ALWAYS allowed (no gate); NEVER invents an answer.
- A SUBSET of answered entries is NOT classified "apply" (the classifier returns NO-OP) — so this rung only runs when ALL are answered; assert the boundary.

## Acceptance criteria

- [ ] On all-answered, the engine applies the human's answers ATOMICALLY (item body + sidecar in ONE commit, via the sidecar contract's atomic-apply).
- [ ] Apply either APPENDS new questions (stays `needsAnswers:true`, re-pauses) OR resolves fully (clears `needsAnswers` + deletes the sidecar in the SAME commit); the invariant `needsAnswers:false ⟺ no active sidecar` holds.
- [ ] An answer can disposition the item to any terminal (advance / out-of-scope / needs-attention / observation keep/delete) via the `disposition` field — no item loops forever.
- [ ] A "keep" answer records `triaged:keep` + an answered entry; the item drops out of the candidate pool and is never re-asked.
- [ ] Applying is ALWAYS allowed (no gate) and NEVER invents an answer (only applies human-authored answers) — proven by test.
- [ ] A subset-answered sidecar is NOT applied (classifier NO-OP) — boundary asserted.
- [ ] Tests: atomic apply (one commit); append-re-pause; clear+delete; each disposition route; keep-marker drop-out; never-invent. House CAS-seam + throwaway-repo style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-rung-surface` — serialized to avoid conflicting edits on the shared rung-executor module; also reuses the surface-established spawn/persist pattern.

## Prompt

> Build the APPLY-answers rung of the advance engine. Read the PRD `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("The per-item state machine", US #11/14/15/29/30, "The sidecar FORMAT" — the `disposition` field). On classify=apply (ALL entries answered): under the `advancing` CAS lock, apply the human's answers to the item ATOMICALLY (item body + sidecar in ONE commit, via the sidecar contract's atomic-apply), then EITHER append new questions (stay `needsAnswers:true`, re-pause) OR resolve fully (clear `needsAnswers` + DELETE the sidecar in the SAME commit). An answer may disposition the item to ANY terminal (advance / out-of-scope / needs-attention / observation keep/delete) via the `disposition` field; a "keep" records `triaged:keep` and drops the item out of the pool. ALWAYS allowed (no gate); NEVER invents an answer. A subset-answered sidecar is NOT applied (NO-OP).
>
> READ FIRST: the sidecar atomic-apply from `advance-sidecar-contract`, the classifier from `advance-tick-classifier` (the apply vs no-op boundary), the `advancing` lock from `advancing-lock-borrow`, the rung-executor seam (now also written by `advance-rung-surface`), `packages/dorfl/src/needs-attention.ts` (the existing bounce), and how items move to `out-of-scope/` (WORK-CONTRACT.md).
>
> FIRST, check this slice against current reality (drift). If a dependency landed differently than assumed, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house CAS-seam style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim advance-rung-apply --arbiter origin
git fetch origin && git switch -c work/advance-rung-apply origin/main
git mv work/in-progress/advance-rung-apply.md work/done/advance-rung-apply.md
```
