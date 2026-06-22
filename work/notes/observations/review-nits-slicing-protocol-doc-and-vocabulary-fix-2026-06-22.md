---
title: review-gate non-blocking nits for 'slicing-protocol-doc-and-vocabulary-fix' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: slicing-protocol-doc-and-vocabulary-fix
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slicing-protocol-doc-and-vocabulary-fix' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The slice asked to 'audit the whole `slicing.ts` for any other pre-rename strings', but only the assembled `buildSlicingBrief` prompt body and two user-facing `note(...)` messages were de-staled. JSDoc/inline comments throughout `slicing.ts` still talk about `work/prd/`, `work/prd-sliced/`, `work/pre-backlog/`, `work/backlog/`, the `to-slices` brief, and 'PRD' as a noun (e.g. lines 54–82 file-header doc, 131–158 the agent invocation docblock, 322–329 staging-folder comment, 394, 457–471, etc.). The vocabulary-regression TEST passes because it only inspects the assembled prompt body, but a future reader of this module will be misled by stale comments describing renamed paths. Worth a follow-up sweep (or ratify as deliberately deferred — the public API spelling `slicesLandIn: 'pre-backlog' | 'todo'` is genuinely cross-slice and reasonable to leave).
  (grep on `packages/agent-runner/src/slicing.ts` for `work/prd|work/backlog|pre-backlog|to-slices|prd-sliced` returns >25 hits in COMMENTS/JSDoc that survived the rename; only the live prompt-string was de-staled.)
- Ratify: `skills/setup/SKILL.md` still enumerates the propagated protocol docs as `WORK-CONTRACT.md, ADR-FORMAT.md, task-template.md, brief-template.md, CLAIM-PROTOCOL.md, REVIEW-PROTOCOL.md` in three places (lines 13, 110, 221) and does NOT mention `SURFACE-PROTOCOL.md` (carried over from the prior surface slice) OR the new `SLICING-PROTOCOL.md`. The actual copy is data-driven (`vendor-protocol.mjs DOCS`), so propagation works; only the prose enumeration drifts. Either intentional (descriptive, not load-bearing) or a missed touchpoint — flag for ratification.
  (skills/setup/SKILL.md lines 13/110/221 list 6 docs; the live DOCS set in `vendor-protocol.mjs` now ships 4 runner-invoked discipline docs (CLAIM/REVIEW/SURFACE/SLICING).)
- Decision worth recording: the new `buildSlicingBrief` prompt no longer explicitly instructs the agent to TRIM the brief (the previous prose said nothing about trimming either, so it is not a regression; but the new `SLICING-PROTOCOL.md` §6 carries a one-time-trim step the spawned agent is now expected to perform purely by virtue of 'Apply the slicing discipline defined in SLICING-PROTOCOL.md'). The prompt also asserts 'Do NOT perform any git operations — do not stage, commit, push, or move any files', which technically forbids the `git mv work/briefs/ready/<slug> work/briefs/tasked/<slug>` step 6 mentions; the doc DOES carve that out for the runner path, but the agent will see the surface conflict ('the doc tells me to git mv; the prompt forbids git'). Is the intent that the runner-spawn path RELIES on the doc's runner-path carve-out paragraph and the prompt's blanket 'no git' wins? If so, ratify the prompt staying silent on trim+move.
  (packages/agent-runner/src/slicing.ts:1300–1303 (the prompt's 'Do NOT perform any git operations' clause) vs. work/protocol/SLICING-PROTOCOL.md §6 (the trim + `git mv` of the brief, with a parenthetical carve-out for the agent/runner path).)
