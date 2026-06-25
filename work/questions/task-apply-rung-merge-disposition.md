<!-- dorfl-sidecar: item=task:apply-rung-merge-disposition type=task slug=apply-rung-merge-disposition allAnswered=false -->

## Q1

**What is your answer to PRD OPEN QUESTION 6 (the stale-approval policy)? When `main` moves between the human's answer and the apply step but the rebased tip STILL verifies GREEN, does apply (a) HONOUR the prior approval and land (cheap; trusts that a green re-verify is sufficient), or (b) RE-SURFACE the question because the merge-base CHANGED (the host-agnostic analogue of GitHub's 'dismiss stale approvals when the base changes')? And the sub-question: if both ship (a + b opt-in), what flag/config axis controls (b), and what is its default?**

> This is a PRE-EXISTING open question the item already carries. Its frontmatter sets `needsAnswers: true`, and its `## What to build` + `## Open questions` + `## Prompt` ALL state: 'Decide BEFORE building this slice' / 'Do NOT build until OQ6 is answered.' The PRD (`land-time-reverify-and-parallel-merge-ceiling`, OQ6) is the source and is still open there too: 'Likely (a) by default with (b) as an opt-in strictness, but confirm - it sets how often a human re-answers.' This question gates the second acceptance criterion ('Stale approval policy implemented per the resolved OQ6 answer').

_Suggested default: (a) honour the prior approval and land when the rebased tip re-verifies green, with (b) re-surface-on-changed-merge-base as an OPT-IN strictness layered on top; the opt-in (b) controlled by the merge-question gate axis resolved in OQ7 (flag > env > per-repo > global > default), defaulting OFF (so the cheap path is the default). This mirrors the PRD's stated 'likely' resolution but is a humility-aid suggestion only, NOT a decision._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**This task's premise appears STALE: it specifies mirroring the apply rung's `promote-slice`/`dropped` disposition-dispatch and dispatching an answered `merge` DISPOSITION, but that whole disposition vocabulary has since been RETIRED. Should this task be re-scoped (and re-reviewed) against the new AGENTIC apply model before it is built, or has its premise already been reconciled somewhere I have not seen?**

> Claim-vs-reality + conceptual-coherence drift. The task says apply 'today handles `promote-slice`/`dropped` -> `git mv`' and asks to extend that 'EXISTING disposition-dispatch'. But `work/tasks/done/agentic-apply-retire-disposition-vocabulary.md` (now DONE) removed the `disposition=` field, the `DISPOSITIONS` set, the `SidecarDisposition` type, the `pickTerminal`/`TERMINAL_PRECEDENCE` picker, and `answeredPromoteArtifact`. `apply-persist.ts` JSDoc states verbatim: 'The disposition vocabulary is GONE ... the apply rung no longer reads a per-entry `disposition=` token'. The apply rung is now an AGENTIC decision via `decide(input, allowedOutcomes)` returning `{mint-task | mint-prd | delete-source | ask-follow-up}` (`agentic-apply-retire-disposition-vocabulary.md` lines 17-35; `decision-engine.ts` outcome superset `task|prd|adr|delete|ask`). There is NO `merge` outcome and no token-dispatch to mirror. The task's `## Prompt` even points at `triage-persist.ts` for the `promote-slice`/`dropped` pattern, which no longer routes work-item moves at all. A task built on a stale premise is a block per REVIEW-PROTOCOL lens 1.

_Suggested default: Re-scope this task (and its blocker `merge-question-surfacer`, which carries the same `merge|hold|drop` disposition premise) against the new agentic/binary-sidecar model BEFORE building: re-run `to-task`/`review` so the 'invoke the LAND primitive on an answered merge' goal is expressed as a runner ACTION wired into the new apply path, not as a retired disposition token. Suggestion only._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Given the disposition vocabulary is retired and the agentic apply outcome set is `{task | prd | adr | delete | ask}` (a content-mint / delete / follow-up model), HOW should an answered merge-question dispatch the LAND primitive (rebase -> re-verify -> advance) within that model? It is a runner ACTION, not a content outcome, so it does not map onto any current `DecisionOutcome`. Does `merge` become a new agentic outcome wired only into the merge-question caller, a separate non-agentic state-action dispatch keyed off the merge-question's answer, or something else?**

> Conceptual-coherence (REVIEW-PROTOCOL lens 4c: duplicate/overlap + right layer). `decision-engine.ts` defines outcomes `task|prd|adr|delete|ask`, and advance-apply's allowed subset is `{mint-task|mint-prd|delete-source|ask-follow-up}` (`agentic-apply-retire-disposition-vocabulary.md`). A `merge` that 'invokes `performIntegration` (rebase->reverify->advance)' fits none of these: it neither mints content nor deletes a source nor asks a follow-up. The PRD's 'larger generalization' note even frames this as one instance of 'surface runner STATE -> answer -> apply dispatches the ACTION via disposition' - but 'disposition' there is exactly the concept that has since been retired. So the layer/shape for an answer-driven runner-action dispatch is genuinely unresolved post-retirement.

_Suggested default: Treat answer-driven runner ACTIONS (merge/land, and the sibling stuck-lock requeue) as a distinct dispatch layer from the agentic content-decision (`decide`), keyed off the surfaced question's identity and the human's plain answer, rather than forcing `merge` into the `DecisionOutcome` content union; resolve this consistently with the PRD's two shared cross-cutting questions (sidecar-keying to a branch/lock-ref, and questions-folder shape). Suggestion only - this is a design call the human should confirm._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
