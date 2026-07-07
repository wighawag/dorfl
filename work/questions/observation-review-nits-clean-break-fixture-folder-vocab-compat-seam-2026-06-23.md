<!-- dorfl-sidecar: item=observation:review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 type=observation slug=review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking Gate-2 nits on 'clean-break-fixture-folder-vocab-compat-seam' (the cosmetic 'slicing'->'tasking' literal rename in three test files, and the missing '## Decisions' block on the landed PR)?**

> Frontmatter still says `status: open` and `needsAnswers: true`, but the body already carries TWO `## Applied answers 2026-06-24` blocks, both with `disposition: delete` and a `## Recommended: delete` footer. The reasoning given there is self-consistent and matches reality:
> - The `slicing`->`tasking` rename is verified cosmetic-only: the probes at test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, test/ledger-read.test.ts:103 are ABSENCE assertions (`.toBe(false)`) that pass regardless of the literal, and `tasking` is not in FIXTURE_WORD_TO_KEY so it passes through unchanged — consistent with the updated gitRepo.ts JSDoc L40-43.
> - The missing `## Decisions` block is on an already-merged commit (17e768b) that cannot be retro-edited. The general 'prefer a Decisions block for non-obvious naming choices' signal is PR-authoring hygiene, not a durable open observation.
> No follow-up code is implied; no ADR is warranted. The only residue is that the sidecar/observation has not yet been physically removed (the capture-bucket contract leaves deletion to the human).

_Suggested default: delete — ratify the already-applied human answer and remove this observation (git history is the archive); no task, no ADR, no follow-up._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. This ratifies the already-applied in-body answer: the `slicing`->`tasking` rename is verified cosmetic-only (absence assertions that pass regardless of the literal), and the missing `## Decisions` block is on an already-merged commit that cannot be retro-edited. No task, no ADR, no follow-up. Remove the observation and its sidecar in one revertible commit.
