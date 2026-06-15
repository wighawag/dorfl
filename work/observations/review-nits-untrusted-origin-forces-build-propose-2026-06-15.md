---
title: review-gate non-blocking nits for 'untrusted-origin-forces-build-propose' (Gate 2 approve)
date: 2026-06-15
status: open
slug: untrusted-origin-forces-build-propose
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'untrusted-origin-forces-build-propose' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: an INVALID --origin-trust value (anything other than trusted/untrusted) FAILS LOUDLY (cli.ts prints an error and exit(1)), rather than being ignored or treated as the safe default. Is fail-loud the intended contract for this flag?
  (The slice did not specify validation behaviour for a malformed --origin-trust. The agent chose to hard-exit, with the comment 'an autonomy/trust signal must never be quietly ignored, mirroring the observation-triage enum'. This is a defensible and arguably safer choice (a CI typo surfaces instead of silently laundering trust), and it mirrors an existing pattern, but it is an in-scope decision the human should ratify: note that the FRONTMATTER parser does the OPPOSITE (an unknown stamped value reads as undefined ⇒ trusted, fail-safe), so the two layers intentionally diverge (strict at the CLI front door, lenient when reading a possibly-hand-edited file). Confirm that asymmetry is desired.)
- Ratify: the untrusted-origin clamp also fires when the build source is work/needs-attention/<slug>.md (a re-attempted/recovered-into-needs-attention untrusted slice), not only work/in-progress. Intended?
  (performIntegration resolves sourcePath to in-progress OR needs-attention, and the clamp reads originTrust from whichever applies. So a previously-failed untrusted slice retried from needs-attention is still forced to propose under a config merge. This looks correct and consistent (an untrusted slice's risk does not decrease on retry), but the slice text only ever discussed the in-progress build path, so it is an in-scope choice worth a human nod. It is NOT load-bearing-and-hard-to-reverse (the behaviour is the conservative one), hence non-blocking.)
- Process: the feat commit / PR description has no '## Decisions' block, so the two in-scope decisions above (fail-loud invalid flag; needs-attention also clamped) were not recorded by the agent for ratification. Capture them going forward.
  (Per the review rubric an un-recorded in-scope decision is a ratification finding, not a block. The decisions themselves are sound and are surfaced here. Flagging only so the human ratifies them and so future slices in this protocol carry a Decisions block when they make non-obvious cross-cutting choices (here: a new refusal/exit, and a clamp that reaches a second source folder).)
- Coherence nicety: the code comments name the build-transition behaviour the 'untrusted-origin build CLAMP', a term that appears only in comments and not in CONTEXT.md. Consider whether 'clamp' should be glossary-pinned or dropped in favour of the glossary's wording.
  (The user-facing concepts (origin/originTrust/--origin-trust) ARE pinned in CONTEXT.md and used consistently; 'clamp' is purely an internal code-comment label for the precedence rule. It does not re-mean any existing term and is at the right layer, so this is cosmetic. Raising it only because consistency between code vocabulary and the glossary keeps the language tight across future slices.)
