<!-- agent-runner-sidecar: item=task:apply-rung-merge-disposition type=task slug=apply-rung-merge-disposition allAnswered=false -->

## Q1

**Prd OQ6: when `main` moved between the human's answer and the apply step but the rebased tip STILL verifies GREEN, does apply (a) HONOUR the prior approval and land (cheap; trusts that a green re-verify is sufficient — the prd's likely default), or (b) RE-SURFACE the question because the merge-base CHANGED (the host-agnostic analogue of GitHub's 'dismiss stale approvals when the base changes'; (b) becomes an opt-in strictness on top of (a))?**

> Carried verbatim from the task body's `## Open questions (needsAnswers)` block (work/tasks/backlog/apply-rung-merge-disposition.md). The task is explicitly marked `needsAnswers: true` and its Prompt says 'Do NOT build until OQ6 is answered.' OQ6 originates in the parent prd `land-time-reverify-and-parallel-merge-ceiling`. Acceptance criterion 'Stale approval policy implemented per the resolved OQ6 answer' depends directly on this. OQ7 (merge-questions gate name/default) is noted as NOT blocking this slice.

_Suggested default: (a) honour-and-land when the rebased tip is green — the prd itself calls this the likely default; (b) becomes an opt-in strictness layer added later if needed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Sub-question to OQ6: if both ship (a as default + b as opt-in strictness), what flag/config axis controls (b), and what is its default?**

> Posed verbatim as the sub-question in the task's `## Open questions` block. Only relevant if the answer to the parent question is 'ship both'; if (a)-only or (b)-only is chosen this sub-question collapses. Needs to name the config surface (e.g. a per-repo `.agent-runner.json` key, a per-question opt-in on the surfacer, or a CLI flag on the apply rung) consistent with how the existing `promote-slice`/`dropped` dispatch in `triage-persist.ts` is configured.

_Suggested default: Off by default (strict re-surface disabled); expose as a single repo-level config key on the arbiter/advance config rather than a per-question knob, mirroring how other apply-rung policies are configured._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
