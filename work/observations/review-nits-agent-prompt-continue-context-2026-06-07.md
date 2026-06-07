---
title: review-gate non-blocking nits for 'agent-prompt-continue-context' (Gate 2 approve)
date: 2026-06-07
status: open
slug: agent-prompt-continue-context
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'agent-prompt-continue-context' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- renderPrompt (the `agent-runner prompt` plumbing verb) does not inject the CONTINUE block, so rendering the prompt on a continue branch returns the fresh-start frame. Intended scope boundary, or should `prompt` also be continue-aware?
  (packages/agent-runner/src/prompt.ts:431 — renderPrompt calls buildAgentPrompt without a continueContext. PromptOptions has no arbiter-remote field, so detection would need a signature change. The three autonomous launch paths (do in-place do.ts:392, do --remote do.ts:959, run run.ts:497) ARE wired, which covers the §14 recovery goal; this only affects manual prompt rendering.)
