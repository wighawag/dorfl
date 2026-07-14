<!-- dorfl-sidecar: item=observation:review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14 type=observation slug=review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14 allAnswered=false -->

Item: [`observation:review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14`](../notes/observations/review-nits-reconcile-ledger-lock-spec-adr-stuck-retirement-2026-07-14.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

resolve, with one carve-out. Ratify nits 1-2: the amend-in-place placement is fine to keep in the ADR body (the addendum records the amend-vs-supersede rationale), and the scope-widening is in-bounds because the prompt authorised protocol-doc updates "if any mentions the stuck lock state" and the reconciled `skills/setup/protocol/{CLAIM,REVIEW,WORK-CONTRACT}.md` (mirrored to `work/protocol/`) plus the extra ADR did. Keep this note on record for that ratification. But split off nit 3 as a promote: mint a tiny follow-up to rename the `gc --ledger` crash-orphan report from "stuck-lock" to "orphan-lock", to avoid a third informal meaning of "stuck" alongside the two meanings CONTEXT.md pins (retired lock state vs SidecarKind). Once that follow-up is minted, resolve this note.
