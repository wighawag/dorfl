<!-- agent-runner-sidecar: item=observation:context-md-claim-glossary-describes-superseded-direct-main-mechanism-2026-06-20 type=observation slug=context-md-claim-glossary-describes-superseded-direct-main-mechanism-2026-06-20 allAnswered=false -->

## Q1

**Is this observation actionable as a slice (rewrite CONTEXT.md's `claim (CAS)` glossary entry — and any sibling 'ledger-transition seam' framing it implies — to match the per-item-lock-refs reality), or should it be folded into a broader CONTEXT.md docs-drift sweep, or dropped?**

> Observation reports that CONTEXT.md ~L40's `claim (CAS)` glossary entry still describes the SUPERSEDED backlog→in-progress direct-`main` micro-commit mechanism, even though the per-item-lock-refs migration landed (ADR `ledger-status-on-per-item-lock-refs`, tasks `claim-acquires-unified-lock-no-body-move` and `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`). Under current reality, claim acquires `refs/agent-runner/lock/<entry>`, the body STAYS in `work/tasks/todo/`, there is no `in-progress/` folder, and claim writes nothing to `main`. The author flags this as a SEPARATE, broader drift than the already-discharged `claim.sh`-retirement sibling, and notes a careful rewrite is warranted (it is load-bearing glossary text, likely touching the 'ledger-transition seam' framing too).

_Suggested default: promote-slice — author already scoped it as a deliberate rewrite of a load-bearing glossary entry (plus likely sibling 'ledger-transition seam' framing), distinct from the discharged `claim.sh` retirement; small focused docs slice._

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

DROP — overtaken by events. The load-bearing premise is no longer true: CONTEXT.md's `claim (CAS)` glossary entry already describes the per-item-lock-ref model ("acquiring an item's per-item lock ... the claim writes NOTHING to `main`"), and the status/needs-attention entries already state the transient states are "NO LONGER folders". No "direct-`main` micro-commit" or "ledger-transition seam" text remains to rewrite. Disposition: dropped.
