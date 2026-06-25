<!-- dorfl-sidecar: item=observation:review-nits-templates-mark-transient-open-questions-block-2026-06-22 type=observation slug=review-nits-templates-mark-transient-open-questions-block-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this signal? It is a review-gate triage note holding two NON-BLOCKING ratification findings from Gate 2's approval of 'templates-mark-transient-open-questions-block'. The work has already landed (both this slice and its sibling 'apply-reconciles-resolved-brief-body' are in work/tasks/done/) and the findings do not block integration. Should the two ratification points below be recorded durably (e.g. as a short ADR or a Decisions note), or simply acknowledged and this observation deleted?**

> work/notes/observations/review-nits-templates-mark-transient-open-questions-block-2026-06-22.md is a reviewOf sidecar (needsAnswers: true) capturing 2 nits the PR review APPROVED past. Verified against current reality: both decisions are already implemented and consistent across the codebase. Its prose calls itself the 'durable home for triage — promote-to-slice / keep / delete'. No code change is implied by either finding; both are explicitly 'ratification finding only'.

_Suggested default: Acknowledge both ratifications inline (neither rises to the ADR gate: low reversal cost, no surprising trade-off) and DELETE the observation + sidecar via the direct-delete discharge path. Neither nit warrants a new slice._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Ratify the autonomy-note PLACEMENT: do you accept that the 'Set needsAnswers: true … clear once answered' authoring instruction lives INSIDE the marker fence AND inside an HTML comment (doubly-non-rendered, stripped by apply on full resolution), rather than as a template-only comment outside the fence?**

> Verified present in skills/setup/protocol/task-template.md (lines 12-27) and prd-template.md (lines 13-28): the `<!-- open-questions -->` fence wraps a `<!-- TRANSIENT BLOCK … -->` comment carrying the 3-step instruction, then the visible `## Open questions` placeholder, then `<!-- /open-questions -->`. The work/protocol/ copies are byte-identical (diff clean). The slice prompt asked the agent to record 'whether the autonomy note went into a template comment vs inside the fence, and why', but commit body / done-slice file added no `## Decisions` block. Both options were sanctioned by D2, so this is ratification only.

_Suggested default: Accept the in-fence placement as-is; it is sanctioned by D2 and keeps the instruction co-located with the block it governs and auto-stripped on resolution. The only residual nit is the missing Decisions line, which the triage answer above can close._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Ratify the CROSS-SLICE CONTRACT this template pins: that the literal marker pair `<!-- open-questions -->` / `<!-- /open-questions -->` is now the load-bearing tag the sibling apply-reconciliation slice must match exactly (the brief had listed it only as an 'e.g.' example)?**

> Confirmed honoured end-to-end: packages/dorfl/src/apply-persist.ts defines OPEN_QUESTIONS_MARKER_OPEN = '<!-- open-questions -->' and OPEN_QUESTIONS_MARKER_CLOSE = '<!-- /open-questions -->' (lines 99-100) and strips structurally on the FULL-RESOLUTION route (D1/D3); the sibling slice 'apply-reconciles-resolved-brief-body' has landed in work/tasks/done/. The reviewer flags that changing the tag later would need coordinated edits across templates + apply code + any already-authored briefs, so the literal deserves an explicit ratification line.

_Suggested default: Accept this exact marker pair as the pinned, load-bearing contract; it matches the brief's example and sidecar house style, and is already consistent across templates and apply-persist.ts. Note it as the canonical tag so any future change is treated as a coordinated cross-slice edit._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
