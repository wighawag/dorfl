<!-- dorfl-sidecar: item=observation:review-nits-adr-land-primitive-rebase-reverify-advance-2026-06-26 type=observation slug=review-nits-adr-land-primitive-rebase-reverify-advance-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this signal — the three non-blocking nits raised by Gate 2 on the merged 'adr-land-primitive-rebase-reverify-advance' ADR? Specifically: (a) the ADR-filename deviation from ADR-FORMAT.md (slug-only vs. NNNN-slug), (b) the slug shortening from the prd's working title, and (c) the forward-reference drift where the ADR's §Consequences / §Cross-references phrase the WORK-CONTRACT.md / CLAIM-PROTOCOL.md invariant line as already pointing at the ADR, while the protocol-doc edit actually lives in a sibling ready task (protocol-land-time-reverify-invariant). Should any of these be promoted to a task, folded into the existing sibling task, fixed in place, or deleted as accepted-as-recorded?**

> Source: work/notes/observations/review-nits-adr-land-primitive-rebase-reverify-advance-2026-06-26.md (status: open, reviewOf: adr-land-primitive-rebase-reverify-advance). It records Gate 2 APPROVE + three non-blocking nits:
>   1. ADR filename uses slug-only house style (docs/adr/land-primitive-rebase-reverify-advance.md) deviating from work/protocol/ADR-FORMAT.md's prescribed 0001-slug.md sequential numbering, matching the existing docs/adr/ convention. The ADR's 'In-scope decisions' block already ratifies this.
>   2. Slug shortened from the prd's working title 'land-is-rebase-reverify-advance-one-primitive-two-frontends' to the task-declared 'land-primitive-rebase-reverify-advance'. The ADR's in-scope decisions ratifies this and full framing is kept in title + §3.
>   3. Forward-reference drift: §Consequences and §Cross-references phrase the invariant line as already pointing at the ADR, but WORK-CONTRACT.md / CLAIM-PROTOCOL.md don't yet contain it — that edit lives in sibling ready task 'protocol-land-time-reverify-invariant'.
> Reality check: docs/adr/ does follow slug-only style across all existing files (matches house convention, contradicts ADR-FORMAT.md template). The sibling task 'protocol-land-time-reverify-invariant' exists and is the natural home for nit (c).

_Suggested default: Delete the observation as fully discharged: (1) and (2) are already ratified in the ADR's in-scope decisions block — accepted-as-recorded, no follow-up needed (and if the ADR-FORMAT.md template should change to match the slug-only house style, that is a separate observation to file against ADR-FORMAT.md, not against this ADR). (3) is already covered by the sibling ready task 'protocol-land-time-reverify-invariant' which will land the invariant line in the protocol docs — no new task is needed; optionally add a one-line forward-reference note in that task's body so the integrator knows it discharges this nit._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
