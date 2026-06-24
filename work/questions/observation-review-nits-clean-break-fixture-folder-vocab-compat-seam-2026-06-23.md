<!-- dorfl-sidecar: item=observation:review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 type=observation slug=review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking Gate-2 nits on 'clean-break-fixture-folder-vocab-compat-seam' (the cosmetic 'slicing'->'tasking' rename in three test files, and the missing '## Decisions' block on the PR)?**

> The observation already carries an Applied answer dated 2026-06-24 (q1 → disposition: delete) and a 'Recommended: delete' footer, with `needsAnswers: false` in the front-matter. Both nits are cosmetic/retrospective on a landed, approved PR:
>  - The 'slicing'->'tasking' literal rename in test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, test/ledger-read.test.ts:103 is verified correct — the probes are `.toBe(false)` absence assertions that pass regardless of the literal, matching the gitRepo.ts JSDoc note about 'the retired transient tasking marker some readers still probe for ABSENCE'.
>  - The missing '## Decisions' block is on already-merged commit 17e768b which cannot be retro-edited; the general 'prefer a Decisions block for non-obvious naming' signal is PR-authoring hygiene carried by reviewer habit, not a durable open observation.
> No follow-up code is implied; the capture-bucket contract leaves the actual file deletion to a human.

_Suggested default: delete (ratify the already-applied human answer; no follow-up task, no ADR — git history is the archive)_

<!-- q1 fields: id=q1 disposition=delete -->

**Your answer** (write below this line):

delete. Ratify the already-applied human answer: the two Gate-2 nits (cosmetic 'slicing'->'tasking' in three test files + missing `## Decisions` block on a landed PR) need no follow-up task and no ADR. Git history is the archive.
