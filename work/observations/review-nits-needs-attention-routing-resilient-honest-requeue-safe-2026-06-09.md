---
title: review-gate non-blocking nits for 'needs-attention-routing-resilient-honest-requeue-safe' (Gate 2 approve)
date: 2026-06-09
status: open
slug: needs-attention-routing-resilient-honest-requeue-safe
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'needs-attention-routing-resilient-honest-requeue-safe' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope decision NOT to thread the injectable backoff/sleep seam through the COMPLETE (propose) integration path — so a PR-create outage during an autonomous run uses real timing, not the injected seam. Intended?
  (applyCompleteTransition (ledger-write.ts ~L380-391) calls integrator.integrate({cwd, arbiter, branch, mode, title, body, env}) and ApplyCompleteTransitionInput carries no backoff/sleep, so neither integration-core.ts's complete path nor complete.ts passes them down. The PR-create retry in github.ts therefore always uses realSleep + DEFAULT_BACKOFF in production (a real, but BOUNDED ~30s give-up — not a hang). The seam IS exercised with an injected sleep directly via provider.openRequest in the resilient-route test, so the slice's 'injectable-sleep, no real waits in tests' requirement is met at the unit level. The asymmetry — the needs-attention push path threads sleep all the way to run.ts, the PR-create path does not — is the only place the deterministic seam stops short. Cheap to extend later by adding backoff/sleep to ApplyCompleteTransitionInput and IntegrateInput wiring.)
- Ratify the new `gh auth status` availability PROBE inserted between the first failed `gh pr create` and the retry loop — an extra provider RPC not named in the slice (which said 'retried with the same backoff').
  (github.ts openRequest now does: attempt create once → if it fails, call available() (gh auth status) → if unavailable, degrade('unavailable') immediately with no retry → else retry the create with backoff → degrade('outage'). This is a sensible way to avoid wasting the whole backoff budget on a deterministic missing/unauth gh (preserving today's instant-degrade for that case) while still retrying a genuine transient outage. It is a reasonable design choice, but it adds an availability call and a second degrade reason ('outage' vs 'unavailable') the slice did not specify — worth recording so the human ratifies the extra probe and the dual-cause wording.)
- Confirm leaving complete.ts's human-path propose success message (~L577-581) UNCHANGED is correct, given the slice prompt explicitly named it as a site to 'read the per-op result rather than assume'.
  (The slice prompt listed complete.ts ~L579 among the message sites to make honest. That message reads result.requestOpened / result.url (true per-op flags from the provider), so it already reports honestly and did not exhibit the 'claims pushed when it wasn't' bug the do.ts sites had — hence no change was needed. This looks correct (the dishonesty was specific to the failure-route sites that hardcoded off routed.moved), but it is an in-scope judgement (the agent decided a named site needed no edit) worth a one-line ratification.)
- Ratify that an OFFLINE requeue (default keep+continue, arbiter supplied but the fetch itself fails) now REFUSES the requeue, since the guard's fetch is best-effort and a stale/absent arbiter ref makes branchAheadOf false.
  (returnToBacklog runs `git fetch --quiet <arbiter>` via gitSoftRun (failure ignored) then tests `<arbiter>/work/<slug>`. If the operator is offline, the fetch fails silently and the arbiter ref is stale/absent, so the guard refuses with the push-first/--reset message even if the branch IS actually on the arbiter. This errs on the SAFE side (refuse rather than make a possibly-unreachable item claimable), which matches the invariant the slice is protecting, but it is a user-visible consequence (a default requeue can fail purely because you are offline) worth recording for the human to confirm is the intended trade-off.)
