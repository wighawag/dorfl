<!-- agent-runner-sidecar: item=observation:tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 type=observation slug=tests-asserting-on-live-inbox-content-are-brittle-landmines-2026-06-20 allAnswered=false -->

## Q1

**Disposition for this observation: promote to a slice that (a) audits the test suite for any other assertion reading the live work/notes/ tree and converts them to self-seeded fixtures, and (b) adds a lightweight guard/lint (sibling to work-layout-guard) flagging tests that scan live-repo work/notes/ paths — or keep as a spotted note, or drop?**

> The observation documents a concrete RED incident already fixed on main (2026-06-20): observation-identity-roundtrip.test.ts asserted files.length >= 17 against the live work/notes/observations/review-nits-*.md inbox; a legitimate triage drain dropped the count to 0 and broke the build even though the invariant (identity = filename) still held. The general hazard is that work/notes/ is a capture bucket designed to shrink by deletion under WORK-CONTRACT, so any test asserting on its count or specific files is a landmine that correct triage will trip — and worse, it disincentivises draining the inbox. The note's own 'Suggested disposition' already proposes the two-part remediation (audit + guard); the open judgement is whether that warrants a slice now, or whether the single fixed test is enough and the guard is over-engineering until a second instance appears.

_Suggested default: promote-slice — the audit is bounded (grep for resolve(__dirname,'..') + work/notes scans) and the guard is a small extension of the existing work-layout-guard pattern, and the perverse coupling (tests punishing correct triage) is exactly the kind of structural footgun worth closing once rather than re-discovering_

<!-- q1 fields: id=q1 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice, scoped to part (a): audit the test suite for any other assertion that reads the LIVE `work/notes/` tree and convert those to self-seeded fixtures (in a throwaway tree). The original RED is already fixed on main (the identity-roundtrip test now self-seeds), and the audit scope is bounded (~10 candidate files). DEFER part (b) the lint/guard — it is the over-engineering risk; add it only if a second instance appears (the existing work-layout-guard is the precedent shape if we ever do). Disposition: promote-slice (audit only).
