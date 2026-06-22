<!-- agent-runner-sidecar: item=observation:review-nits-surface-protocol-doc-and-prompt-2026-06-22 type=observation slug=review-nits-surface-protocol-doc-and-prompt-2026-06-22 allAnswered=false -->

## Q1

**Ratify the doc's framing intro (`# SURFACE-PROTOCOL`, the protocol-native intro paragraph, the WORK-CONTRACT/REVIEW-PROTOCOL blockquote) being a REWRITE rather than a verbatim lift from `skills/surface-questions/SKILL.md` — accept as the same keystone-pattern call made for `REVIEW-PROTOCOL.md`, or sweep back to verbatim?**

> Gate 2 nit: slice prompt said the body moves VERBATIM; agent treated only the discipline body (two laws, humility rule, what-you-compose, the shape, no-runner path, boundaries) as verbatim-in-scope and re-authored the framing intro to fit the protocol-doc shape. Diff: intro lines 1–10 rewritten; `## When to use vs. not` onward is byte-for-byte modulo the D2-authorised JSON example.

_Suggested default: keep — same call as the REVIEW-PROTOCOL keystone precedent; the rewrite is necessary to fit the protocol-doc shape and the discipline body IS verbatim. Ratify, don't revert._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Should a follow-up retroactively record a `## Decisions` block capturing the three in-scope choices (protocol-doc preamble rewording, the JSON shape example in the doc, the prompt's residual 'empty array valid / absence not' restatement), or is durably capturing them HERE in this observation enough?**

> Gate 2 nit: `git log -1 --format=%B HEAD` shows only the subject line; no Decisions block. The choices trace cleanly to the slice spec + keystone precedent but were not explicitly recorded at integration time. (Same recurring shape as Q4 in observation:review-nits-review-protocol-doc-and-shared-machinery-2026-06-22, which was answered `keep`.)

_Suggested default: keep — durably captured HERE is sufficient; matches the disposition on the parallel review-protocol observation. No retroactive amend needed._

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):

## Q3

**Should the residual doc-content echoes in `buildSurfacePrompt` (the table-of-contents line 'Its two laws, its humility aid… ALL live in that doc — read them there' and the restated 'EMPTY questions array VALID / absence NOT' rule) be trimmed, or kept as a practical output-shape contract mirroring the review-prompt's style?**

> Gate 2 nit: packages/agent-runner/src/surface-gate.ts ~line 226 (the TOC line) and ~line 242 (the empty/absence rule). The slice's no-re-inlining test only forbids the LAW STRINGS (`GATHER-only`/`PERSIST-NEVER`/`NEVER invent an answer`/`HUMILITY RULE`), which pass. The empty/absence rule is a tiny doc duplication but is the parser-enforced output-shape contract and mirrors the review prompt's restate-format-invariants style; judgement-cheap to keep.

_Suggested default: keep — the empty/absence rule is a load-bearing output-shape contract the parser enforces and matches review-prompt style; the TOC line is a navigational nudge worth its tiny duplication cost._

<!-- q3 fields: id=q3 disposition=keep -->

**Your answer** (write below this line):
