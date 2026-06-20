<!-- agent-runner-sidecar: item=observation:transient-infra-failure-indistinguishable-from-genuine-stuck-state type=observation slug=transient-infra-failure-indistinguishable-from-genuine-stuck-state allAnswered=false -->

## Q1

**Promote Problem B to a slice / failure-cause PRD, or keep as an observation?**

> The 2026-06-20 triage update narrows the note to Problem B (Problem A is resolved by the per-item-lock cutover) and concludes 'Not promoted to a task here.' But the note also identifies two concrete fix homes — `failure-cause.ts` (add a 401 `authentication_required` / 'OAuth refresh token expired or revoked' signature to `TRANSIENT_INFRA_SIGNATURES`) and the transient-infra routing in `run.ts`/`do.ts`. The terminal routing of the observation itself (keep vs promote-slice vs promote-adr) is not yet decided.

_Suggested default: promote-slice — the classification half is a small, well-scoped code change and the routing half is a real open design question; a slice is the natural home._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

## Q2

**Once a failure is classified `transient-infra`, what should the routing be: auto-retry with backoff, a distinct 'infra-blocked, not work-blocked' surface, or both (per sub-cause)?**

> The note flags this as the live open design question. It explicitly notes the two sub-causes may want DIFFERENT routing: a credential expiry (401 OAuth refresh-token expired/revoked) needs a human to RE-AUTH (not to inspect the slice), while a transient model outage / 5xx / rate-limit just needs a retry. Today both would land in `needs-attention`, which means 'a human must look at the WORK' — the wrong signal for either case.

_Suggested default: Split by sub-cause: model-outage / 5xx / 429 → bounded auto-retry with backoff, then a distinct infra-blocked surface if retries exhaust; credential-expiry / 401 auth-required → straight to an infra-blocked / needs-reauth surface (no retry helps), separate from work-stuck `needs-attention`._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Should a 401 `authentication_required` / 'OAuth refresh token expired or revoked' be classified `transient-infra` at all, or a new dedicated cause (e.g. `needs-reauth` / `credential-expired`)?**

> The note's half-1 fix proposes adding the 401 auth-expiry signature to `TRANSIENT_INFRA_SIGNATURES`, treating credential expiry as an infra condition. But it also observes credential expiry behaves differently from a transient outage (no amount of retry fixes it; it needs human re-auth). A single `transient-infra` bucket forces the downstream routing to re-split them; a dedicated cause keeps the taxonomy honest.

_Suggested default: Start by folding into `transient-infra` (smallest change, matches the note's stated fix) and only split out a `needs-reauth` cause if the routing decision above actually diverges enough to need it._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
