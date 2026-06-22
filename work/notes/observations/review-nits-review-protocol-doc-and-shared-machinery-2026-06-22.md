---
title: review-gate non-blocking nits for 'review-protocol-doc-and-shared-machinery' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: review-protocol-doc-and-shared-machinery
needsAnswers: true
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
