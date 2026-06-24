<!-- dorfl-sidecar: item=observation:transient-infra-failure-indistinguishable-from-genuine-stuck-state type=observation slug=transient-infra-failure-indistinguishable-from-genuine-stuck-state allAnswered=false -->

## Q1

**Promote this observation per its already-applied triage — land Problem B's classification half as a slice (add a dedicated `needs-reauth` / `credential-expired` FailureCause variant covering 401 `authentication_required` / 'OAuth refresh token expired or revoked', distinct from `transient-infra`) AND open an accompanying ADR for the routing split (model-outage / 5xx / 429 / overloaded → bounded auto-retry with backoff then an infra-blocked surface on exhaustion; credential-expiry → straight to an infra-blocked / needs-reauth surface, kept separate from work-stuck `needs-attention`)?**

> The note is `status: open`, `needsAnswers: false`, and sits in `work/notes/observations/`. Its 2026-06-20 triage update narrowed scope to Problem B (Problem A is resolved by the per-item-lock cutover in PRD `ledger-status-per-item-lock-refs` — recorded as out of scope). The 2026-06-22 Applied-answers section already resolved the three internal judgement questions:
>   - q1 → promote-slice for classification, ADR for routing.
>   - q2 → routing split by sub-cause (auto-retry+backoff for outage/5xx/429; infra-blocked/needs-reauth surface for credential-expiry); deferred to an ADR.
>   - q3 → NEW dedicated `needs-reauth` / `credential-expired` cause; do NOT fold 401 into `transient-infra`.
> Fix homes named in the note: `src/failure-cause.ts` (`classifyFailureCause` + `TRANSIENT_INFRA_SIGNATURES` — currently matches network / `ECONN*` / 5xx / 429 / rate-limit / overloaded, NOT 401 auth-required) for the slice; `run.ts` / `do.ts` transient-infra routing for the ADR. No outstanding internal judgement remains in the body — the only residue is the terminal routing of the observation itself, which its own applied answers prescribe as promote-slice (+ ADR).

_Suggested default: promote-slice — carve the classification slice (add the `needs-reauth` / `credential-expired` FailureCause variant + the 401 `authentication_required` / 'OAuth refresh token expired'/'revoked' lexical signature, wired through the union's three declaration sites) and open the routing ADR as a sibling, exactly as the applied answers prescribe._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
