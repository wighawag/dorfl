<!-- dorfl-sidecar: item=task:git-integration-tests-time-out-under-parallel-load-2026-06-24 type=task slug=git-integration-tests-time-out-under-parallel-load-2026-06-24 allAnswered=false -->

## Q1

**Should these git-integration tests carry a higher per-test `testTimeout`, or should the suite cap parallelism, so a loaded CI box does not flake them?**

> Pre-existing open question carried over verbatim from `work/tasks/ready/git-integration-tests-time-out-under-parallel-load-2026-06-24.md` `## Open questions` (1). Symptom: under full `pnpm -r test` (~230s wall, 765s cumulative), `packages/dorfl/test/complete-self-renaming-folder-task.test.ts:160` (DIRTY-CONTINUE) and `packages/dorfl/test/do-isolated.test.ts:445` (SEQUENTIAL-REFETCH FRESHNESS drain) hit `Test timed out in 5000ms`; running just those two files in isolation passes 17/17 in ~5s — i.e. parallel-load CPU starvation of the default 5000ms per-test timeout, not a logic defect. The two levers are not equivalent: bumping `testTimeout` on the offending files is a local, surgical fix that keeps overall suite parallelism (so wall time stays low) but lets a genuinely slow regression hide behind a longer ceiling; capping vitest parallelism (e.g. `poolOptions.threads.maxThreads`) is global and slows every CI run for everyone to protect two git-heavy tests. A third option the task does not name — marking just these tests sequential / tagging them onto a serial pool — is also on the table.

_Suggested default: Raise `testTimeout` on the two git-integration files only (file-local `vi.setConfig({ testTimeout: 20000 })` or per-test override), and leave global parallelism untouched — smallest blast radius, matches the diagnosis (CPU starvation, not logic), and the human can revisit if a third file joins the pattern._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**The `## What to build` section is empty and there is no `## Prompt` block — what is the acceptance criterion / self-contained build prompt for this task?**

> Review lens 3 (cross-artifact composition / contract conformance) on `work/tasks/ready/git-integration-tests-time-out-under-parallel-load-2026-06-24.md`: WORK-CONTRACT requires a task's `## Prompt` to be self-contained (an agent could start from the file alone) and includes the drift-check. This file has only `## What was seen` and `## Open questions`; `## What to build` is present-but-empty and there is no `## Prompt`. As written, a fresh-context builder cannot tell which files to edit, what timeout value / parallelism cap is acceptable, or how to verify the fix beyond `pnpm -r test` not flaking. This is a blocking spec-shape defect — and it compounds with the timeout-vs-parallelism question above (the answer to that one is the missing spec).

_Suggested default: Once the timeout-vs-parallelism question is answered, fill `## What to build` with the concrete change (file paths + the chosen lever + value) and add a `## Prompt` that names the two failing test files, the chosen mechanism, and the verification (`pnpm -r test` green across N consecutive runs on a loaded box)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**This task is in `tasks/ready/` with `needsAnswers: true` — is that intentional, or should it move to `tasks/backlog/` (or `needs-attention`) until the open question is answered?**

> Review lens 3 (contract conformance) / WORK-CONTRACT: `status = folder` and `needsAnswers: true` means the task is not claim-ready — a builder claiming from `ready/` would hit the unanswered question immediately. The file is currently at `work/tasks/ready/git-integration-tests-time-out-under-parallel-load-2026-06-24.md` with `needsAnswers: true` in its frontmatter. Either the folder is wrong (should not be in `ready/`) or `needsAnswers` is wrong (the question is actually resolved). Orientation-only — the engine, not this skill, performs the `git mv`.

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
