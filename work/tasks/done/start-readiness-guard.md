---
title: start/claim readiness guard — refuse unmet blockedBy (warn on needsAnswers) with an override
slug: start-readiness-guard
spec: dorfl
blockedBy: []
covers: []
---

## What to build

A readiness check on the human `start` / `claim` path so it stops claiming a slice that is not actually ready, instead of silently proceeding.

Today `start` decides purely on the FOLDER on `<arbiter>/main` (is the slug in `backlog/`?) and never parses the slice's frontmatter — so it will claim and run a slice whose `blockedBy` deps are NOT in `work/done/`, or one flagged `needsAnswers: true`. The autonomous `run --once` path already filters these out (via `scan` → `eligibility` → `select`), but the human `start`/`claim` path does not. This closes that asymmetry — and it is the SAME class of "not claimable right now" condition that `start` already guards for the `in-progress` case.

The distinction that drives the behaviour (do NOT relitigate):

- **`blockedBy` unmet is a FACTUAL prerequisite** (the dep work does not exist yet), not a judgement call. So **refuse by default** on both `start` and `claim`, with an explicit override flag for the deliberate "start in parallel, I know the dep will land first" human case (loud, never the default) — mirroring `complete --skip-verify`: default-safe, human escape hatch.
- **`needsAnswers: true`** is a softer, set-by-someone flag (the human claiming it may be the one about to resolve the questions). So **warn loudly** on the human `start`/`claim` path (still claim unless the same override is used to silence it) — and it remains a HARD filter for the autonomous `run --once` (already is, via eligibility; do not change that).
- **`humanOnly` is NOT guarded here.** `start`/`claim` is the human path and a human is never bound by `humanOnly` (it means "a human must drive this", and the human is here). Leave the gate-free claim as-is for `humanOnly`.

Reuse, do not reinvent: `resolveBlockedBy(blockedBy, doneSlugs)` already exists in `eligibility.ts`. `start` must now read the slice's frontmatter (parse the file on `<arbiter>/main`, the same source of truth it uses for the folder) to get `blockedBy` / `needsAnswers`, and resolve `blockedBy` against the set of slugs in that repo's `work/done/` on the arbiter.

Scope: the readiness check sits BEFORE the claim CAS (so a not-ready slice is never claimed). It applies to both `dorfl claim` and `dorfl start` (start sequences claim, so put the check where both get it — e.g. in the claim path, or shared and called by both). The override flag (e.g. `--force` / `--ignore-not-ready`) bypasses both the `blockedBy` refusal and the `needsAnswers` warning, loudly.

## Acceptance criteria

- [ ] `claim`/`start` on a slice with an unmet `blockedBy` (a dep not in `work/done/` on the arbiter) REFUSES by default with a clear message naming the missing slug(s), and claims nothing.
- [ ] The override flag claims it anyway, printing a loud notice that the readiness guard was overridden.
- [ ] `claim`/`start` on a `needsAnswers: true` slice prints a loud WARNING but still claims (human path); the override flag silences the warning.
- [ ] A slice with all `blockedBy` deps in `done/` and no `needsAnswers` claims exactly as today (no behaviour change for ready slices).
- [ ] `humanOnly` is unaffected on the `start`/`claim` path (still claimable by a human, no gate).
- [ ] The autonomous `run --once` eligibility behaviour is unchanged (still filters `blockedBy`/`needsAnswers`/`humanOnly`/`allowAgents`).
- [ ] `resolveBlockedBy` from `eligibility.ts` is reused (not reimplemented).
- [ ] Tests (vitest, throwaway git repos + local `--bare` arbiter): unmet-dep refusal, override, `needsAnswers` warning, ready-slice unchanged, and the missing-slug message content.

## Blocked by

- None — can start immediately. (`eligibility.ts` + `frontmatter.ts` already exist; this only wires them into the `start`/`claim` path.)

## Prompt

> Add a readiness guard to the human `start` / `claim` path in `dorfl` so it refuses to claim a slice that is not ready, instead of claiming purely on the folder. READ FIRST: `packages/dorfl/src/start.ts` (note it decides on the FOLDER on `<arbiter>/main` and never parses frontmatter today), `packages/dorfl/src/claim-cas.ts` (the CAS `start` sequences), and `packages/dorfl/src/eligibility.ts` (REUSE `resolveBlockedBy`). Also `skills/to-slices/WORK-CONTRACT.md` for the two-axis gate semantics.
>
> Behaviour: before the claim CAS runs, read the slice's frontmatter from `<arbiter>/main` (same source of truth as the folder check) to get `blockedBy` and `needsAnswers`. (1) If any `blockedBy` slug is NOT in that repo's `work/done/` on the arbiter → REFUSE by default (claim nothing), message naming the missing slugs. (2) If `needsAnswers: true` → print a loud WARNING but still claim. (3) An override flag (`--force` or `--ignore-not-ready`) bypasses the refusal and silences the warning, printing a loud "guard overridden" notice. Do NOT gate on `humanOnly` here — the human path is never bound by it. Do NOT change the autonomous `run --once`/`scan`/`eligibility` behaviour (it already filters correctly). Apply to BOTH `claim` and `start` (start sequences claim, so place the check where both inherit it). Reuse `resolveBlockedBy`; don't reimplement dep resolution.
>
> TDD with vitest using throwaway git repos + a local `--bare` arbiter (the established pattern): cover unmet-dep refusal, the override, the `needsAnswers` warning, and that a fully-ready slice claims exactly as before. Match house style. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
