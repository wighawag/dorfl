<!-- dorfl-sidecar: item=observation:prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10 type=observation slug=prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10 allAnswered=false -->

Item: [`observation:prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10`](../notes/observations/prd-to-spec-4d-migrate-emit-sites-inserted-contract-sidecar-filepath-carveout-2026-07-10.md)

## Q1

**What becomes of this observation now that its ratified option-A moves have landed — delete it, or promote its 'Lesson' section into work/notes/findings/ as a reusable rule (producer/consumer cutover coupling, and separating a value's TYPE identity from its on-disk FILE identity)?**

> All four decision-carrying tasks are in work/tasks/done/: rename-spec-namespace-emit-sites-and-local-unions (the inserted 4d), rename-spec-residual-exported-symbols-and-prdslandIn-plumbing (4e), contract-spec-hard-cutover-rejection-and-leak-scan, and the intake CLI/verdict-key renames. The observation's operational content is therefore discharged. Its residue is the 'Lesson (the reusable one)' block: (1) a namespace/enum-value cutover is TWO jobs — widen CONSUMER === checks AND flip PRODUCER emit-sites + local union defs; the alias hides un-flipped producers so a coverage audit that only asks 'does it stay green' misses them; (2) when the value also keys an on-disk FILE (sidecar/lock), the file-path alias must outlive the type-value cutover and belongs to the data-migration command. Grep of work/notes/findings/ shows no existing finding captures either rule.

_Suggested default: Promote the 'Lesson' block to work/notes/findings/producer-consumer-cutover-and-file-path-vs-type-identity.md (concise, decoupled from the specific 4d/4e episode), then delete this observation and its provenance-companions once the finding lands._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote the Lesson, then delete the note. The ratified option-A moves have landed, so the operational residue is discharged. Fold the durable lesson (producer/consumer cutover coupling, and separating a value's TYPE identity from its on-disk FILE identity) into a single shared cutover-lessons note under work/notes/findings/ (together with the sibling 4e C-audit lesson), then delete this observation. Do NOT mint a standalone ADR for it.
