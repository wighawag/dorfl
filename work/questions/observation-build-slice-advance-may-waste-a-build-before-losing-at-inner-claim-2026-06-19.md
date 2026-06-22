<!-- agent-runner-sidecar: item=observation:build-slice-advance-may-waste-a-build-before-losing-at-inner-claim-2026-06-19 type=observation slug=build-slice-advance-may-waste-a-build-before-losing-at-inner-claim-2026-06-19 allAnswered=false -->

## Q1

**Triage disposition for this observation: keep as a live design signal documenting an accepted marginal residual, or route otherwise?**

> The note documents that two concurrent registry-set advance batches over the same mirror can, in a narrow stale-`main` photo-finish window, both build the same item — the loser wastes a build before losing cleanly at the non-fast-forward integrate (no double-LAND; one-slug-one-folder holds). The 2026-06-20 triage update concludes: (a) eligibility ALREADY subtracts held locks (`scan.ts` filters `heldSlugs`), so the wide hole is closed; (b) the 'keep the lock past terminal' fix is REJECTED because it duplicates the durable `done/` record's job and fights the lock-GC recovery model; (c) a claim-time terminal recheck in `claim-cas.ts` would shrink the photo-finish further but cannot close it, and is judged a micro-optimization of debatable value on an already-rare event. The author explicitly says 'recorded so it is not re-litigated, deliberately NOT promoted to a task. The note stays as a live design signal documenting the accepted residual cost.' No open sub-questions remain; the residue is just the terminal routing call.

_Suggested default: keep — accept the triage update's conclusion: leave as a live design signal of an accepted residual, do not promote to a slice or ADR._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP as a live design signal documenting an accepted marginal residual. Verified: the wide eligibility hole is already closed in code (scan eligibility subtracts held-lock slugs via `heldSlugs`), so only the narrow photo-finish residual remains — one wasted build when two builders pass eligibility in the same instant and one loses at the inner claim CAS. No correctness loss (one-slug-one-folder holds; no double-LAND), the event is rare, and a claim-time terminal recheck would shrink but not close the window. The residual is explicitly accepted; no open sub-questions remain. Disposition: keep.
