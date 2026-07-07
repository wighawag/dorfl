## Why

A CI `advance` run failed with a 401 `authentication_required` / "OAuth refresh token expired or revoked" from the `pi` harness. `classifyFailureCause` in `packages/dorfl/src/failure-cause.ts` fell through to the generic `agent-failed`, so the item was surfaced to `work/needs-attention/` as if the WORK were stuck. It wasn't — the credential expired. A credential expiry is fundamentally different from both a bad-output `agent-failed` AND from a `transient-infra` outage: no amount of retry fixes it; a human must re-auth.

This task discharges the observation `transient-infra-failure-indistinguishable-from-genuine-stuck-state.md`. Problem A in that note (silent revert via sibling-ledger reconcile) is already RESOLVED by the per-item-lock ledger cutover (ADR `ledger-status-on-per-item-lock-refs`). Problem B (classification + routing) is what remains, and its shape is settled in the note's applied answers q1/q2/q3:

- q1 → promote a small classification slice (this task) + an accompanying routing ADR.
- q3 → do NOT fold 401 into `transient-infra`; add a NEW dedicated `FailureCause` variant (`needs-reauth` / `credential-expired`) so the taxonomy stays honest and downstream routing can branch on it cleanly.
- q2 → split routing by sub-cause: model-outage / 5xx / 429 / overloaded → bounded auto-retry with backoff, then a distinct infra-blocked surface if retries exhaust; credential-expiry → straight to a needs-reauth surface, kept SEPARATE from work-stuck `needs-attention` (which means "a human must look at the WORK" — wrong signal here).

## Scope

Two deliverables, both required for this task to be done:

### (a) Classification change — `packages/dorfl/src/failure-cause.ts`

1. Extend the `FailureCause` union with a new variant. Suggested name: `needs-reauth` (alt: `credential-expired`; pick one and use it consistently). Update ALL three declaration sites of the union (the `export type FailureCause` definition, `classifyFailureCause`, and `failureCauseLabel` — plus any exhaustive switches elsewhere; grep for `FailureCause` and `agent-failed` across `packages/dorfl/src` to find them).
2. Add a signature list (parallel to `TRANSIENT_INFRA_SIGNATURES`) matching credential-expiry text. At minimum:
   - `authentication_required` (the JSON `error.type` string in the observed 401 body)
   - `OAuth refresh token expired or revoked`
   - a generic `401` + `auth`/`token` guard tight enough not to false-positive on unrelated 401s from tool code
   Extend `classifyFailureCause` to check these BEFORE the `transient-infra` check and return the new cause. Keep the existing conservative default (`agent-failed`) for anything unmatched.
3. Give the new cause a human label in `failureCauseLabel` (e.g. "needs re-auth (credential expired)").
4. Unit tests: the exact 401 body from the observation (`401 {"error":{"type":"authentication_required","message":"OAuth refresh token expired or revoked. Run: node scripts/oauth-login.js"}}`) classifies as the new cause; a `transient-infra` string (e.g. `ECONNRESET`, `overloaded`, `429`) still classifies as `transient-infra`; a plain agent bad-output string still classifies as `agent-failed`.

This task INTENTIONALLY does NOT change routing yet — it just makes the cause distinguishable. Routing is (b).

### (b) Routing ADR — `docs/adr/transient-infra-and-needs-reauth-routing.md`

Write a self-contained ADR capturing the Q2 decision so future work on `run.ts` / `do.ts` (the transient-infra routing sites) has a settled reference. It must state:

- **Context:** `needs-attention/` means "a human must inspect the WORK." Infra failures are NOT properties of the work, so routing them there mis-presents the signal and (pre-per-item-lock) even risked silent revert. With classification now able to distinguish `transient-infra` from `needs-reauth` from `agent-failed`, routing per cause is possible.
- **Decision (the split):**
  - `transient-infra` (model outage / 5xx / 429 / overloaded / network) → bounded auto-retry with backoff on the SAME work; if retries exhaust, surface to a distinct infra-blocked surface (NOT `needs-attention`).
  - `needs-reauth` / credential-expired → do NOT retry (retries cannot help); surface to a dedicated needs-reauth surface that asks a human to RE-AUTH, kept SEPARATE from work-stuck `needs-attention`.
  - `agent-failed` and other work-stuck causes → unchanged, continue to `needs-attention`.
- **Why not fold 401 into `transient-infra`:** cite q3 — retry semantics differ, and the human action required differs (re-auth vs. wait/inspect). Conflating them would force the routing layer to re-split a `transient-infra` bucket, defeating the point of the taxonomy.
- **Non-goals of this ADR:** the exact backoff schedule, the on-disk shape of the infra-blocked / needs-reauth surfaces, and the exact call sites in `run.ts`/`do.ts`. Those are follow-up implementation tasks; this ADR only fixes the routing POLICY per cause.
- **Consequences:** a transient 401 (like the one in the source observation) will stop landing in `needs-attention`. The infra-blocked / needs-reauth surface(s) become new concepts the runner must implement; until they exist, the routing code MAY still fall back to today's behaviour, but the ADR is the reference for the intended end state.

## Out of scope (explicitly)

- Implementing the infra-blocked / needs-reauth surfaces or the retry loop wiring. The ADR records the decision; a separate slice will land the routing code.
- Re-opening Problem A. It is resolved by the per-item-lock cutover; this task does not touch ledger placement.

## Provenance

Discharges `work/notes/observations/transient-infra-failure-indistinguishable-from-genuine-stuck-state.md` (applied answers q1/q2/q3 dated 2026-06-22). That observation should be DELETED once this task is minted — its judgement is fully carried here, and git history is the archive.
