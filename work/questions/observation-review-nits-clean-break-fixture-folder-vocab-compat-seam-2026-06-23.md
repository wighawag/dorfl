<!-- dorfl-sidecar: item=observation:review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 type=observation slug=review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking Gate-2 nits on 'clean-break-fixture-folder-vocab-compat-seam' (the cosmetic 'slicing'->'tasking' rename across three test files, and the missing '## Decisions' block on the landed PR)?**

> Observation file: work/notes/observations/review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23.md. Front-matter has needsAnswers: false. The body already carries TWO 'Applied answers 2026-06-24' blocks (the second explicitly ratifying the first) both landing on disposition: delete, with a 'Recommended: delete' note that the human owns the actual file deletion per the capture-bucket contract. Verifying the substance: (a) the 'slicing'->'tasking' rename touches absence assertions (.toBe(false)) in test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, test/ledger-read.test.ts:103 — the probes pass regardless of the literal, so the rename is cosmetic-coherence only and matches gitRepo.ts JSDoc L40-43; (b) the missing '## Decisions' block is on commit 17e768b, already merged and not retro-editable into work/. Neither nit implies follow-up code or an ADR-worthy decision; the general 'prefer a ## Decisions block for non-obvious naming choices' signal is PR-authoring hygiene carried by reviewer habit, not a durable observation. No new open judgement has surfaced since the ratification. Re-surfacing the same triage question keeps the disposition explicit so the engine routes the file to deletion.

_Suggested default: delete — twice-ratified by the human; both nits are cosmetic / retrospective-process on a landed approved PR and need no task or ADR. Git history is the archive._

<!-- q1 fields: id=q1 disposition=delete -->

**Your answer** (write below this line):
