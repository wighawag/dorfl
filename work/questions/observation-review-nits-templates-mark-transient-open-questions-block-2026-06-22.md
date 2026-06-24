<!-- dorfl-sidecar: item=observation:review-nits-templates-mark-transient-open-questions-block-2026-06-22 type=observation slug=review-nits-templates-mark-transient-open-questions-block-2026-06-22 allAnswered=false -->

## Q1

**Disposition for the autonomy-note placement nit: ratify the choice to put the 3-step authoring instruction inside the marker fence AND inside an HTML comment (doubly non-rendered, stripped on full resolution) rather than as a template-only comment outside the fence — or revisit it?**

> Gate-2 review APPROVED the slice but flagged that the slice prompt explicitly asked the agent to record 'whether the autonomy note went into a template comment vs. inside the fenced block, and why', and no Decisions block was added to commit 001dd77 or the done-slice file. Both options were sanctioned by D2 in the brief, so this is purely a ratification finding — no code change implied, just a recorded decision (or a deliberate 'keep as-is, no ratification needed').

_Suggested default: keep — accept the agent's choice as the de-facto decision; no follow-up slice needed since both options were pre-sanctioned by D2._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Disposition for the cross-slice marker-tag ratification nit: explicitly ratify `<!-- open-questions -->` / `<!-- /open-questions -->` as the load-bearing literal tag the sibling apply-reconciliation slice must match, or defer ratification until that sibling slice lands?**

> The brief listed these tags only as an example ('e.g. ...' at line 48 of brief `apply-reconciles-stale-open-questions.md`, D1). By landing them verbatim in `skills/setup/protocol/brief-template.md` and `task-template.md`, the agent effectively pinned the literal marker. Changing the tag later would require coordinated edits in templates + apply code + any already-authored briefs, so an explicit ratification line is cheap insurance — but it could also just be absorbed by the sibling apply-reconciliation slice when it cites the templates as the canonical source.

_Suggested default: promote-task — a tiny ADR or note ratifying the literal marker pair as the cross-slice contract, so the sibling apply-reconciliation slice can cite it rather than re-decide it._

<!-- q2 fields: id=q2 disposition=promote-adr -->

**Your answer** (write below this line):
