<!-- dorfl-sidecar: item=task:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 type=task slug=advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 allAnswered=false -->

## Q1

**The task body is a bare promotion stub ("draft this into a buildable task") with no `## What to build`, no acceptance criteria, no self-contained `## Prompt`, and no `## Open questions` block — yet it carries `needsAnswers: true`. What is the buildable spec? Concretely: what are the acceptance criteria, and what does "done" mean for this slice (message-conflation fix + benign-skip exit behaviour)?**

> work/tasks/ready/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md: the entire body is "Promoted from observation ... A human answered 'promote': draft this into a buildable task. Carries needsAnswers:true so the advance loop surfaces the open scoping questions before it is built." Per task-template.md and WORK-CONTRACT.md, a pool/claim-ready task must carry a self-contained Prompt (an agent can start from the file alone), verifiable acceptance criteria, and must LIST the open questions the needsAnswers flag promises. None are present. This is a blocking review finding (REVIEW-PROTOCOL lens 3 + 5): the task cannot be built as-is.

_Suggested default: Draft the slice from the source observation's verified residue, splitting into TWO acceptance-able parts: (a) the uncontested message-conflation fix — claim-CAS distinguishes terminal / staged-but-not-pool / nowhere in BOTH message and (where applicable) exit, fixing the two sites src/claim-cas.ts:270 and :332; (b) the benign-skip exit behaviour per the Q2/Q3 leanings below. Pull the mechanism + fix shape from the observation into the body so the task is self-contained, then clear needsAnswers._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Draft the slice from the source observation's verified residue, split into two acceptance-able parts: (a) the uncontested message-conflation fix, claim-CAS distinguishes terminal / staged-but-not-pool / nowhere in BOTH message and (where applicable) exit, at src/claim-cas.ts:270 and :332; (b) the benign-skip exit behaviour per Q2/Q3 below. Pull the mechanism + fix shape from the observation into a self-contained `## What to build`, `## Prompt`, and acceptance criteria, then clear needsAnswers. Part (a) is independently acceptance-able (Q4).

## Q2

**For a stale-snapshot leg whose item is already in a TERMINAL folder (tasks/done, tasks/cancelled), should the leg exit 0 (silent benign skip, leg green) or a NEW distinct non-zero code that the matrix workflow specifically tolerates (skip recorded but still observable)?**

> Carried verbatim from the source observation's Q2 (work/notes/observations/...#q2). The observation's applied-answer LEANS toward a new distinct tolerated code, on the grounds the codebase already distinguishes `contended` (exit 3, a tolerated outcome the matrix already tolerates) from gone-from-main (exit 2), so an analogous tolerated "already terminal" code is consistent and keeps the skipped-leg signal visible; but it explicitly records exit 0 with a clear SKIP message as also defensible and ADR-§7-consistent. This is a lean, NOT a decision — it must be ratified before the slice bakes one exit semantics in. The chosen code also dictates how advance-lifecycle.yml must be changed to keep the workflow run green.

_Suggested default: A NEW distinct tolerated non-zero exit code for "item already terminal" (mirroring the existing `contended`/exit-3 tolerated outcome), which the matrix leg tolerates so the run stays green while the skip stays observable — but exit 0 + clear SKIP message is an acceptable alternative if you prefer simplicity._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Use a NEW distinct tolerated non-zero exit code for "item already terminal," mirroring the existing `contended`/exit-3 tolerated outcome the matrix already accepts. This keeps the skipped-leg signal observable while the run stays green, and is consistent with how the codebase already distinguishes tolerated outcomes. (Exit 0 + a clear SKIP message is an acceptable fallback if you prefer simplicity, but I lean to the distinct code so the skip stays visible.) The chosen code dictates the advance-lifecycle.yml edit that keeps the workflow green.

## Q3

**Should the benign-skip behaviour be the DEFAULT for all callers, or gated behind an opt-in flag (e.g. `--quiet-if-gone`) that the CI matrix leg sets while interactive humans keep the loud exit-2 on a gone slug?**

> Carried verbatim from the source observation's Q3 (work/notes/observations/...#q3). The applied-answer LEANS flag-gated: the CI matrix leg sets `--quiet-if-gone`; the interactive default stays LOUD so a human who typos an already-done slug still gets a hard error. The mapping site is src/do.ts ~L553 (outcome:'lost' -> exit 2). This determines both the CLI surface (a new flag vs a changed default) and the advance-lifecycle.yml workflow edit (the leg invocation must pass the flag).

_Suggested default: Flag-gated via `--quiet-if-gone` (or similar), set by the advance-propose matrix leg in advance-lifecycle.yml; keep the interactive default LOUD (exit 2 on a gone slug)._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Flag-gated. The CI matrix leg sets `--quiet-if-gone` (or similar) in advance-lifecycle.yml; the interactive default stays LOUD (exit 2 on a gone slug) so a human who typos an already-done slug still gets a hard error. Mapping site: src/do.ts ~L553 (outcome:'lost' -> exit 2).

## Q4

**Is the message-conflation fix in scope for THIS task regardless of how the exit-code questions resolve, and is it acceptance-able on its own?**

> The source observation states the message-conflation fix is "uncontested and wanted regardless" / "wanted on its own merits" — the three cases (terminal / staged-but-not-pool / nowhere on main) should be distinguishable in OUTPUT independent of the exit-code decision. Confirming this lets the slice ship the conflation fix even if the exit-semantics questions stall, and prevents the whole task being blocked on the exit-code design residue.

_Suggested default: Yes — the message-conflation fix (distinct messages for terminal / staged-but-not-pool / nowhere at src/claim-cas.ts:270 and :332) is in scope and independently acceptance-able; the exit-code change can be a second criterion gated on Q2/Q3._

<!-- q4 fields: id=q4 -->

**Your answer** (write below this line):

Yes. The message-conflation fix (distinct messages for terminal / staged-but-not-pool / nowhere at src/claim-cas.ts:270 and :332) is in scope regardless of the exit-code decision and is independently acceptance-able. Make it the first acceptance criterion; gate the exit-code change (Q2/Q3) as a second criterion, so the slice can ship the conflation fix even if the exit-semantics residue stalls.
