---
needsAnswers: true
---

# work-layout-guard.test.ts flakes under full parallel `pnpm -r test`

2026-06-22. During the `rename-config-keys-slicing-to-tasking` task, one full
`pnpm -r test` run reported a single failure in
`test/work-layout-guard.test.ts > NO src/ file except work-layout contains a raw
work/<folder> path literal`, while every other run (and the test in isolation, 3x)
passed (2585/2585). The guard reads the `src/` tree at runtime; under heavy
parallel load it appears to transiently misread, like the already-noted
`fresh-worktree-gate-test-gatesandboxcount-flaky-under-parallel-load`. Likely a
test-isolation/ordering flake, not a real violation (the rename added only
doc-comment prose + value-enum strings, no new `work/<folder>` path literals).
Out of scope for the config-key rename; captured for whoever hardens the suite.

## Applied answers 2026-07-07

### q1: What becomes of this signal: keep it as a watch-item, promote it to a serialise/isolate test-hardening slice, or drop it?

Keep as a watch-item. This matches the repo's settled recurrence-based bar (KEEP on first sighting; promote a serialise/isolate slice only on recurrence) and this single first sighting has no identified race mechanism (the test reads a fixed SRC_DIR with no shared mutable state), so it is below the promotion threshold and weaker even than its cited sibling. Do not promote a slice now. If it flakes again under parallel load, promote a test-hardening slice then, and capture whether a clean `pnpm -r build` preceded the failing run (a mid-edit stale-build cause is at least as plausible as a true race).

## Applied answers 2026-07-07

### q1: What becomes of this signal: keep it as a watch-item, promote it to a serialise/isolate test-hardening slice, or drop it?

Keep as a watch-item. Matches the repo's settled recurrence-based bar (KEEP on first sighting; promote a serialise/isolate slice only on recurrence), and this single sighting has no identified race mechanism (the test reads a fixed SRC_DIR, no shared mutable state), so it is below the promotion threshold. Do not promote now. If it flakes again under parallel load, promote a test-hardening slice then, capturing whether a clean `pnpm -r build` preceded the failing run.

Keep as a watch-item. This matches the repo's settled recurrence-based bar (KEEP on first sighting; promote a serialise/isolate slice only on recurrence) and this single first sighting has no identified race mechanism (the test reads a fixed SRC_DIR with no shared mutable state), so it is below the promotion threshold and weaker even than its cited sibling. Do not promote a slice now. If it flakes again under parallel load, promote a test-hardening slice then, and capture whether a clean `pnpm -r build` preceded the failing run (a mid-edit stale-build cause is at least as plausible as a true race).

### q2: The answer says 'Keep as a watch-item' — but this observation currently has `needsAnswers: true` in its frontmatter and no explicit 'watch-item' status marker. Concretely, how should the engine record 'keep as watch-item'? Options: (a) Just flip `needsAnswers: true` → `false` (or remove it) and leave the body + answer in place, so the file stays in place as an answered observation that lives on until recurrence promotes it. (b) Same as (a) but also append a short trailing note to the body (e.g. a `## Resolution` / `## Disposition` block) recording the watch-item decision + the recurrence-trigger criteria (flake again under parallel load → promote hardening slice; capture whether a clean `pnpm -r build` preceded the failing run) so a future reader doesn't have to reconstruct the bar from the Q&A. (c) Something else (e.g. move it to a different folder, add a specific status field you use elsewhere). I'd default to (b) since the answer contains real forward-looking guidance (promotion trigger + stale-build hypothesis to capture) that would be lost if we only cleared the flag — but I don't want to invent a convention. Which of (a)/(b)/(c) do you want, and if (b) or (c), what exact heading/field should I use?

Option (b): flip `needsAnswers: true` -> `false` AND append a short `## Disposition` block to the body recording the watch-item decision + the recurrence trigger (flake again under parallel load => promote a hardening slice; on recurrence capture whether a clean `pnpm -r build` preceded the failing run). Use the heading `## Disposition`. The forward-looking guidance (promotion trigger + stale-build hypothesis) is real and would be lost if we only cleared the flag. This is the KEEP disposition: retain the file, record the decision, don't delete. (Same underlying gap as the recovery-complete Q2: {task,prd,adr,delete,ask} has no first-class KEEP outcome; encode it as clear-needsAnswers + a `## Disposition` note.)
