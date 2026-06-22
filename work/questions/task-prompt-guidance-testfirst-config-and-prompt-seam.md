<!-- agent-runner-sidecar: item=task:prompt-guidance-testfirst-config-and-prompt-seam type=task slug=prompt-guidance-testfirst-config-and-prompt-seam allAnswered=false -->

## Q1

**Which seam should carry the strengthened test-first text in CLAIM-PROTOCOL.md: (A) single wrapper with a conditional fragment delimited by markers (e.g. `<!-- if promptGuidance.testFirst -->…<!-- /if -->`) that the extractor in `prompt.ts` strips/keeps; (B) two named wrapper variants under sub-headings (e.g. `… — default` / `… — test-first`) selected by the resolved flag; or (C) an append-only line appended iff the flag is on?**

> The PRD explicitly defers this slicing-time choice and the task is `needsAnswers: true` because of it. Both A and B keep the canonical text in the protocol doc (the hard constraint). The slice's bias is whichever change is smaller to the existing CLAIM-PROTOCOL extraction code in `packages/agent-runner/src/prompt.ts` (the 'prompt handed to the work agent' heading scan) AND keeps a single source of truth. Affects both the wrapper-extractor implementation shape and the markdown structure in `skills/setup/protocol/CLAIM-PROTOCOL.md` (+ its `work/protocol/` mirror). If non-trivial, the chosen option is ADR-worthy.

_Suggested default: Option C — append-only line appended when the flag is on: smallest delta to the existing heading-scan extractor (no new templating, no variant selection), and keeps the markdown as a single source with the strengthened line clearly demarcated._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**When the nudge is on, does the strengthened test-first line REPLACE the existing soft 'TDD where the task asks for it; match the repo's house style.' line, or APPEND to / follow it?**

> A secondary question called out in the task's Open question section. The PRD wording 'strengthened' reads as REPLACE, but the task asks a reviewer to confirm. The acceptance criterion is written as 'the original soft phrasing is gone (or supplemented, per the decision above)', so the answer directly determines which half of that 'or' the prompt-assembly test asserts. Note: this question is partly entangled with the seam choice above — Option C (append-only) naturally implies APPEND, while A/B can go either way.

_Suggested default: REPLACE — matches the PRD's 'strengthened' wording and avoids two co-existing TDD lines with subtly different strengths in the same prompt._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
