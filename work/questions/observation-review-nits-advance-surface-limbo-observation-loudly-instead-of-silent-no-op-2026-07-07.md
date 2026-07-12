<!-- dorfl-sidecar: item=observation:review-nits-advance-surface-limbo-observation-loudly-instead-of-silent-no-op-2026-07-07 type=observation slug=review-nits-advance-surface-limbo-observation-loudly-instead-of-silent-no-op-2026-07-07 allAnswered=false -->

Item: [`observation:review-nits-advance-surface-limbo-observation-loudly-instead-of-silent-no-op-2026-07-07`](../notes/observations/review-nits-advance-surface-limbo-observation-loudly-instead-of-silent-no-op-2026-07-07.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Is this review-nits observation now obsolete because the loud-limbo design it reviewed has been SUPERSEDED by the deterministic 'always ask' base-triage-question contract, and should therefore be discharged (resolve/delete) rather than triaged into a task?**

> All three nits target the OLD detectObservationLimbo path: (a) limbo mapping to outcome usage-error / exitCode 1; (b) limbo detected post-lock burning a fresh-context spawn every tick; (c) missing Decisions block on 6245da2a. But packages/dorfl/src/advance.ts now says explicitly (around L703, L722, L782-783, L850) that there is NO limbo any more — the triage rung ALWAYS passes a deterministic base question to surfaceRung on the first pass, so an untriaged observation can no longer fall through empty-handed. The 'usage-error on limbo' branch and detectObservationLimbo were removed. Nits (a) and (b) therefore ratify a code path that no longer exists; nit (c) is a retrospective PR-hygiene point about a merged commit that cannot be edited. If confirmed obsolete, the honest move is resolve/delete, not promote.

_Suggested default: resolve/delete as obsolete — the reviewed design was replaced by the always-ask base-question contract; the PR-description-Decisions-block nit is retrospective and better addressed as a general convention reminder than as work on this specific PR._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
