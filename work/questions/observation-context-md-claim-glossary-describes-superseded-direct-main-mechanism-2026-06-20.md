<!-- dorfl-sidecar: item=observation:context-md-claim-glossary-describes-superseded-direct-main-mechanism-2026-06-20 type=observation slug=context-md-claim-glossary-describes-superseded-direct-main-mechanism-2026-06-20 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a task (rewrite the glossary entry), keep watching, or drop?**

> The observation flagged CONTEXT.md's `claim (CAS)` glossary entry (~L40) as still describing the SUPERSEDED `backlog → in-progress` direct-`main` micro-commit claim, after the per-item-lock-refs migration landed (ADR `ledger-status-on-per-item-lock-refs`; tasks `claim-acquires-unified-lock-no-body-move`, `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`).
>
> The item carries an `## Applied answers 2026-06-22` block answering its own q1: re-verifying CONTEXT.md shows the `claim (CAS)` glossary entry now describes the per-item-lock-ref model ("acquiring an item's per-item lock … the claim writes NOTHING to `main`") and the needs-attention/status entries already say the transient states are "NO LONGER folders". No `direct-main micro-commit` / `ledger-transition seam` text remains to rewrite — the load-bearing premise is overtaken by events.
>
> Frontmatter still has `status: spotted` and the file is still in `work/notes/observations/`, so the engine needs an explicit triage disposition to route it to a terminal state. Sibling note `claim-sh-still-describes-superseded-direct-main-claim` was already discharged 2026-06-20.

_Suggested default: dropped — overtaken by events; CONTEXT.md no longer contains the superseded text the observation targeted, per the item's own applied-answers re-verification. Reason (for the item body): `superseded by current CONTEXT.md state`._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

dropped (reason: superseded by current CONTEXT.md state). The `claim (CAS)` glossary entry now describes the per-item-lock-ref model (the claim writes nothing to `main`); no `direct-main micro-commit` / ledger-transition-seam text remains to rewrite, per the item's own applied-answers re-verification.
