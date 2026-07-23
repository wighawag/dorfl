---
title: 'Classify a stuck item''s failure CAUSE (transient-infra vs agent-misbehaved vs gate-failed vs config/wiring) so the needs-attention reason + operator signal are not all undifferentiated "agent failed" — reusing the existing outcome vocabulary, and making do and run classify the SAME error the same way'
slug: failure-cause-classification-model-vs-git-vs-agent
blockedBy: []
covers: []
---

## What to build

When an item routes to `work/needs-attention/`, the runner records a reason and an outcome/status. Today several DIFFERENT causes collapse into the same label:

- A **transient infra** failure (the model endpoint offline/overloaded surfaced by the harness AFTER its own retries; a git/provider outage) reads identically to…
- …an **agent misbehaving** (produced garbage, wrong-but-compiling), which reads like…
- …a **real gate red** (the acceptance gate caught a genuine bug), and a
- **config/wiring error** thrown by the core (e.g. `review` on with no `reviewGate`) is labelled `agent-failed` in `run` but `usage-error` in `do` — the SAME error, classified DIFFERENTLY across the two paths (a divergence the run/do convergence was meant to remove). See `work/observations/run-thrown-core-error-labeled-agent-failed.md`.

This matters because the CAUSE drives the right RECOVERY: transient-infra → retry the same work (the work is fine); agent-misbehaved / gate-failed → a human/agent must FIX something; config-error → fix the WIRING, not the slice. An operator (or an autonomous loop) triaging a stuck fleet needs the cause, not a flat "agent failed".

> RECONCILE WITH THE EXISTING OUTCOME VOCABULARY FIRST (do NOT fork it). The codebase ALREADY has outcome/status names: `agent-failed`, `agent-stopped`, `gate-failed`, `rebase-conflict`, `review-blocked`, `usage-error`, `contended`, `completed`, `lost`, `refused` (grep `outcome:`/`ItemStatus` in `do.ts`/`run.ts`/ `integration-core.ts`). This slice MUST extend/reuse that vocabulary, NOT invent a parallel one. Concretely: a gate red is the EXISTING `gate-failed` (do not add `gate-red`); a rebase abort is the EXISTING `rebase-conflict`; an agent that ran but produced bad/empty output keeps `agent-failed`/`agent-stopped`. The genuinely NEW axis this slice adds is CAUSE for what is today lumped under `agent-failed`: `transient-infra` (harness-surfaced model/connection outage post-retry, or a git/provider outage) and `config-error` (a thrown core wiring error) — confirm there is no existing name for these before adding them, and decide whether they are a new ENUM member vs. an orthogonal cause TAG on the existing outcome.

End-to-end behaviour after this slice:

- The failure CAUSE is recorded on the needs-attention transition (reason prose and/or a structured field) REUSING the existing outcome names where they already fit (`gate-failed`, `rebase-conflict`, `agent-failed`/`agent-stopped`) and adding ONLY the genuinely-new causes (`transient-infra`, `config-error`) the existing vocabulary lacks — so the cause is legible WITHOUT a second, overlapping naming scheme.
- **`do` and `run` classify the SAME error the SAME way** (the cross-path divergence in the observation is removed — a thrown core config error is `config-error` on both, not `agent-failed` on one and `usage-error` on the other).
- The classification is **best-effort + conservative**: an unknown cause stays the safe generic ("agent/run failed") — this slice ADDS precision where the cause is knowable, it does not force a wrong label.

NOTE on model failures specifically: model offline/overloaded RETRIES are the HARNESS's job (pi does its own ~3–4 retries). This slice classifies what the harness SURFACES once its retries are exhausted (so a post-retry model outage reads as `transient-infra`, distinct from the agent producing bad output) — it does NOT add model retries.

## Acceptance criteria

- [ ] The failure cause is recorded on the needs-attention route (reason prose and/or a structured field), REUSING the existing outcome names where they fit (`gate-failed`, `rebase-conflict`, `agent-failed`/`agent-stopped`) and adding ONLY the genuinely-new causes the vocabulary lacks (`transient-infra`, `config-error`). No new name DUPLICATES an existing outcome (no `gate-red` alongside `gate-failed`).
- [ ] The chosen cause vocabulary (especially the new `transient-infra` / `config-error` and how they relate to the existing outcomes) is PINNED in `CONTEXT.md`'s glossary so a later author cannot re-fork it.
- [ ] A thrown core config/wiring error (e.g. `review` on, no `reviewGate`) is classified IDENTICALLY by `do` and `run` (no more `agent-failed`-in-run vs `usage-error`-in-do divergence for the same error); a test pins both paths.
- [ ] A harness-surfaced model/connection failure (after the harness's own retries) is classified `transient-infra`, distinct from an agent that ran but produced bad/empty output.
- [ ] A real gate red and a rebase conflict keep their precise causes (not folded into a generic agent-failed).
- [ ] Conservative default: an unrecognised cause stays the safe generic label (the slice never forces a wrong specific label).
- [ ] Tests mirror the repo style (throwaway git repos; injected harness/gate seams to drive each cause); existing failure-path tests still pass.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (Independent; touches the failure/route reason construction in `src/do.ts` + `src/run.ts` + the shared needs-attention reason builders. No file overlap that requires serialising, but note it edits the SAME `saveAgentFailure` reason sites as `needs-attention-routing-resilient-honest-requeue-safe` — if both are in flight, serialise to avoid a merge conflict; otherwise either order is fine.)

## Prompt

> Add a failure-CAUSE classification to the runner's stuck-item routing so the needs-attention reason + operator signal distinguish transient-infra (a harness-surfaced model outage AFTER its retries; a git/provider outage), agent-misbehaved (ran but produced bad/empty output), real gate-red, rebase conflict, and config/wiring error — instead of collapsing them into an undifferentiated "agent failed". And make `do` and `run` classify the SAME error the SAME way.
>
> DOMAIN VOCABULARY + WHERE TO LOOK: `src/do.ts` `saveAgentFailure` (in-place + `--remote` + the STOP-route) and `src/run.ts` `runOneItem`'s catch around `performIntegration` (→ `saveAgentFailure`, `ItemStatus: 'agent-failed'`) — these are the routing/labelling sites. Compare `src/complete.ts`'s catch-all (`outcome: 'usage-error'`) — the SAME thrown core error is currently labelled differently across paths (the divergence to fix). The STOP vs empty-diff signals live in `src/agent-stop.ts` (`parseStopSentinel`, `isWorkBranchDiffEmpty`) — those already separate drift-STOP from a real build; this slice adds the CAUSE axis on top. Read `work/observations/run-thrown-core-error-labeled-agent-failed.md` (it names the exact cross-path divergence and the question of a distinct status).
>
> WHAT CLASSIFIES AS WHAT (reusing existing names; adding only the new causes): a thrown core config/wiring error → the NEW `config-error` on BOTH `do` and `run` (not `agent-failed`); a harness-surfaced connection/model failure (the harness already retried) → the NEW `transient-infra`; an `agent.ok` run that produced bad/empty output or a STOP-sentinel → the EXISTING `agent-failed`/`agent-stopped` (keep the existing STOP reason); a gate exit → the EXISTING `gate-failed` (NOT a new `gate-red`); a rebase abort → the EXISTING `rebase-conflict`. Keep it best-effort: an unrecognised cause stays the safe generic label.
>
> SCOPE FENCE: model-endpoint RETRIES are the harness's job (pi retries its own API) — do NOT add model retries here; only CLASSIFY what the harness surfaces post-retry. Do NOT change WHEN items route to needs-attention. Coordinate (serialise) with `needs-attention-routing-resilient-honest-requeue-safe` if both are in flight — they edit the same `saveAgentFailure` reason sites.
>
> FIRST run the drift check: confirm `do` and `run` still classify a thrown core error differently (do: usage-error; run: agent-failed) and that there is no existing cause taxonomy. If a taxonomy already landed, route to `needs-attention/` with the discrepancy.
>
> "Done" = a failure-cause taxonomy is recorded on the route, `do`/`run` agree on the same error, transient-infra/gate-red/rebase-conflict/config-error are distinct from agent-misbehaved, the conservative default holds, tests cover each cause, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.

---

## Provenance

Promoted from `work/observations/run-thrown-core-error-labeled-agent-failed.md` (2026-06-07) + the failure-surface analysis during the `slicing-coherence` chain (2026-06-08), where a model-endpoint outage read identically to an agent misbehaving. Delete that observation once this slice lands in `done/`.
