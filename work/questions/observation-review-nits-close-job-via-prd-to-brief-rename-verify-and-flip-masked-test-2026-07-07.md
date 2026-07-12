<!-- dorfl-sidecar: item=observation:review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07 type=observation slug=review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07 allAnswered=false -->

Item: [`observation:review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07`](../notes/observations/review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07.md)

## Q1

**What becomes of this signal — the three non-blocking Gate-2 nits on close-job-via-prd-to-brief-rename-verify-and-flip-masked-test: drop the note, keep it as-is for reference, or promote any of the three findings to a task?**

> Observation at work/notes/observations/review-nits-close-job-via-prd-to-brief-rename-verify-and-flip-masked-test-2026-07-07.md carries 3 nits: (1) ratify 'brief' as the replacement token — matches the parent spec code-identifier-slice-prd-to-task-brief-rename (currently in work/specs/tasked/), so already confirmed; (2) via:'brief' vs payload field still named spec + prdCandidates/prdIssueNumber/key==='spec' residuals — the task explicitly scoped the wider vocabulary rename OUT and the parent brief spec is the follow-up home, so intentional; (3) HEAD commit message omitted the required cross-refs to the closed observation and sidecar-rebuild-sweep note — flagged as runner/human-side, not agent malpractice, since the runner owns commit messages in this repo.

_Suggested default: Delete the observation: nit1 is confirmed by the tasked parent spec, nit2 is intentional and already tracked by that same parent brief, and nit3 is a runner-side commit-hygiene gap outside the agent's remit — nothing here needs a task._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. None of the three nits needs promotion: (1) 'brief' as the replacement token is already confirmed by the parent spec code-identifier-slice-prd-to-task-brief-rename; (2) the wider vocabulary rename (payload field/prdCandidates/key==='spec' residuals) was explicitly scoped OUT and the parent brief spec is its follow-up home; (3) the missing commit cross-refs are runner/human-side, not agent malpractice. No residue.
