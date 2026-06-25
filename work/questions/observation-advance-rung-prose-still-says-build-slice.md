<!-- dorfl-sidecar: item=observation:advance-rung-prose-still-says-build-slice type=observation slug=advance-rung-prose-still-says-build-slice allAnswered=false -->

## Q1

**This observation flagged residual `build/slice` rung-naming prose drift on the advance-rung surface and asked for it to be folded into an "advance-rung prose sweep". Re-checked against current reality, the flagged drift appears already remediated: the string `build/slice` (and `build-slice`) no longer appears in ANY `.ts` file in the repo. The specific site it named, `advance-treeless-publish.ts` ~L168, now reads "The build/task rungs are NOT here" (the rename already landed), and the named test files (`advance.test.ts`, `advancing-lock.test.ts`, `advance-registry-set.test.ts`, `advance-in-place-publishes-treeless-results.test.ts`, `advance-isolated.test.ts`) no longer carry `build/slice` rung prose. What becomes of this signal: delete it as already-fixed (no task), or do you want a verification/sweep task minted to formally confirm the whole advance-rung prose surface is clean (since there is no green test asserting the absence of `build/slice` prose) before discarding?**

> Source: work/notes/observations/advance-rung-prose-still-says-build-slice.md (needsAnswers: true; no `## Open questions` block, no pre-existing sidecar — so the only residue is the native observation-triage question). The observation named: advance-treeless-publish.ts ~L168 ("The build/slice rungs are NOT here") plus advance.test.ts, advancing-lock.test.ts, advance-registry-set.test.ts, advance-in-place-publishes-treeless-results.test.ts, advance-isolated.test.ts. Verification run now: `grep -rn 'build/slice'` over the repo's `.ts` files returns ZERO matches; advance-treeless-publish.ts L168 reads "The build/task rungs are NOT here"; the only remaining `slice` tokens in advance `.ts` files are unrelated (the `auto-slice` test-fixture slug, the observation-slug literal `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`, the `autoslice` gate name, and a `.slice(2)` string call). The rung tokens themselves (`build-slice`->`build-task`) were already renamed in advance-classify.ts per the observation's own note.

_Suggested default: Delete the observation as already-remediated (the flagged `build/slice` rung prose is gone from all `.ts` files); no follow-up task needed unless you want a formal absence-asserting verification first._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
