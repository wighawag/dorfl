<!-- agent-runner-sidecar: item=observation:slicing-pr-has-empty-body-no-summary-comment type=observation slug=slicing-pr-has-empty-body-no-summary-comment allAnswered=false -->

## Q1

**How should this observation be triaged — promote it to a task that threads a composed PR body (and/or posts a summary comment) on the slicing path, keep it open, or drop it?**

> The observation documents a concrete asymmetry: the BUILD path threads `body: agent.output` into `performIntegration` (`packages/agent-runner/src/do.ts:1095` and `:2205`) but the SLICING path's `performIntegration` call in `packages/agent-runner/src/slicing.ts` passes no `body`, so slice PRs (e.g. PR #188) degrade to `gh pr create --fill` and land with an empty body — a human/Gate-3 reviewer sees no summary of which tasks were produced, the coverage map, the dep graph, or the deferred `needsAnswers`.
>
> The item already carries an `## Applied answers 2026-06-22` block where the author resolved both internal questions: q1 = `promote-slice` (fix is well-localised: compose a summary string from slugs/titles/coverage/dep-graph and pass it as `body` in slicing.ts's `performIntegration` call, mirroring the build path); q2 clarified that the Gate-2 `review` prose comment is ALREADY posted via the shared `performIntegration` core (gated on `approvedVerdict?.review !== undefined`) for BOTH callers, so the PR-comment angle is NOT a gap and should NOT expand the slice's scope — keep the fix narrow to body threading.
>
> Front-matter still reads `status: open` and the file still lives under `work/notes/observations/`, so the triage disposition has been DECIDED in-body but not yet ROUTED. The author's `promote-slice` maps to this protocol's `promote-task` (the allowed disposition value — `work/protocol/SURFACE-PROTOCOL.md` lists `promote-task | promote-adr | keep | delete | dropped | needs-attention`; there is no `promote-slice`).

_Suggested default: promote-task — author already resolved triage as `promote-slice` (= promote-task in this protocol's vocabulary) with a well-scoped, narrow fix: thread a composed summary (task slugs + titles, coverage map, dep graph, any carried `needsAnswers`) as `body` into the `performIntegration` call in `packages/agent-runner/src/slicing.ts`, mirroring `do.ts:1095`/`:2205`. Explicitly DO NOT bundle the Gate-2 review-comment concern — q2 confirmed it already posts via the shared core._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
