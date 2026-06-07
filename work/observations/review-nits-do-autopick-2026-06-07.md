---
title: review-gate non-blocking nits for 'do-autopick' (Gate 2 approve)
date: 2026-06-07
status: open
slug: do-autopick
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'do-autopick' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- In performDoArgs the explicit-arg SelectedItems are tagged namespace:'slice' but the arg is passed verbatim (mode.verbatimArg), making the namespace field inert/misleading on that path. Consider an explicit 'verbatim'/'raw' marker or omitting namespace for clarity.
  (packages/agent-runner/src/do-autopick.ts performDoArgs(): `namespace: 'slice' as const` with a comment that the namespace is irrelevant for explicit args; runSelectedInSequence then ignores it under mode.verbatimArg. Functionally correct, purely a readability nit.)
