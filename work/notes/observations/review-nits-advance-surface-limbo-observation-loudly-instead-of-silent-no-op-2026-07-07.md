---
title: review-gate non-blocking nits for 'advance-surface-limbo-observation-loudly-instead-of-silent-no-op' (Gate 2 approve)
date: 2026-07-07
status: open
reviewOf: advance-surface-limbo-observation-loudly-instead-of-silent-no-op
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-surface-limbo-observation-loudly-instead-of-silent-no-op' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: limbo maps to outcome 'usage-error' with exitCode 1 (not a new dedicated outcome like 'limbo' and not exit 2). Is this the right cli surface? It reuses an existing outcome consistently used elsewhere (advance-isolated, triage-persist, tasking) so it fits the existing language, but there is no Decisions block in the PR description recording it.
  (packages/dorfl/src/advance.ts:653 returns {exitCode:1, outcome:'usage-error', message:limbo}; grep shows 'usage-error' is the canonical 'usage/env problem' outcome across the codebase.)
- Ratify placement: limbo is detected AFTER the surface-questions agent is spawned (post-lock), so an in-limbo observation will burn a fresh-context model spawn every tick until a human authors the sidecar or sets `triaged:`. The task's What explicitly says 'after ... the surfacer has emitted EMPTY, detect the LIMBO condition', so this is spec-conformant, but the recurring spawn cost is a real user-visible default worth flagging for ratification.
  (packages/dorfl/src/advance.ts surfaceRung: gate() runs first, then persist 'nothing' branch calls detectObservationLimbo. Task body: 'after the triage rung has fallen through to the surface rung and the surfacer has emitted EMPTY ... detect the LIMBO condition'.)
- PR description carries no `## Decisions` block though the change makes at least two in-scope autonomous choices (outcome/exit code selection; loud-limbo mapped to the existing 'usage-error' rather than a new dedicated outcome). Consider adding one so future readers can find the ratifications.
  (git log -1 --format=%B on 6245da2a shows only the one-line title; AGENTS/PROTOCOL expects a Decisions block for in-scope autonomous choices.)
