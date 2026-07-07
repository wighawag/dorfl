---
title: review-gate non-blocking nits for 'close-job-via-prd-to-brief-rename-verify-and-flip-masked-test' (Gate 2 approve)
date: 2026-07-07
status: open
reviewOf: close-job-via-prd-to-brief-rename-verify-and-flip-masked-test
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'close-job-via-prd-to-brief-rename-verify-and-flip-masked-test' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the chosen replacement token 'brief' (task allowed 'brief' or an agreed alternative). It matches the parent rename brief (code-identifier-slice-prd-to-task-brief-rename), so this looks right — confirm.
  (close-job.ts: via: 'issue' | 'brief'; frontmatter.ts resolveClosingIssue returns {via: 'brief', prd}.)
- Coherence: the discriminator is now 'brief' but the payload field on the same object is still named prd (e.g. {via: 'brief', prd: string}), and internal identifiers (prdCandidates, prdIssueNumber, Pick<Frontmatter,'prd'|'issue'>, key === 'prd') remain prd-named. The task explicitly scoped the wider prd→brief vocabulary rename OUT, so this is intentional — but the resulting via/payload mismatch is a readability drag until the parent brief lands. Worth a one-line note in the follow-up.
  (packages/dorfl/src/frontmatter.ts:442-447; close-job.ts:153,170.)
- Acceptance asked the commit message to cite the closed observation (close-job-via-prd-code-literal-vs-renamed-brief-field) and the sidecar-rebuild-sweep note. HEAD commit is just 'feat(...): complete work task; done' with no such cross-reference. In this repo the runner/human owns the commit message, so this is a runner-side gap to note, not agent malpractice.
  (git log -1: 'feat(close-job-via-prd-to-brief-rename-verify-and-flip-masked-test): complete work task; done')
