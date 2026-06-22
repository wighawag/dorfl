<!-- agent-runner-sidecar: item=observation:review-nits-review-protocol-doc-and-shared-machinery-2026-06-22 type=observation slug=review-nits-review-protocol-doc-and-shared-machinery-2026-06-22 allAnswered=false -->

## Q1

**Should a follow-up slice sweep away the `SliceReviewVerdict` / `LoneSliceReviewVerdict` type aliases (and rename callers to use the unified `ReviewVerdict`), or are the aliases an acceptable permanent soft landing?**

> Gate 2 review nit: the slice's acceptance line said 'the old SliceReviewVerdict type is removed', but the agent kept `export type SliceReviewVerdict = ReviewVerdict` (slicer-review-loop.ts:100) and `export type LoneSliceReviewVerdict = ReviewVerdict` (intake.ts:1917) so existing tests/callers keep compiling. Shape and parser ARE unified; only the names persist.

_Suggested default: keep — aliases are non-load-bearing and removing them is pure churn; close this nit_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP — the `SliceReviewVerdict` / `LoneSliceReviewVerdict` aliases are an acceptable permanent soft landing. The shape and parser ARE unified; only the names persist, and removing them is pure rename churn with no behaviour change. (Note the acceptance line said the type was "removed" while the NAME persists — a letter-vs-spirit gap worth acknowledging, not reopening.) Disposition: keep.

## Q2

**Should the unauthorised `parseSliceReviewVerdict` / `parseLoneSliceReviewVerdict` parser aliases be swept away (callers migrated to the single `parseReviewVerdict`), or accepted as backwards-compat re-exports alongside the type aliases?**

> Gate 2 review nit: the slice asked for ONE parser used by all four sites, but the agent added `export {parseReviewVerdict as parseSliceReviewVerdict}` (slicer-review-loop.ts:28) and `export const parseLoneSliceReviewVerdict = parseReviewVerdict` (intake.ts:2273) purely so the test suite's existing imports keep working. Same shape/behaviour, just alias names.

_Suggested default: keep — same disposition as the type aliases; bundle any future cleanup with that one_

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):

KEEP — same disposition as the type aliases. The parser is genuinely unified (one `parseReviewVerdict`); the `parseSliceReviewVerdict`/`parseLoneSliceReviewVerdict` aliases are import-compat re-exports only. Bundle with Q1 if ever cleaned up. Disposition: keep.

## Q3

**Is the indirect coverage of the setup-skill propagation sufficient, or should a follow-up slice add a test that invokes the setup skill on a fresh target repo and asserts `work/protocol/` lands with the new doc?**

> Gate 2 review nit: there is no dedicated setup-skill test exercising end-to-end propagation into a target repo. Acceptance is met indirectly via `packages/agent-runner/test/review-protocol-doc.test.ts` which asserts THIS repo's `skills/setup/protocol/` ↔ `work/protocol/` byte-identity plus a VERSION bump beyond 2026-06-09 (this repo is both author and user of the protocol per AGENTS.md).

_Suggested default: promote-slice — a small setup-execution test closes a real gap (the mirror test cannot catch a broken setup copy step)_

<!-- q3 fields: id=q3 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice — add a setup-skill end-to-end propagation test. This is a genuine (non-churn) coverage gap: the existing mirror test only asserts `skills/setup/protocol/` ↔ `work/protocol/` byte-identity WITHIN this repo, which structurally CANNOT catch a broken setup COPY step into a fresh target repo. A test that invokes the setup skill on a throwaway target and asserts `work/protocol/` lands with the new doc closes it. Disposition: promote-slice.

## Q4

**Should a follow-up retroactively add a `## Decisions` block to the integration record (or future PR template enforcement) capturing the alias-instead-of-removal choice, the new `resolveReviewProtocolPath` helper, and the shared `verdictContractPrompt` with per-builder 'do NOT fill' instructions — or is recording them only in this observation enough?**

> Gate 2 review nit: `git log -1 fdb802f` shows only the slug/title line, no Decisions block. Three in-scope decisions were made by the agent without explicit human ratification: (1) keep type/parser aliases instead of deleting, (2) introduce `resolveReviewProtocolPath` thin helper, (3) shared `verdictContractPrompt` enumerating ALL channels with per-builder 'do NOT fill' instructions.

_Suggested default: keep — the decisions are now durably captured HERE (the observation); explicit ratification by reading this nit list is sufficient, no slice needed_

<!-- q4 fields: id=q4 disposition=keep -->

**Your answer** (write below this line):

KEEP — recording the three decisions HERE (the observation) is sufficient; no retroactive `## Decisions` block needed. The decisions (alias-instead-of-removal, the `resolveReviewProtocolPath` helper, the shared `verdictContractPrompt` with per-builder "do NOT fill" instructions) are real and verified, and this observation is an adequate durable record. Part of the recurring pattern captured in the meta-observation. Disposition: keep.
