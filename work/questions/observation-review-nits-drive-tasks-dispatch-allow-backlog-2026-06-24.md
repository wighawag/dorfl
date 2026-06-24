<!-- dorfl-sidecar: item=observation:review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24 type=observation slug=review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24 allAnswered=false -->

## Q1

**What should become of this Gate-2 non-blocking nit on drive-tasks SKILL.md — promote to a small doc-fix task, keep as durable note, or drop?**

> The observation captures one nit from the APPROVED Gate-2 review of 'drive-tasks-dispatch-allow-backlog':
>
> SKILL.md (opt-in-backlog bullet) paraphrases the no-flag failure as `no task '<slug>' found in tasks/ready/`, but the real error in packages/dorfl/src/prompt.ts:600-630 enumerates ALL searched folders, e.g. `no task '<slug>' found in in-progress/, tasks/ready/` (`order = ['in-progress','tasks-ready']`, `searched = order.map(...).join(', ')`).
>
> It is a pure doc illustration — no contract depends on the exact string, and the observation itself notes 'no one is bitten'. The fix is a one-line tightening of the quote (or marking it illustrative).
>
> Auto-triage bar: trivially small, isolated to one SKILL.md line, low risk. Reasonable to either spin a tiny doc-fix task or keep this note as the durable record until someone touches the skill again.

_Suggested default: promote-task — file a small doc-fix task to tighten the quoted error string (or mark it illustrative) in skills/drive-tasks/SKILL.md; it is a 1-line change and the durable home is the SKILL itself, not this note._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
