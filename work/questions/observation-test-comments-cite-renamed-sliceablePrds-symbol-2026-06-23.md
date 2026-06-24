<!-- dorfl-sidecar: item=observation:test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23 type=observation slug=test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a standalone task that sweeps `sliceablePrds` → `taskableBriefs` and "sliceable PRDs" → "taskable briefs" in the cited test comments/describe-name, or drop it to be folded opportunistically into a future test-prose sweep?**

> Observation `work/notes/observations/test-comments-cite-renamed-sliceablePrds-symbol-2026-06-23.md` reports that the src symbol was renamed `sliceablePrds` → `taskableBriefs` (`packages/dorfl/src/select-priority.ts:111`) but several test comments + one `describe(...)` name still cite the old symbol. Verified against current tree (grep on 2026-06-23):
> - `packages/dorfl/test/scan.test.ts:396` — comment cites `sliceablePrds` (also `:522` cites "sliceable PRDs" prose).
> - `packages/dorfl/test/select-priority.test.ts:54` — `describe('sliceablePrds — consumes autoslice-gate predicate ...')`.
> - `packages/dorfl/test/mirror-pool-scan.test.ts:19,21,25,26,62,63,99,184` — multiple comments, describe/it names cite `sliceablePrds` / "sliceable PRDs".
> The occurrences are in fact slightly broader than the three lines first cited (notably `mirror-pool-scan.test.ts` has live describe/it NAMES, not just comments — making the test output itself misleading, which raises the cost of deferring). Scope is comment/describe-name only — no behaviour change. The author notes the immutable slug `autoslice-gate` must stay verbatim. Surfaced by the Gate-2 review of `rename-residual-slice-test-labels-and-skill-provenance`; distinct from the test-label-tidy / fixture-folder / selection-pool tasks already landed.

_Suggested default: promote-task — the broader-than-first-reported footprint includes live `describe`/`it` NAMES (not just comments) in `mirror-pool-scan.test.ts`, so test output itself reads with a non-existent symbol; a small, self-contained sweep task is cheap and pays for itself in grep/onboarding accuracy. Keep `autoslice-gate` verbatim per the observation._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
