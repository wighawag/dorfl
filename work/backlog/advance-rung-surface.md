---
title: advance — the SURFACE-question rung: spawn `surface-questions` fresh-context, engine writes the sidecar CAS-atomically (always allowed)
slug: advance-rung-surface
prd: advance-loop
blockedBy: [advance-verb-resolver, surface-questions-skill]
covers: [3, 4, 33]
---

## What to build

The SURFACE rung of the advance engine: when the classifier says "surface", the engine spawns a FRESH-CONTEXT agent with the `surface-questions` skill loaded, gets the emitted questions, and ITSELF writes them to the sidecar (`advance-sidecar-contract`) CAS-atomically under the `advancing` lock — exactly as the review gate uses `review`. The skill JUDGES; the engine PERSISTS. This rung is ALWAYS allowed (no gate — surfacing a question is never gated).

This is the FIRST rung body filling the executor seam from `advance-verb-resolver`. It is sequenced before the other rung bodies to establish the spawn→emit→persist pattern they reuse, and to keep the rung-executor file edits serialized (file-orthogonality with apply/triage).

### Precise scope

- The surface rung: classify=surface → under the `advancing` CAS lock, spawn a fresh-context agent with `surface-questions` loaded → collect emitted questions → the ENGINE writes/appends them to the sidecar (CAS-atomic, append-never-overwrite per the sidecar contract) → set `needsAnswers:true` (atomically with the sidecar write) → release. Surfacing normally writes the sidecar atomically (the transitional "needsAnswers:true but no sidecar" first-pass also resolves here).
- The agent spawn mirrors the EXISTING review-gate spawn pattern (`review-gate.ts`) — fresh context, skill loaded, structured emit parsed by the engine. The engine does ALL the git/persistence (the skill writes nothing).
- ALWAYS-allowed: no gate check (surfacing + applying are always allowed even with every autonomy flag off — the "question loop with zero autonomy" case).
- The expensive (agent/model) work is POST-lock, winner-only (a CAS loser never spawns the agent).

## Acceptance criteria

- [ ] When the classifier returns "surface", the engine takes the `advancing` lock, spawns a fresh-context agent with `surface-questions` loaded, collects the emitted questions, and ITSELF writes/appends them to the sidecar CAS-atomically, setting `needsAnswers:true` in the SAME atomic step.
- [ ] Append-never-overwrite holds (re-surfacing adds `qN+1`, never mutates an answered entry); a re-surface flips a previously-all-answered sidecar back to not-all-answered.
- [ ] Surfacing is ALWAYS allowed (no gate) — proven even with all autonomy flags off.
- [ ] The agent spawn mirrors the review-gate spawn (fresh context, skill loaded, structured emit); the engine owns ALL persistence/git (the skill writes nothing).
- [ ] The expensive agent work is POST-lock, winner-only (a CAS loser never spawns the agent) — proven by test.
- [ ] Tests: a surface tick writes the expected sidecar entries (stubbed `surface-questions` emit); append-on-resurface; always-allowed with flags off; CAS-loser-no-spawn. House CAS-seam + throwaway-repo + stubbed-harness style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-verb-resolver` — fills the rung-executor seam this rung dispatches into.
- `surface-questions-skill` — the skill this rung spawns.

## Prompt

> Build the SURFACE rung of the advance engine. Read the PRD `advance-loop` (in `work/prd-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) ("batch-qa → surface-questions", US #33, "The per-item state machine"). On classify=surface: under the `advancing` CAS lock, spawn a fresh-context agent with `surface-questions` loaded, collect its emitted questions, and the ENGINE writes/appends them to the sidecar CAS-atomically + sets `needsAnswers:true` in the same atomic step — exactly as the review gate uses `review` (skill judges, engine persists). Surfacing is ALWAYS allowed (no gate). Expensive work is POST-lock, winner-only.
>
> READ FIRST: `packages/agent-runner/src/review-gate.ts` (the fresh-context skill-loaded spawn + structured-emit-parse pattern to MIRROR), the sidecar append/atomic-apply from `advance-sidecar-contract`, the `advancing` lock from `advancing-lock-borrow`, the rung-executor seam from `advance-verb-resolver`, and the `surface-questions` skill. Use the house stubbed-harness test pattern (so no real agent/model is invoked in tests).
>
> FIRST, check this slice against current reality (drift). The agent-spawn / reporting-channel substrate is LANDED (PRD 2026-06-09 UPDATE — `agent-stop`, review-gate). If it landed differently, reconcile or route to `needs-attention/`.
>
> TDD with vitest. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
agent-runner claim advance-rung-surface --arbiter origin
git fetch origin && git switch -c work/advance-rung-surface origin/main
git mv work/in-progress/advance-rung-surface.md work/done/advance-rung-surface.md
```
