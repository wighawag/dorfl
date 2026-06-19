---
title: a TRANSIENT-INFRA build failure (401 OAuth expiry, outage) is routed to needs-attention as `agent-failed` indistinguishably from a GENUINE stuck-state — and can then be SILENTLY reverted backlog-ward by an unrelated PR's sibling-ledger reconcile
date: 2026-06-16
status: open
slug: transient-infra-failure-indistinguishable-from-genuine-stuck-state
---

## What was observed

A CI `advance` build of `onboard-and-reset-reconcile-mirror-to-arbiter` failed when the `pi` harness's OAuth token expired mid-run:

```
agent failed: 401 {"error":{"type":"authentication_required",
"message":"OAuth refresh token expired or revoked. Run: node scripts/oauth-login.js"}}
```

The runner classified it `[agent-failed]`, SAVED the partial work (pushed `work/slice-onboard-and-reset-…`), and surfaced the item to `work/needs-attention/` on `origin/main` — i.e. exactly the same routing a GENUINE stuck-state (real red gate, real rebase conflict, real bad output) gets. Then, when PR #139 (an UNRELATED slice) merged, its integration's sibling-ledger reconcile took the branch's older `backlog/` placement of this slug and moved it `needs-attention/ → backlog/` (the `R098` rename in the #139 merge commit). Net effect: the transiently-failed item was silently un-stuck back to backlog.

## Why it is a defect (TWO distinct problems, do not conflate)

**Problem A — silent revert via sibling-ledger reconcile.** Because a work branch CARRIES ledger-folder state, an unrelated PR's stale base snapshot can clobber another slug's legitimate `needs-attention` surface on merge. Here it happened to be benign (the failure was transient, so backlog was arguably the right place), but the SAME mechanism would WRONGLY un-stick a GENUINE stuck-state (a real red gate that must stay in needs-attention until a human looks). The reconcile has no way to know which.
  - SCOPE: this is exactly what the `branch-carries-code-not-ledger-status-main-owns-status` PRD fixes — if branches never carry a ledger-status move, no merge can revert another slug's needs-attention surface (status lives only on `main`, transitioned tree-lessly). So Problem A is IN SCOPE of that PRD. NOTE the side effect: once A is fixed, the accidental auto-recovery seen here STOPS happening, so a transient-401'd item would CORRECTLY stay in needs-attention until requeued — which exposes Problem B more sharply.

**Problem B — the runner cannot distinguish a TRANSIENT-INFRA failure from a genuine stuck-state.** A 401 OAuth-expiry / model outage / network blip is NOT a property of the work; it should not be surfaced for human attention as though the SLICE is stuck. The runner ALREADY has a `transient-infra` failure cause distinct from `agent-failed` (observed: "a harness-surfaced model/connection outage (post-retry) → transient-infra, NOT generic agent-failed", `src/failure-cause.ts`), but THIS 401 was classified `agent-failed`, not `transient-infra` — and even `transient-infra` currently still routes to needs-attention rather than (e.g.) holding for auto-retry / a distinct "infra-blocked, not work-blocked" surface.
  - SCOPE: this is NOT fixed by the branch-carries-code PRD. It is a SEPARATE concern — failure-cause CLASSIFICATION (a 401 OAuth-expiry should map to `transient-infra`, not `agent-failed`) AND the ROUTING of a transient-infra cause (auto-retry / requeue, or a distinct surface, rather than needs-attention which means "a human must look at the WORK"). The `do-fails-fast-…` slice and `failure-cause.ts` are the relevant homes.

## Suggested disposition

- Confirm Problem A is covered by the `branch-carries-code-not-ledger-status-main-owns-status` PRD (it is — add it as a motivating example there: an unrelated merge must never be able to revert another slug's ledger status).
- Open a SEPARATE slice (or fold into a failure-cause PRD) for Problem B: (1) classify a 401 OAuth-expiry / auth-required as `transient-infra`, not `agent-failed`; (2) decide the ROUTING for `transient-infra` — it should not land in `needs-attention` as a work-stuck signal (auto-retry with backoff, or a distinct infra-blocked surface that does not ask a human to inspect the work). Until then, a transient infra failure mis-presents as "the slice is stuck."

## Provenance

Observed live this session: the `advance` run log for `onboard-and-reset-reconcile-mirror-to-arbiter` (401 OAuth expiry → `agent-failed` → needs-attention), and the PR #139 merge commit (`95da72e`) whose `R098` rename moved the slug `needs-attention/ → backlog/`. The sibling-ledger reconcile is `reconcileSiblingLedgerConflict` in `src/integration-core.ts` (takes the arbiter's version of sibling ledger files on a rebase CONFLICT — but a clean squash-merge of a branch carrying a stale placement bypasses that and the branch's placement wins). The user identified Problem B as the real defect and challenged the assumption that the branch-carries-code PRD covers it — it does not; it covers only A.
