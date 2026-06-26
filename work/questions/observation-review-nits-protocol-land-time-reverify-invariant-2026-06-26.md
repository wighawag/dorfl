<!-- dorfl-sidecar: item=observation:review-nits-protocol-land-time-reverify-invariant-2026-06-26 type=observation slug=review-nits-protocol-land-time-reverify-invariant-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking review nits for 'protocol-land-time-reverify-invariant' (ratify the mirror-only VERSION-bump convention, and ratify the nested-blockquote placement of the human-reconcile WARNING)? Keep the observation, promote either/both nits to a task (e.g. retire the misleading 'Bump skills/setup/protocol/VERSION and mirror' wording in future task templates, or restructure the WARNING as a sibling paragraph), or delete as ratified-and-done?**

> Observation file: work/notes/observations/review-nits-protocol-land-time-reverify-invariant-2026-06-26.md. Gate 2 APPROVED the work; these are nits only.
>
> Nit 1 (VERSION convention): task said 'Bump skills/setup/protocol/VERSION and mirror', but no VERSION file exists under skills/setup/protocol/ — per skills/setup/SKILL.md ~line 113, VERSION is a sync-stamp setup writes into the mirror. Only work/protocol/VERSION was bumped (source-commit now 'land-time-reverify-invariant-and-human-reconcile-warning'). Implementation matches actual repo convention; the task WORDING is what's off.
>
> Nit 2 (WARNING placement): in skills/setup/protocol/CLAIM-PROTOCOL.md (~line 22), the new '> WARNING — reconcile by REBASE…' paragraph was nested INSIDE the existing 'Consequence the human must accept' blockquote rather than as a sibling. Reads cleanly and the existing pull --rebase mention is in that same blockquote, so defensible.

_Suggested default: Ratify both nits and DELETE the observation: (a) the mirror-only VERSION bump matches the actual setup-mirror convention, so the past task wording was the off thing, not the implementation — no follow-up task needed unless the same misleading phrasing recurs in future task templates; (b) the nested-blockquote WARNING placement reads cleanly and groups with the related pull --rebase consequence, so leave as-is. If either feels worth a durable fix, promote that ONE nit to a task instead of keeping the observation open._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
