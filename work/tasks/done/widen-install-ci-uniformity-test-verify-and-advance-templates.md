## Context

During Gate-2 review of `install-ci-prefer-project-local-dorfl` a non-blocking nit was raised: the uniformity test in `test/install-ci.test.ts` currently pins only three capability templates (`advance-lifecycle`, `intake`, `close-job`) against absolute or local-only `dorfl` invocation paths. Two other capability templates also emit `dorfl` invocations via the shared `dorfl-setup` action and are currently unguarded:

- `verify-workflow-template` — emits `dorfl verify`
- `advance-ci-template` — emits `dorfl scan --json` and `dorfl advance …`

This is a real coverage gap: a future edit could reintroduce an absolute or workspace-local path in either template and the test suite would not catch it. The other two nits from the review were resolved separately (nit 1 folded into the standing `decisions-block-convention-repeatedly-skipped` RELAX observation; nit 3 ratified — the resolver shim step is intentionally appended unconditionally in both registry and workspace install modes, covered by the workspace-mode ordering test).

## Goal

Extend the existing uniformity assertion in `test/install-ci.test.ts` so the `capabilities` array (or equivalent parametrisation) also includes `verify-workflow-template` and `advance-ci-template`, applying the same absolute-/local-only-path guard that the current three templates receive.

## Acceptance

- `test/install-ci.test.ts` exercises the uniformity guard against all five capability templates that emit `dorfl` invocations: `advance-lifecycle`, `intake`, `close-job`, `verify-workflow-template`, `advance-ci-template`.
- The new assertions pass on `main` as-is (no production code change expected — this is closing a test gap, not fixing a bug).
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Notes

- Keep the change minimal: reuse the existing parametrised assertion; do not restructure the test file.
- No `## Decisions` block required — mechanism is settled; this is straightforward coverage widening.
- On completion, the parent observation `observation:review-nits-install-ci-prefer-project-local-dorfl-2026-06-27` is deleted (nit 3's ratification is recorded in that observation's answer history and rides along with the deletion).

## Prompt

> Build the task 'widen-install-ci-uniformity-test-verify-and-advance-templates', described above.
