<!-- dorfl-sidecar: item=observation:review-nits-slicing-pr-body-summary-threading-2026-07-10 type=observation slug=review-nits-slicing-pr-body-summary-threading-2026-07-10 allAnswered=false -->

Item: [`observation:review-nits-slicing-pr-body-summary-threading-2026-07-10`](../notes/observations/review-nits-slicing-pr-body-summary-threading-2026-07-10.md)

## Q1

**What should become of this observation recording four non-blocking Gate-2 nits from the already-landed slicing-pr-body-summary-threading task — promote any/all to tasks, keep as a durable note, or delete?**

> Observation lists four nits: (1) empty-set returns undefined so gh degrades to --fill (ratify vs fix), (2) canonicalise the set-relative 'keystone' definition, (3) covers/title re-parsed via ad-hoc regex duplicating parseFrontmatter, (4) task doc points at packages/dorfl/src/slicing.ts but the file is tasking.ts (slicing→tasking rename is complete on disk; confirmed only tasking.ts exists). Source task is in work/tasks/done/. Nits 1 and 2 are 'ratify' asks (doc/ADR-shaped), nit 3 is a small refactor, nit 4 is a doc scrub of a done-task file.

_Suggested default: Split: promote nit 3 (fold covers/title into parseFrontmatter's typed shape) to a small task; capture nits 1 and 2 as a single ratification ADR (empty-set --fill fallback + set-relative keystone definition); leave nit 4 alone (done-task doc pointer, no live reader impact) or fix in-place as a trivial doc scrub; then delete this observation._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. Source task is in work/tasks/done/ and the nits don't warrant tasks: nit 4 (slicing.ts -> tasking.ts) is already complete on disk (only tasking.ts exists); nits 1 and 2 are ratify-only doc points; nit 3 (re-parse covers/title via ad-hoc regex) is a tiny optional refactor not worth tracking. No durable artifact needed.
