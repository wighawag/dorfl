---
title: 'review-gate non-blocking nits for ''skills-add-vendor-incur-agents-map'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: skills-add-vendor-incur-agents-map
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'skills-add-vendor-incur-agents-map' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: sibling vendor-skills.mjs (over an appended block on vendor-protocol.mjs). Recorded in the decisions note and JSDoc; rationale is separate concept sets evolving independently.
  (packages/dorfl/scripts/vendor-skills.mjs + package.json build chain (tsc && vendor-protocol && vendor-skills).)
- Ratify: vendored file location src/vendor/incur/agents.ts (co-located LICENSE + README) with root .prettierignore excluding packages/dorfl/src/vendor/ so re-copies stay drop-in.
  (Adds 5 lines to root .prettierignore; recorded in decisions note.)
- Ratify: resolveSkillsSourceDir lives in install-skills.ts (not co-located with resolveProtocolDoc in prompt.ts); small resolver body duplicated on ownership-boundary grounds.
  (Same prefer-dist-then-dev-walk shape as resolveProtocolDoc; different concept, different candidate list.)
- Default global:true path is intentionally NOT covered by an execution test (would touch real HOME); coverage relies on threading + vendored upstream tests. Fine given the shared-write-isolation constraint, but note the gap.
  (test/install-skills.test.ts comments explicitly that the global branch is not exercised; teardown snapshot on ~/.agents/skills/ enforces non-writeback.)
- resolveSkillsSourceDir dev-fallback branch (candidate walk to monorepo-root skills/) is only asserted indirectly via the override short-circuit. A negative test that stubs a here-relative layout would tighten coverage.
  (test 'falls back to the dev monorepo-root skills/ walk when dist is absent' asserts override shape, not the actual candidate walk.)
