<!-- dorfl-sidecar: item=observation:review-nits-prompt-guidance-testfirst-setup-adoption-question-2026-06-22 type=observation slug=review-nits-prompt-guidance-testfirst-setup-adoption-question-2026-06-22 allAnswered=false -->

## Q1

**What should become of this review-nits observation — close it as ratified (the two non-blocking findings are accepted as-is), turn one of them into a follow-up task/ADR, or keep it open for later triage?**

> Gate 2 (PR/code review) APPROVED 'prompt-guidance-testfirst-setup-adoption-question' and integrated it; this observation is the durable home for two NON-BLOCKING nits raised at that gate. The item carries needsAnswers: true, so it needs a human disposition before it can advance. Neither nit blocks anything already merged. Verified against current code: skills/setup/SKILL.md carries the nudge bullet + A4 plan note + .dorfl.json template; packages/dorfl/test/setup-prompt-guidance-question.test.ts covers the merge and integration handoff and passes. The two underlying nits are surfaced as separate optional questions below.

_Suggested default: Close as ratified — both findings are documented, accurate, and judged low/no risk; no further work needed unless the human disagrees with finding 1 or 2 below._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Close as ratified. Both findings (Q2, Q3) are documented, accurate, and low/no risk; no further work needed. Delete the observation once Q2/Q3 are ratified below.

## Q2

**Ratify the non-obvious decisions the slice asked to be recorded but which never landed in a `## Decisions` block (the commit body is empty)? Specifically: (a) the canonical question wording landed verbatim from the slice's suggested phrasing; (b) on a pre-existing `promptGuidance` with sibling members, only `testFirst` is set and siblings are preserved; (c) on a negative answer the WHOLE `promptGuidance` object is omitted (no `testFirst: false`, no empty object); (d) the CONTEXT.md template glossary unconditionally seeds a `promptGuidance` entry for new repos; (e) non-interactive / CI invocations are treated as the 'absent user' branch (write nothing) by inheritance from existing setup doctrine.**

> review-nits finding #1. The slice's Prompt explicitly asked to RECORD non-obvious decisions (exact wording, conflicting-member behaviour, CI/non-interactive behaviour); `git log -1 --format=%B` shows only the title. The choices were in fact made and are encoded in skills/setup/SKILL.md (the Nudge bullet, A4 plan bullet, .dorfl.json template note) and asserted by setup-prompt-guidance-question.test.ts. None look wrong; finding (d) flags that the slice said 'only if setup is already touching CONTEXT.md', which is consistent for newly-scaffolded repos (setup IS writing CONTEXT.md then) but wants a human nod. This is a thumbs-up request, not a blocker.

_Suggested default: Ratify all five (a-e) as-is; they are consistent with setup doctrine and the merge-don't-clobber rule, and are covered by tests. Optionally note them in the integrating commit/ADR if a durable record of the conflicting-member and CI-branch decisions is wanted._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Ratify all five (a-e) as-is. They are consistent with setup doctrine and the merge-don't-clobber rule and are covered by tests. No durable ADR needed (the choices are visible in SKILL.md + tests); this is the RELAX disposition applied.

## Q3

**Accept that the slice's acceptance criterion 'assert no write to the real ~/.dorfl.json outside the fixture' is met only by a POSITIVE proof (tmpdir() !== HOME and all writes go through mkdtempSync), not a true negative-assertion (snapshotting HOME pre/post), or require strengthening the isolation test to a real before/after HOME snapshot?**

> review-nits finding #2. In packages/dorfl/test/setup-prompt-guidance-question.test.ts the final `it(...)` block asserts `tmpdir() !== process.env.HOME` and relies on every write going through mkdtemp roots; the global test/setup.ts also strips DORFL_* env. The implementation is purely SKILL.md text plus integration tests that only touch mkdtemp roots, so the practical leak risk is nil, but the assertion is weaker than the slice's wording ('assert no write to the real ~/.dorfl.json') literally suggests.

_Suggested default: Accept the positive proof as sufficient given the nil practical risk; do not require a HOME snapshot. If a stronger guard is later wanted repo-wide, raise it as a separate test-hygiene task rather than reopening this slice._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Accept the positive proof (tmpdir() != HOME + all writes through mkdtemp roots) as sufficient given the nil practical leak risk. Do not require a before/after HOME snapshot here. If a stronger repo-wide guard is later wanted, raise it as a separate test-hygiene task rather than reopening this slice.
