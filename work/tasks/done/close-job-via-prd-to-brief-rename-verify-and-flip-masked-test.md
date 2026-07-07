## Context

Surfaced by the 2026-06-25 sidecar rebuild sweep (see
`work/notes/observations/sidecar-rebuild-sweep-findings-2026-06-25.md`,
group B — the ONLY finding flagged "highest-value non-cosmetic" in the sweep).
The rebuilt sidecar for
`observation:close-job-via-prd-code-literal-vs-renamed-brief-field` reports
that the supposedly-done `prd` -> `brief` rename of the close-job `via`
discriminator is ABSENT in code, while a green unit test is masking the gap:
`close-job.test.ts:225-226` asserts `toBe('prd')` and passes precisely because
the code still emits `'prd'`.

The parent rename brief is
`code-identifier-slice-prd-to-task-brief-rename` — this task is a small
re-open under it, NOT a new direction.

Human decision (recorded on the source observation, 2026-07-07): mint this
small fix-and-flip task immediately, and verify the gap on current `main`
FIRST before trusting the surface agent's file:line claims (main keeps moving).

## Scope

One unit: rename the discriminator AND flip the masking assertion in the
same commit so the test is never green against the wrong literal.

Production code (verify each site against current `main` before editing):

- `packages/dorfl/src/close-job.ts` — the `via` field `type` / literals, the
  `cand.via === 'prd'` branch, and `closeComment` wording that embeds the
  token.
- `packages/dorfl/src/frontmatter.ts` `resolveClosingIssue` — the upstream
  producer of the `via: 'prd'` value (the full `via` / `prd:` lineage the
  sidecar calls out).
- Any other call site the two above touch — grep for the string literal
  `'prd'` in the `via` context and for `prd:` frontmatter keys tied to close.

Tests:

- `packages/dorfl/test/close-job.test.ts:225-226` — flip `toBe('prd')` to
  `toBe('brief')` in the SAME commit as the code rename. This is the
  load-bearing part: the test is currently masking the gap, so the flip is
  what makes the rename actually verified.
- Sweep the rest of `close-job.test.ts` (and any sibling test) for the same
  literal / fixture text.

Out of scope: any wider `prd` -> `brief` / `task` vocabulary rename beyond the
close-job `via` lineage. Groups A, C, D, E, F from the sweep-findings note are
tracked separately by the human.

## Acceptance

- `rg "via.*'prd'" packages/dorfl/src` and `rg "'prd'" packages/dorfl/src/close-job.ts packages/dorfl/src/frontmatter.ts` return no `via`-context hits.
- `close-job.test.ts` asserts `toBe('brief')` (or the agreed replacement token) on the discriminator, and the suite is green.
- `pnpm -r build && pnpm -r test && pnpm format:check` passes.
- The commit message notes this closes the `close-job-via-prd-code-literal-vs-renamed-brief-field` observation and cross-references the sidecar-rebuild-sweep note as the source.

## Notes

- Re-verify the sidecar's file:line claims against current `main` FIRST; if
  the gap has already been closed by another task in-flight, cancel this task
  as already-delivered and record that on the source observation.
- Keep the code rename and the test flip in ONE commit so no intermediate
  state has a green-but-wrong assertion.

## Prompt

> Build the task 'close-job-via-prd-to-brief-rename-verify-and-flip-masked-test', described above.
