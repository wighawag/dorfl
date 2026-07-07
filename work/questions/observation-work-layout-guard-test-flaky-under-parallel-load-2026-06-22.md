<!-- dorfl-sidecar: item=observation:work-layout-guard-test-flaky-under-parallel-load-2026-06-22 type=observation slug=work-layout-guard-test-flaky-under-parallel-load-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal: keep it as a watch-item, promote it to a serialise/isolate test-hardening slice, or drop it?**

> work/notes/observations/work-layout-guard-test-flaky-under-parallel-load-2026-06-22.md (needsAnswers:true, no sidecar yet) records ONE full `pnpm -r test` run failing the `work-layout-guard.test.ts > NO src/ file except work-layout contains a raw work/<folder> path literal` test during the `rename-config-keys-slicing-to-tasking` task; every other run and 3x isolation passed (2585/2585). Verified against current reality:
>
> 1) NOT A REAL VIOLATION. The rename added only doc-comment prose + value-enum strings; the guard (packages/dorfl/test/work-layout-guard.test.ts) strips comments and only flags a literal whose ENTIRE content is a `work/<folder>` path, so prose tokens cannot trip it. Flake, not regression.
>
> 2) FAMILY + SETTLED BAR. This is a named member of the repo's established 'green logic, racy under full-suite parallel load' observation family. The sibling sidecar observation-recursive-test-run-occasional-flake-2026-06-23.md spells out the repo's settled auto-triage bar verbatim: KEEP on first sighting, promote a serialise/isolate slice ONLY on recurrence (precedents: run-internal-error...->KEEP; serialise-review-gate / serialise-surface-treeless slices promoted only after recurrence). By that bar this single first sighting is below the promotion threshold.
>
> 3) WEAKER MECHANISM THAN ITS CITED SIBLING. The note likens it to fresh-worktree-gate-test-gatesandboxcount-flaky, but that sibling had a CONCRETE identified race (a process-wide readdirSync(tmpdir()) scan observing other tests' sandboxes). This test instead reads a FIXED SRC_DIR (join(here,'..','src')) via readFileSync/readdirSync with no shared mutable state, no describe.sequential, so the 'transiently misread under load' hypothesis has no identified mechanism. No work/tasks/ item addresses it.

_Suggested default: KEEP as a watch-item, matching the repo's settled recurrence-based bar and the sibling KEEP precedents. Do not promote a serialise/isolate slice on this single sighting with no identified race mechanism. If the test flakes again under parallel load, promote a test-hardening slice then (and on next recurrence capture whether a clean `pnpm -r build` preceded the failing run, since a mid-edit stale-build cause is at least as plausible here as a true parallel race)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep as a watch-item. This matches the repo's settled recurrence-based bar (KEEP on first sighting; promote a serialise/isolate slice only on recurrence) and this single first sighting has no identified race mechanism (the test reads a fixed SRC_DIR with no shared mutable state), so it is below the promotion threshold and weaker even than its cited sibling. Do not promote a slice now. If it flakes again under parallel load, promote a test-hardening slice then, and capture whether a clean `pnpm -r build` preceded the failing run (a mid-edit stale-build cause is at least as plausible as a true race).

## Q2

**The answer says 'Keep as a watch-item' — but this observation currently has `needsAnswers: true` in its frontmatter and no explicit 'watch-item' status marker. Concretely, how should the engine record 'keep as watch-item'? Options: (a) Just flip `needsAnswers: true` → `false` (or remove it) and leave the body + answer in place, so the file stays in place as an answered observation that lives on until recurrence promotes it. (b) Same as (a) but also append a short trailing note to the body (e.g. a `## Resolution` / `## Disposition` block) recording the watch-item decision + the recurrence-trigger criteria (flake again under parallel load → promote hardening slice; capture whether a clean `pnpm -r build` preceded the failing run) so a future reader doesn't have to reconstruct the bar from the Q&A. (c) Something else (e.g. move it to a different folder, add a specific status field you use elsewhere). I'd default to (b) since the answer contains real forward-looking guidance (promotion trigger + stale-build hypothesis to capture) that would be lost if we only cleared the flag — but I don't want to invent a convention. Which of (a)/(b)/(c) do you want, and if (b) or (c), what exact heading/field should I use?**

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
