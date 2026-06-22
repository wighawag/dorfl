---
title: review-gate non-blocking nits for 'prompt-guidance-testfirst-setup-adoption-question' (Gate 2 approve)
date: 2026-06-22
status: open
reviewOf: prompt-guidance-testfirst-setup-adoption-question
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prompt-guidance-testfirst-setup-adoption-question' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the agent did NOT include a `## Decisions` block in the PR description / commit body (commit body is empty). The slice explicitly asked for non-obvious decisions to be recorded (exact wording, behaviour when `promptGuidance` pre-exists with conflicting members, CI/non-interactive behaviour). Several such decisions were in fact MADE inside SKILL.md and should be ratified: (a) the canonical question wording landed verbatim from the slice's suggested phrasing; (b) on a pre-existing `promptGuidance` object with sibling members, only `testFirst` is set and siblings are preserved (encoded in SKILL.md and in the merge-don't-clobber test); (c) on a negative answer the WHOLE `promptGuidance` object is omitted (no `testFirst: false`, no empty object); (d) the CONTEXT.md template glossary unconditionally seeds a `promptGuidance` entry for new repos (the slice's wording 'only if setup is already touching it' is a softer constraint than what landed — for newly-scaffolded repos setup IS already writing CONTEXT.md, so this is consistent, but worth a human nod); (e) nothing is said about non-interactive / CI invocations of setup — treated as the 'absent user' branch (write nothing) by inheritance from the existing setup doctrine. None of these look wrong; they just want a thumbs-up.
  (git log -1 --format=%B shows only the title; skills/setup/SKILL.md A2 nudge bullet + A4 plan bullet + the .agent-runner.json template note encode the choices; brief Out of Scope says additional nudges aren't in scope so extensibility decision is bounded.)
- Ratify isolation-test shape: the slice's acceptance criterion 'assert no write to the real ~/.agent-runner.json outside the fixture' is covered only by a positive proof (`tmpdir() !== HOME` and all writes go through `mkdtempSync`). It is not a true negative-assertion (e.g. snapshotting HOME contents pre/post). Given that this slice's implementation is purely SKILL.md text + integration tests that themselves only touch mkdtemp roots, the practical risk is nil, but the assertion is weaker than the slice's wording suggests.
  (packages/agent-runner/test/setup-prompt-guidance-question.test.ts last `it(...)` block.)
