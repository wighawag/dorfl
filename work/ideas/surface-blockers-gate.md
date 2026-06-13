---
title: surfaceBlockers - a gate for whether a slice/PRD's declared needsAnswers is rendered into an answerable question sidecar, or left silently blocked
slug: surface-blockers-gate
type: idea
status: incubating
---

# surfaceBlockers: gate the rendering of declared `needsAnswers` blockers

> Captured 2026-06-12 from the `runner-in-ci` design conversation. Decision recorded in `docs/adr/ci-config-policy-and-gate-family.md`. NOT built. Sibling ideas: `observation-triage-tri-state-gate.md`, `run-uses-advance-tick.md`.

## The gap

A slice/PRD can carry `needsAnswers: true` (a human or the slicer flagged that its spec has open questions). `advance`'s `surface` rung renders those declared-open questions into an answerable sidecar (and the `apply` rung consumes the human's committed answers). Today this surfacing is effectively always-on when `advance` runs.

But a user can legitimately NOT want a bot opening question-files at them about their committed-but-blocked work. They would rather those items sit silently blocked in the backlog until THEY choose to look, while STILL wanting, say, observation-inbox grooming. A single global "surface questions" switch could not express "groom my observation inbox but leave my blocked work alone" (`observationTriage: ask|auto` + don't-surface-blockers). Hence a SEPARATE peer gate.

## The change

Add a boolean gate **`surfaceBlockers`** (default `off`):

- **`off`**: a slice/PRD with `needsAnswers: true` is left silently blocked (it is already build-ineligible; it just is not rendered into a question sidecar). The calm default.
- **`on`**: `advance`'s surface rung renders declared `needsAnswers` into an answerable sidecar so the human can unblock it in-repo.

Orthogonal PEER to `observationTriage` (see the ADR): observation triage grooms the raw inbox; `surfaceBlockers` is about declared/committed work items. All four corners meaningful.

## Plumbing (the 5 gate-family points)

1. `config.ts`: boolean field, default `false`, merge handling.
2. `repo-config.ts` `REPO_ALLOWED_KEYS`.
3. `env-config.ts` `KEY_COERCIONS`: boolean (`AGENT_RUNNER_SURFACE_BLOCKERS`).
4. CLI flags (`do-config.ts` + `cli.ts`).
5. Read site: the `surface` rung in `advance.ts` for the `needsAnswers`-on-slice/PRD path (and `run --advance`).

## Scope notes / decisions for PRD time

- `needs-attention` (a build hit a wall) is a SEPARATE, ALWAYS-on mechanism, NOT a "question". `surfaceBlockers` must NOT gate `needs-attention`, or a stuck build goes invisible. Keep the words separate.
- Does `surfaceBlockers: off` suppress ONLY the first-pass surface, or also the `apply` of an already-existing answered sidecar? Likely: `off` means "do not CREATE new blocker sidecars"; an already-surfaced+answered one should still apply (don't strand a human's answer). Decide at slice time.
- Explicit `advance <slug>` on a `needsAnswers` item: define whether it bypasses (surfaces regardless) like the other gates' explicit-invocation bypass.
- Interaction with the observation-triage rung: triage in `ask`/`auto` ALSO produces questions, via its own gate; `surfaceBlockers` governs only the slice/PRD declared-blocker channel. Two channels, two gates.
