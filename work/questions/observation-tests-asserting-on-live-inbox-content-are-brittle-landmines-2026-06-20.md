<!-- dorfl-sidecar: item=observation:tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 type=observation slug=tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 allAnswered=false -->

## Q1

**What becomes of this observation now? A 2026-06-24 applied-answers block already concluded `disposition: delete` (rationale: the single offending test was fixed on main and a fresh grep for `resolve(__dirname, '..')`-style scans of `work/notes/{observations,findings,ideas}` from test code finds no remaining offenders, so the audit is effectively discharged by that one fix), and the note carries a `## Recommended: delete` footer — but the file still sits in `work/notes/observations/` and `needsAnswers: false`, so nothing has driven the actual removal. Should it be deleted now (the capture-bucket discharge-by-deletion path), or has something changed since 2026-06-24 that argues for re-promoting a real audit task / keeping it spotted instead?**

> File: work/notes/observations/tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20.md.
> Frontmatter: status: spotted, needsAnswers: false, spotted: 2026-06-20.
> Fix that triggered the observation is already on main: packages/dorfl/test/observation-identity-roundtrip.test.ts now self-seeds its fixtures in a throwaway tree (commit 2026-06-20), so the original RED is closed.
> Two applied-answers blocks already exist on the note:
>   - 2026-06-22: chose `promote-slice (audit only)` — audit the test suite for any other live-`work/notes/` assertion and convert to self-seeded fixtures; explicitly DEFERRED the proposed lint/guard sibling to work-layout-guard as over-engineering until a second instance appears.
>   - 2026-06-24: re-examined and concluded `delete` — no task/brief was ever promoted, and a fresh grep turned up no remaining offenders beyond the one already fixed, so the audit is discharged by that single fix.
> The note ends with `## Recommended: delete — A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.`
> Protocol context: by `work/protocol/WORK-CONTRACT.md` capture buckets (incl. `work/notes/observations/`) discharge by DELETION the moment a note stops being a live signal; this note self-reports it has stopped being one. No `work/tasks/*` or `work/briefs/*` references this slug.

_Suggested default: Delete the file (`git rm work/notes/observations/tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20.md`) in a single revertible commit — honoring the 2026-06-24 applied answer and the capture-bucket discharge-by-deletion contract; git history preserves the audit-already-done record. Only re-promote a real audit task if a later scan surfaces a pattern the current grep missed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
