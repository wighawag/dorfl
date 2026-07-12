<!-- dorfl-sidecar: item=observation:prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10 type=observation slug=prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10 allAnswered=false -->

Item: [`observation:prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10`](../notes/observations/prd-to-spec-4e-residual-exported-symbols-inserted-2026-07-10.md)

## Q1

**What becomes of this observation now that batch 4e has already been inserted, executed, and landed (task in work/tasks/done/rename-spec-residual-exported-symbols-and-prdslandIn-plumbing.md)? Options: (a) drop it as a purely historical re-scope note whose action is complete; (b) distill its 'three separate enumerations for a rename cutover coverage audit' lesson (VALUE consumers / VALUE producers / exported SYMBOLS) into a durable lesson or ADR, together with siblings 4d/4f/4g which share the same C-audit single-lens pattern, then drop; (c) keep it in work/notes/observations/ as the archived record.**

> Observation records a spec-chain re-scope: contract task stopped a 2nd time; drift-check found ~7 exported Spec* symbols (renderPrd, buildIntakeDecisionPrd, findPrdPath, promoteFromPrePrd + variants, PrdsLandIn plumbing) that no migrate batch owned. Ratified option A with the human, inserted atomic-migrate batch 4e. Task is now in work/tasks/done/. Sibling observations 4d/4f/4g all point at the same C-audit single-lens blindspot pattern; no consolidated lesson/ADR file exists yet (grep for 'three.*enumeration' / 'C-audit' finds only the observations themselves).

_Suggested default: (b) — the actionable residue is the reusable lesson, not the already-completed re-scope; consolidate across 4d/4e/4f/4g into one lesson/ADR then drop these four observations._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
