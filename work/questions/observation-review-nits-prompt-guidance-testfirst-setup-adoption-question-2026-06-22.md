<!-- agent-runner-sidecar: item=observation:review-nits-prompt-guidance-testfirst-setup-adoption-question-2026-06-22 type=observation slug=review-nits-prompt-guidance-testfirst-setup-adoption-question-2026-06-22 allAnswered=false -->

## Q1

**What becomes of the two non-blocking review nits captured here for the merged 'prompt-guidance-testfirst-setup-adoption-question' slice — (1) ratify the five undocumented decisions encoded in SKILL.md/CONTEXT.md template (canonical question wording verbatim; merge-don't-clobber of sibling `promptGuidance` members; whole-object omission on a negative answer; unconditional glossary seeding for new repos; non-interactive/CI = absent-user → write-nothing by inheritance), and (2) the weak isolation-assertion (positive `tmpdir() !== HOME` proof only, no negative pre/post HOME snapshot)?**

> Source: work/notes/observations/review-nits-prompt-guidance-testfirst-setup-adoption-question-2026-06-22.md (Gate-2 APPROVED, non-blocking nits durable home).
>
> Nit 1 — Ratify decisions: commit body is empty (`git log -1 --format=%B` shows only the title) yet the slice asked non-obvious decisions to be recorded. The decisions actually landed in skills/setup/SKILL.md (A2 nudge bullet + A4 plan bullet) and the .agent-runner.json template note, and the brief's Out of Scope bounds the extensibility question. None of the five choices look wrong — they want a human thumbs-up and, if ratified, a durable home (ADR, or an addendum on the slice/brief).
>
> Nit 2 — Weak isolation assertion: the slice's acceptance criterion said 'assert no write to the real ~/.agent-runner.json outside the fixture' but packages/agent-runner/test/setup-prompt-guidance-question.test.ts only positively proves `tmpdir() !== HOME` and routes all writes through `mkdtempSync` — not a true negative HOME snapshot. Practical risk is nil for this slice (SKILL.md text + mkdtemp-only integration tests), but a future slice touching real-HOME paths would not catch a regression with this shape.
>
> Both are explicitly NON-BLOCKING (Gate 2 already approved and the code is integrated). Choice is purely about whether to spend follow-up effort.

_Suggested default: keep — record a brief ratification note (an ADR-lite addendum or a one-line entry under the relevant skill) acknowledging the five decisions are intentional, and leave the isolation-test shape as-is for this slice while filing a small follow-up task ONLY if/when another slice extends setup to write paths outside mkdtemp. Promote-task feels heavy for nits this small; delete loses the ratification trail._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):
