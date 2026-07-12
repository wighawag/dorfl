<!-- dorfl-sidecar: item=observation:run-test-claimed-done-flaky-under-full-suite-2026-07-10 type=observation slug=run-test-claimed-done-flaky-under-full-suite-2026-07-10 allAnswered=false -->

Item: [`observation:run-test-claimed-done-flaky-under-full-suite-2026-07-10`](../notes/observations/run-test-claimed-done-flaky-under-full-suite-2026-07-10.md)

## Q1

**What becomes of this signal: keep it as a watch-item, promote it to a serialise/isolate test-hardening slice for run.test.ts, or drop it?**

> work/notes/observations/run-test-claimed-done-flaky-under-full-suite-2026-07-10.md records packages/dorfl/test/run.test.ts:633 (expect(result.items[0].status).toBe('claimed-done')) failing ~1 in 2 under full-suite pnpm -r test, passing 39/39 in isolation. Verified against current reality: (1) The test spawns real throwaway git repos + agents (runOnce with capturingAgent), so genuine resource-contention/timing race under concurrent worker load is a plausible mechanism (unlike the fixed-SRC_DIR sibling work-layout-guard-flake-2026-06-22, whose race had no identified mechanism). (2) This is a member of the repo's established 'green logic, racy under full-suite parallel load' observation family; the settled auto-triage bar (spelled out verbatim in the sibling recursive-test-run-occasional-flake-2026-06-23 sidecar) is KEEP on first sighting, promote a serialise/isolate slice ONLY on recurrence — precedents include run-internal-error->KEEP and the serialise-review-gate / serialise-surface-treeless slices promoted only after recurrence. (3) The observed rate (~1/2) is notably higher than typical members of this family; if the observer's characterisation holds under one more run, that alone may justify earlier promotion than the usual first-sighting KEEP. (4) Author says unrelated to the hard-cutover task's changes (frontmatter parsing / prose / leak-scan) — none touch run orchestration; consistent with flake, not regression.

_Suggested default: KEEP as a watch-item, matching the repo's settled recurrence-based bar and the sibling KEEP precedents. Do not promote a serialise/isolate slice on this single sighting. If run.test.ts flakes again under full-suite parallel load, promote a test-hardening slice then (e.g. describe.sequential around the real-git/real-agent block, or bump timeouts / lower maxParallel for this file), and on next recurrence capture the failing worker's CPU/IO load and whether other real-git-spawning suites ran concurrently, since the ~1-in-2 rate suggests a specific contended resource rather than diffuse jitter._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote to a small test-hardening slice for run.test.ts (serialise/isolate the flaky case). A test that is green in isolation but flaky under the full suite erodes trust in the acceptance gate itself, which is worth a bounded fix rather than leaving as a watch-item.
