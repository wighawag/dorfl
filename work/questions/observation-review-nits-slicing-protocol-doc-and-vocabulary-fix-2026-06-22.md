<!-- dorfl-sidecar: item=observation:review-nits-slicing-protocol-doc-and-vocabulary-fix-2026-06-22 type=observation slug=review-nits-slicing-protocol-doc-and-vocabulary-fix-2026-06-22 allAnswered=false -->

## Q1

**Nit 1 — stale vocabulary in `slicing.ts` JSDoc/comments: the slice asked to audit the whole module, but only the assembled prompt body and two `note(...)` strings were de-staled; >25 hits for `work/prd|work/backlog|pre-backlog|to-slices|prd-sliced` remain in JSDoc/inline comments (file-header lines 54–82, agent-invocation docblock 131–158, staging comment 322–329, 394, 457–471, …). The vocabulary-regression test only inspects the assembled prompt body, so it passes despite the drift. What becomes of this nit — promote a follow-up sweep task, keep as a recorded ratification that comment-level drift was deliberately deferred (public API `slicesLandIn: 'pre-backlog' | 'todo'` is genuinely cross-slice), or delete as already-mitigated?**

> review-nits observation §1; grep on `packages/dorfl/src/slicing.ts` for `work/prd|work/backlog|pre-backlog|to-slices|prd-sliced` returns >25 hits in COMMENTS/JSDoc that survived the rename; live prompt-string is clean and the regression test (which only inspects the prompt body) passes.

_Suggested default: promote-slice — small dedicated sweep task that finishes the rename in comments + JSDoc (the original slice explicitly scoped 'the whole `slicing.ts`'), excluding the cross-slice public API spelling._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit 2 — `skills/setup/SKILL.md` prose enumerates the propagated protocol docs as the old 6-doc list (lines 13, 110, 221) and mentions neither `SURFACE-PROTOCOL.md` (from the prior surface slice) nor the new `SLICING-PROTOCOL.md`. Actual propagation is data-driven from `vendor-protocol.mjs DOCS` (now 4 runner-invoked discipline docs: CLAIM/REVIEW/SURFACE/SLICING) so behaviour is correct — only the prose drifts. Is the prose intentionally descriptive (keep), or a missed touchpoint to fix (promote)?**

> review-nits observation §2; `skills/setup/SKILL.md` lines 13/110/221 vs. live `DOCS` set in `packages/dorfl/src/vendor-protocol.mjs`. Drift is documentation-only — propagation works.

_Suggested default: promote-slice — tiny doc-fix task to align the three enumerations with the live `DOCS` set (and add a one-line reminder to update SKILL.md when DOCS changes) so future readers aren't misled._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit 3 — decision to ratify: the new `buildSlicingBrief` prompt is silent on the one-time TRIM step and asserts a blanket 'Do NOT perform any git operations — do not stage, commit, push, or move any files' (slicing.ts:1300–1303), which surface-conflicts with `SLICING-PROTOCOL.md` §6's `git mv work/briefs/ready/<slug> work/briefs/tasked/<slug>` and trim step. The doc DOES carve that out for the runner/agent path. Is the intent that the prompt's blanket 'no git' wins and §6's trim+move is a runner-path responsibility relied on purely via 'Apply the slicing discipline defined in SLICING-PROTOCOL.md'? If yes, ratify the prompt staying silent; if no, the prompt needs an explicit carve-out so the spawned agent doesn't see a contradiction.**

> review-nits observation §3; `packages/dorfl/src/slicing.ts:1300–1303` (prompt's blanket no-git clause) vs. `work/protocol/SLICING-PROTOCOL.md` §6 (trim + `git mv` of the brief, with a parenthetical carve-out for the dorfl path).

_Suggested default: keep — ratify that the runner owns git transitions and trim, the prompt's blanket 'no git' is correct as-is, and §6's carve-out paragraph is the authoritative reconciliation; record the ratification so future readers don't re-raise it._

<!-- q3 fields: id=q3 disposition=keep -->

**Your answer** (write below this line):
