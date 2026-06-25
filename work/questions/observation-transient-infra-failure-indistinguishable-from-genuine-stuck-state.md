<!-- dorfl-sidecar: item=observation:transient-infra-failure-indistinguishable-from-genuine-stuck-state type=observation slug=transient-infra-failure-indistinguishable-from-genuine-stuck-state allAnswered=false -->

## Q1

**What becomes of this signal now that q1/q2/q3 have applied answers in-body but nothing has been minted yet — discharge it by minting (a) a small classification slice that adds a new dedicated `needs-reauth` / `credential-expired` FailureCause variant plus a 401 `authentication_required` / 'OAuth refresh token expired or revoked' signature, and (b) an accompanying routing ADR capturing the Q2 split (model-outage/5xx/429/overloaded → bounded auto-retry with backoff then a distinct infra-blocked surface; credential-expiry → straight to a needs-reauth surface, separate from work-stuck `needs-attention`), then delete this observation? Or is there a remaining blocker that should keep it as a live note?**

> The note's `## Update (2026-06-20, triage)` narrowed scope to Problem B (Problem A is resolved by the per-item-lock cutover, PRD `ledger-status-per-item-lock-refs`). The `## Applied answers 2026-06-22` block records: q1 = promote-slice (classification) + ADR (routing); q2 = split routing by sub-cause via ADR; q3 = add a NEW dedicated cause rather than folding 401 into `transient-infra`. Frontmatter still has `status: open` and `needsAnswers: true`. Search of `work/tasks/{ready,backlog}` and `work/prds/{proposed,ready}` shows nothing matching `reauth|credential|failure-cause|transient|401|classify`, so the agreed disposition has not yet been actioned. Fix homes named in the note: `src/failure-cause.ts` (classification — the union's three declaration sites + `TRANSIENT_INFRA_SIGNATURES`) and `src/run.ts` / `src/do.ts` (routing).

_Suggested default: Discharge: mint the small classification slice (new `needs-reauth` / `credential-expired` FailureCause variant + 401 / 'OAuth refresh token expired or revoked' signature in `src/failure-cause.ts`) and the routing ADR (the Q2 sub-cause split — bounded auto-retry + infra-blocked surface for outage/5xx/429; needs-reauth surface for credential-expiry, kept separate from work-stuck `needs-attention`), then delete this observation note. The judgement is settled in-body; the residue is execution, not open design._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
