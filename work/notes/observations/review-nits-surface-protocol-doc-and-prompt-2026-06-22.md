---
title: review-gate non-blocking nits for 'surface-protocol-doc-and-prompt' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: surface-protocol-doc-and-prompt
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'surface-protocol-doc-and-prompt' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the doc preamble/title (`# SURFACE-PROTOCOL`, the protocol-native intro paragraph, the WORK-CONTRACT/REVIEW-PROTOCOL framing blockquote) is NOT a verbatim lift from `skills/surface-questions/SKILL.md` — it was rewritten to fit the protocol-doc shape (mirroring `REVIEW-PROTOCOL.md`'s opener). The slice prompt said the body moves VERBATIM; the agent treated the discipline body (the two laws, humility rule, what-you-compose, the shape, no-runner path, boundaries) as the in-scope verbatim, and re-authored only the framing intro. Same call the keystone made for `REVIEW-PROTOCOL.md` — flagging only because it is not explicitly authorised by the slice.
  (Diff of old `skills/surface-questions/SKILL.md` vs new `skills/setup/protocol/SURFACE-PROTOCOL.md`: intro lines 1–10 rewritten; sections from `## When to use vs. not` onward are byte-for-byte (modulo the new JSON-shape example explicitly authorised by D2).)
- Ratify: the surfaced PR carries NO `## Decisions` block in the commit message (only a one-line subject). The keystone-pattern adoption choices (protocol-doc preamble rewording, JSON example in the doc, prompt's residual 'empty array valid / absence not' line) are unstated — fine since they trace cleanly to the slice spec + the keystone precedent, but they were not recorded.
  (`git log -1 --format=%B HEAD` shows only the subject line; no Decisions block.)
- Minor residue in `buildSurfacePrompt`: the prompt still names the discipline's table-of-contents ("Its two laws, its humility aid, the composed sources you draw from, and the emitted-question shape ALL live in that doc — read them there") and restates the empty-array-valid / absence-invalid rule. The slice's no-re-inlining test only forbids the LAW STRINGS (`GATHER-only`/`PERSIST-NEVER`/`NEVER invent an answer`/`HUMILITY RULE`), which pass. The restated empty/absence rule is technically a tiny duplication of doc content — but it is a practical output-shape contract the parser enforces, mirrors the review-prompt's style of restating output-format invariants, and is judgement-cheap to keep. Flagging for ratification, not removal.
  (packages/dorfl/src/surface-gate.ts lines ~226 ("Its two laws… ALL live in that doc") and ~242 ("An EMPTY `questions` array is a VALID, honest result… absence of the field is NOT").)
