<!-- dorfl-sidecar: item=observation:scan-cwd-selection-pool-read-local-skips-held-lock-subtraction-offline-must-fail-2026-06-27 type=observation slug=scan-cwd-selection-pool-read-local-skips-held-lock-subtraction-offline-must-fail-2026-06-27 allAnswered=false -->

## Q1

**What should become of this observation now that its own body declares both halves shipped and marks it RESOLVED?**

> The note ends with 'Mark RESOLVED when the cwd selection pool subtracts the COORDINATION-arbiter-read held set and offline selection fails closed. (Both halves now done.)' Verified in packages/dorfl/src/cwd-section.ts: lockArbiterRemote defaults to 'origin', heldTaskSlugsStrict is called and subtracted, and the empty-Set hardcoding is gone. Front-matter status is still 'open', so triage has not yet been recorded. Options include: delete the observation as fully discharged; convert to a small ADR capturing the SELECTION=remote+fail-closed / SURFACE=best-effort split and the two-arbiter-axes decision as durable design guidance; or file a follow-up task to add a regression test that scan --json without --arbiter and with a held lock on origin subtracts it.

_Suggested default: Delete — the defect is fixed, verified, and the design decisions are already articulated in-line; if any durable capture is wanted, promote the 'two arbiter axes (coordination vs divergence)' and 'selection fails closed, surface degrades gracefully' split to a short ADR before deleting._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete, the defect is fixed and verified (cwd-section.ts defaults lockArbiterRemote to origin, calls heldTaskSlugsStrict and subtracts, empty-Set hardcoding gone). The design decisions (two arbiter axes: coordination vs divergence; selection fails closed, surface degrades gracefully) are already articulated in-line. I'd skip minting the ADR unless you want the durable design-guidance capture, the in-line comments plus this note are sufficient. So: delete as discharged.
