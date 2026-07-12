<!-- dorfl-sidecar: item=observation:prd-to-spec-identity-layer-needs-expand-first-not-hard-swap type=observation slug=prd-to-spec-identity-layer-needs-expand-first-not-hard-swap allAnswered=false -->

Item: [`observation:prd-to-spec-identity-layer-needs-expand-first-not-hard-swap`](../notes/observations/prd-to-spec-identity-layer-needs-expand-first-not-hard-swap.md)

## Q1

**What becomes of this signal? The concrete remediation (insert expand-first task, rechain batches 2/3/4 as additive-migrate, extend contract batch to remove aliases) has already been applied and the corresponding tasks (expand-spec-frontmatter-and-namespace-aliases, rename-spec-config-and-intake, contract-spec-hard-cutover-rejection-and-leak-scan) are in tasks/done — leaving only the DURABLE lesson: review didn't catch that a hard-swap batch of NON-indirected identifiers can't compile in isolation. Should this be (a) promoted to a spec/ADR that adds a review lens 'for a wide-refactor task chain, verify each batch is either indirected-safe or expand-first' complementary to TASKING-PROTOCOL §3a; (b) folded as an inline addition into REVIEW-PROTOCOL.md's lens list without a spec; or (c) discharged by deletion because §3a already codifies the rule at the tasking side and the reviewing-side gap is judged acceptable?**

> The observation is a retrospective on batch 2 of the spec→spec cutover. Fix already applied (expand-first task inserted; chain rewritten). TASKING-PROTOCOL.md §3a already codifies expand→migrate→contract for wide refactors, but the residual lesson is on the REVIEW side: no lens currently asks 'is each hard-swap batch indirected (safe alone) or non-indirected (needs expand-first)?' The signal's remaining value is that review-lens gap. Files: work/notes/observations/prd-to-spec-identity-layer-needs-expand-first-not-hard-swap.md; work/protocol/TASKING-PROTOCOL.md §3a; work/protocol/REVIEW-PROTOCOL.md.

_Suggested default: (b) fold a short lens into REVIEW-PROTOCOL.md ('for a wide-refactor task chain, check each batch is either indirected-safe or preceded by an expand task') and then delete the observation — the concrete remediation is already landed, so a full spec/ADR is overkill and pure deletion loses the review-side lesson._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Option (b): fold the review lens inline into REVIEW-PROTOCOL.md's lens list ('for a wide-refactor task chain, verify each batch is either indirected-safe or expand-first'), without a spec/ADR. The concrete remediation has already landed (expand-first task inserted, batches rechained, aliases removed; the three tasks are in tasks/done), so only the durable review-side lesson remains, and TASKING-PROTOCOL §3a already codifies the tasking-side rule, so a lightweight complementary review lens is the proportionate home.
