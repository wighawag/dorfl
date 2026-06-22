---
title: review-gate non-blocking nits for 'review-protocol-doc-and-shared-machinery' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: review-protocol-doc-and-shared-machinery
needsAnswers: false
triaged: keep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'review-protocol-doc-and-shared-machinery' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: `SliceReviewVerdict` (and the parallel `LoneSliceReviewVerdict` in `intake.ts`) were NOT deleted as the slice's acceptance line said — they are kept as `export type X = ReviewVerdict` aliases to keep existing tests/callers compiling. The shape and parser ARE unified (one `ReviewVerdict`, one `parseReviewVerdict`), but the names persist. Acceptable as a non-load-bearing soft landing, or should a follow-up sweep the alias names away?
  (packages/agent-runner/src/slicer-review-loop.ts:100 `export type SliceReviewVerdict = ReviewVerdict;`; packages/agent-runner/src/intake.ts:1917 `export type LoneSliceReviewVerdict = ReviewVerdict;`; slice acceptance: "the old `SliceReviewVerdict` type is removed".)
- Ratify: the agent added `parseSliceReviewVerdict` and `parseLoneSliceReviewVerdict` as re-exports/aliases of `parseReviewVerdict`. The slice asked for ONE parser used by all four sites and these aliases were not explicitly authorised — they exist purely for backwards-compatible imports in the test suite. Same disposition question as the type aliases above.
  (slicer-review-loop.ts:28 `export {parseReviewVerdict as parseSliceReviewVerdict} from './review-verdict.js';`; intake.ts:2273 `export const parseLoneSliceReviewVerdict = parseReviewVerdict;`.)
- Ratify: there is no dedicated `setup`-skill test asserting the new doc lands in a target repo's `work/protocol/`; the acceptance criterion is met indirectly by `review-protocol-doc.test.ts` checking THIS repo's mirror byte-identity and `VERSION` bump (this repo is both author and user of the protocol per `AGENTS.md`). Is the indirect coverage sufficient or should a setup-execution test be added?
  (packages/agent-runner/test/review-protocol-doc.test.ts asserts SOURCE ↔ `work/protocol/` byte-identity + VERSION > 2026-06-09; no test invokes the setup skill on a fresh target repo to prove propagation end-to-end.)
- The PR description / commit message has no `## Decisions` block. The agent should record in-scope decisions (the alias-instead-of-removal choice above, the new `resolveReviewProtocolPath` thin helper, the shared `verdictContractPrompt` enumerating ALL channels with per-builder "do NOT fill" instructions) so the human can ratify them in one place.
  (git log -1 fdb802f shows only the slug/title line; no Decisions block.)

## Applied answers 2026-06-22

### q1: Should a follow-up slice sweep away the `SliceReviewVerdict` / `LoneSliceReviewVerdict` type aliases (and rename callers to use the unified `ReviewVerdict`), or are the aliases an acceptable permanent soft landing?

KEEP — the `SliceReviewVerdict` / `LoneSliceReviewVerdict` aliases are an acceptable permanent soft landing. The shape and parser ARE unified; only the names persist, and removing them is pure rename churn with no behaviour change. (Note the acceptance line said the type was "removed" while the NAME persists — a letter-vs-spirit gap worth acknowledging, not reopening.) Disposition: keep.

disposition: keep

### q2: Should the unauthorised `parseSliceReviewVerdict` / `parseLoneSliceReviewVerdict` parser aliases be swept away (callers migrated to the single `parseReviewVerdict`), or accepted as backwards-compat re-exports alongside the type aliases?

KEEP — same disposition as the type aliases. The parser is genuinely unified (one `parseReviewVerdict`); the `parseSliceReviewVerdict`/`parseLoneSliceReviewVerdict` aliases are import-compat re-exports only. Bundle with Q1 if ever cleaned up. Disposition: keep.

disposition: keep

### q3: Is the indirect coverage of the setup-skill propagation sufficient, or should a follow-up slice add a test that invokes the setup skill on a fresh target repo and asserts `work/protocol/` lands with the new doc?

promote-slice — add a setup-skill end-to-end propagation test. This is a genuine (non-churn) coverage gap: the existing mirror test only asserts `skills/setup/protocol/` ↔ `work/protocol/` byte-identity WITHIN this repo, which structurally CANNOT catch a broken setup COPY step into a fresh target repo. A test that invokes the setup skill on a throwaway target and asserts `work/protocol/` lands with the new doc closes it. Disposition: promote-slice.

### q4: Should a follow-up retroactively add a `## Decisions` block to the integration record (or future PR template enforcement) capturing the alias-instead-of-removal choice, the new `resolveReviewProtocolPath` helper, and the shared `verdictContractPrompt` with per-builder 'do NOT fill' instructions — or is recording them only in this observation enough?

KEEP — recording the three decisions HERE (the observation) is sufficient; no retroactive `## Decisions` block needed. The decisions (alias-instead-of-removal, the `resolveReviewProtocolPath` helper, the shared `verdictContractPrompt` with per-builder "do NOT fill" instructions) are real and verified, and this observation is an adequate durable record. Part of the recurring pattern captured in the meta-observation. Disposition: keep.

disposition: keep
