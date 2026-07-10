## Context

Gate 2 approved `route-answered-observation-sidecar-to-apply-pool` (now in `work/tasks/done/`) with three non-blocking review nits. The source task is DONE — do NOT re-edit its file. Address all three nits here in a single cohesive follow-up.

Background: an answered observation sidecar routes the observation into the apply pool. The canonical rule established (and encoded by a test) is: **an answered sidecar wins even when the observation body carries a `triaged:` settled marker** — a human's answer must never be stranded.

Relevant files from the source change:
- `packages/*/lifecycle-pools.ts` (new apply branch; trailing comment `// else: SETTLED (triaged:) with no answered sidecar — NOT enumerated.`)
- `lifecycle-pools.test.ts` (has the test `an ANSWERED sidecar wins even when the observation is ALSO triaged:`)
- `advance-autopick-lifecycle-mirror.test.ts` (classifier + mirror-gather parity)
- No end-to-end test was added for the answered-observation apply path (acceptance criterion (c) gap).

## Scope — do all three

### (a) Record the "answered sidecar wins over `triaged:` marker" decision

Ratify and record the decision that an answered observation sidecar dominates a settled (`triaged:`) marker in apply routing. The source task file has no `## Decisions` block and is done — so record this decision in an ADR under `docs/adr/` instead (e.g. `answered-observation-sidecar-dominates-triaged-marker.md`). The WHY: a human answer must never be stranded; if a human answered the observation's questions, that answer routes to apply even if the body was independently marked `triaged:`. The behaviour is already encoded by the test `an ANSWERED sidecar wins even when the observation is ALSO triaged:` in `lifecycle-pools.test.ts` — cite it from the ADR.

### (b) Add the missing end-to-end test for acceptance criterion (c)

Acceptance criterion (c) of the source task was: "end-to-end apply of a fully-answered observation produces the decided artifact and removes source+sidecar". The diff only added classifier + mirror-gather parity tests; no test exercises the full classifier → apply → agentic-decide chain end-to-end for an observation.

Add one throwaway-git-repo E2E test (in the style of the existing `triage-persist` / `apply-persist` tests) that:
1. Sets up an observation in `work/observations/` with a fully-answered sidecar.
2. Runs the classifier → apply → agentic-decide pipeline.
3. Asserts the decided artifact IS produced (e.g. task/ADR/SPEC/delete outcome materialises correctly).
4. Asserts BOTH the source observation file AND its sidecar are removed after apply.

### (c) Convert the trailing comment into a real dropped-item assertion

In `lifecycle-pools.ts`, the branch handling SETTLED (`triaged:`) observations with a PENDING (not-yet-answered) sidecar currently just carries the trailing comment `// else: SETTLED (triaged:) with no answered sidecar — NOT enumerated.` User-visible behaviour is unchanged (a pending sidecar was invisible before too), but a future reader might think pending-sidecar-on-settled-observation should re-surface.

Replace the bare comment with a real one-line dropped-item assertion / explicit branch (e.g. an explicit `continue` guarded by a named predicate, or a structured drop record if the module already tracks drops elsewhere) so the intent is codified, not commentary. Keep it a one-liner — don't over-engineer.

## Acceptance

- ADR file exists under `docs/adr/` recording the answered-sidecar-vs-triaged-marker decision with a link to the encoding test.
- New E2E test exists exercising the answered-observation apply path end-to-end and asserting artifact-produced + source+sidecar-removed.
- `lifecycle-pools.ts` SETTLED+pending-sidecar branch is an explicit assertion/statement, not a trailing comment.
- Source task file `work/tasks/done/route-answered-observation-sidecar-to-apply-pool.md` is NOT modified.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

> Build the task 'followup-nits-route-answered-observation-sidecar-to-apply-pool', described above.
