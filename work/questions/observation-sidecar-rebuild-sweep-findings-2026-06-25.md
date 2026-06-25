<!-- dorfl-sidecar: item=observation:sidecar-rebuild-sweep-findings-2026-06-25 type=observation slug=sidecar-rebuild-sweep-findings-2026-06-25 allAnswered=false -->

## Q1

**What becomes of this sweep-findings observation — do you want to discharge it directly by acting on the grouped suggestions (B verify-and-fix, A re-task, C text fixes, D discharge sweep, E skill amend) and then delete the note, or keep it as a standing capture and mint the follow-up tasks separately?**

> The note is authored as a standing capture (`needsAnswers: false`, status `spotted`) and explicitly says at the end "This note itself is a standing capture; it does not need a sidecar." Its body is a drift catalogue from the 64/64 sidecar rebuild, grouped A–F by implied action, with concrete suggestions per item. The high-signal items the author flags are:
> - B: a MASKED test gap — `close-job.test.ts:225-226` asserts `toBe('prd')` while the `prd`->`brief` rename is absent in code (cited at `packages/dorfl/src/sidecar.ts:33-35` retirement; lineage spans `frontmatter.ts resolveClosingIssue` + `close-job.ts` + tests). This is the only finding the author calls "highest-value non-cosmetic."
> - A: re-task `task:merge-questions-gate-axis` (and siblings) under the `land-time-reverify-and-parallel-merge-ceiling` PRD, restating `auto` in binary `answered` terms.
> - C: two human-facing prose cleanups (`work/needs-attention/` strings in `do.ts` ~1432/1434/1547/1550/2432/2434 and `cli.ts:3207`; pre-backlog/pre-prd nouns in `needs-attention.ts` ~683/818-869/825/881/1034-1050/1063/1087) — C's second item has an unsettled target noun (`todo` vs live `backlog`/`ready`) that must be confirmed first.
> - D: 9 items the surface agent verified as overtaken-by-events and recommends deleting/cancelling.
> - E: amend `triage-observations` skill to add the pending-questions surface to step 2 and drop the retired disposition-token framing.
> - F: 6+ rebuilds that produced sharp open decisions on still-valid premises (already cleanly surfaced as sidecars; no action implied here).
> Since observations triage to a plain answer (mint task / fold / delete / keep), the human's call drives whether discharge is one batch task, several, or just an in-place keep.

_Suggested default: Mint B as a small fix-and-flip task immediately (verify the close-job `prd`->`brief` rename gap first — it is the only finding called highest-value); fold A into the existing `land-time-reverify-and-parallel-merge-ceiling` re-decompose; do the D discharge sweep by hand (delete/cancel the 9 listed records after re-confirming on current `main`); mint one small text-only task for C after confirming the `todo` vs `backlog`/`ready` target noun against the live tree; mint a tiny skill-amendment task for E; leave F as-is (already surfaced as sidecars). Keep this note as a standing capture (do not delete) since it is the audit record of the 64/64 rebuild and the only place the sweep counts and self-healing behaviour are written down._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
