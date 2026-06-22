<!-- agent-runner-sidecar: item=task:review-nits-prompt-guidance-test-first-2026-06-21 type=task slug=review-nits-prompt-guidance-test-first-2026-06-21 allAnswered=false -->

## Q1

**When this slice slices the keystone task `prompt-guidance-testfirst-config-and-prompt-seam`, should it pre-decide the seam mechanism (Option A conditional fragment vs B variant wrapper vs C append-line) and the replace-vs-append phrasing, or leave both as the picker's ADR call?**

> Observation nit #1 (work/notes/observations/review-nits-prompt-guidance-test-first-2026-06-21.md): the keystone slice carries needsAnswers:true for BOTH the seam mechanism (A/B/C) and the replace-vs-append phrasing. Reviewer notes the brief leans toward 'strengthened' = replace, which would make the keystone immediately pickable; but leaving both open may be the intended escape hatch so the picker writes the ADR. Affects whether this slice rewrites the keystone's Open-questions block, drops needsAnswers:true on it, or only touches one of the two questions.

_Suggested default: Pre-decide replace-vs-append = 'replace' (the brief's 'strengthened' wording already implies it; ADR is cheap), but LEAVE the A/B/C seam mechanism open as the picker's ADR call (it is a genuine implementation trade-off, not authorial intent)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should the env-var name be pinned at slicing time, and if so to what exact spelling?**

> Observation nit #2: keystone slice §2 of 'End-to-end behaviour' hedges with 'AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming'. Downstream tests need a concrete name. Existing env vars in the codebase set the convention (rg for AGENT_RUNNER_ to confirm before picking).

_Suggested default: Yes — pin it. `AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST` if that matches existing `AGENT_RUNNER_*` SHOUTY_SNAKE convention; otherwise adopt whatever pattern the existing env vars already use, verbatim._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Is the per-task > per-brief > repo precedence in the item-override slice already implied by how `humanOnly` / `autoBuild` compose today, or is it a fresh design call that needs its own ADR?**

> Observation nit #3: `prompt-guidance-testfirst-item-override.md` §3 introduces a three-tier precedence; the brief's 'Implementation Decisions' bullet 3 only says 'per-item override' without ranking task vs brief. If existing override fields already establish task-wins-over-brief, this is just consistency; if not, the slicer is making a design call that should be ADR'd before the item is pickable.

_Suggested default: Treat as a fresh design call → require a short ADR (or a brief amendment) confirming task > brief > repo, citing whichever existing override field sets the precedent. Do not let the slice be built until that ranking is recorded somewhere durable._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
