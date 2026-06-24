---
title: surfaceBlockers - a gate for whether a slice/PRD's declared needsAnswers is rendered into an answerable question sidecar, or left silently blocked
slug: surface-blockers-gate
blockedBy: [advance-autopick-lifecycle-pools, observation-triage-tri-state-gate]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: `work/ideas/surface-blockers-gate.md` + ADR `docs/adr/ci-config-policy-and-gate-family.md`. ENABLES `work/prd/runner-in-ci.md`. `blockedBy`: (1) `advance-autopick-lifecycle-pools` LOGICALLY (it adds the `needsAnswers`-blocked pool to auto-pick, without it there is no auto-surface behaviour to gate); (2) `observation-triage-tri-state-gate` for FILE-SERIALISATION (both edit the same gate-family files config.ts / repo-config.ts / env-config.ts / cli.ts) and so the compose-test references a real sibling gate.

## What to build

Add a BOOLEAN gate **`surfaceBlockers`** (default `off`) governing whether `advance`'s SURFACE rung renders a slice/PRD's DECLARED `needsAnswers: true` into an answerable question sidecar, or leaves the item silently blocked in the backlog:

- **`off`** (default, calm): a slice/PRD with `needsAnswers: true` is left silently blocked, the BLOCKED POOL added by `advance-autopick-lifecycle-pools` is NOT enumerated into auto-pick, so advance does NOT proactively render it into a question sidecar.
- **`on`**: the blocked pool IS enumerated; advance's surface rung renders the declared `needsAnswers` into a sidecar so the human can answer + unblock it in-repo (the apply rung then consumes the committed answer).

NOTE: there is no auto-surface behaviour to gate UNTIL `advance-autopick-lifecycle-pools` adds the `needsAnswers`-blocked pool to selection, today such items are build-INELIGIBLE and never auto-picked, so surface only fires on EXPLICIT naming. This gate governs the NEW auto-pick pool that the blocker introduces.

This is the SECOND of the two orthogonal question-surfacing gates (the first is `observationTriage`). They are PEERS, not a hierarchy: observation triage grooms the raw inbox; `surfaceBlockers` is about declared/committed work. So "groom my inbox but leave my blocked work alone" = `observationTriage: ask|auto` + `surfaceBlockers: off` must be expressible.

`needs-attention` (a build that hit a wall) is a SEPARATE, ALWAYS-on mechanism, NOT a "question"; `surfaceBlockers` must NOT gate it (a stuck build must never go invisible).

## Acceptance criteria

- [ ] `surfaceBlockers` is a `Config` boolean field, default `false`, with merge handling, threading the full gate-family chain: `REPO_ALLOWED_KEYS`, `env-config.ts` `KEY_COERCIONS` boolean (`DORFL_SURFACE_BLOCKERS`), and a CLI flag, resolving `flag > env > per-repo > global > default`.
- [ ] The gate governs the `needsAnswers`-blocked POOL (added by the blocker) at the selection layer: `off` ⇒ the blocked pool is NOT enumerated into auto-pick, so a bare `advance` does NOT surface a `needsAnswers` slice/PRD (a test asserts no sidecar is created and the item stays put); `on` ⇒ the pool is enumerated and an auto-picked `needsAnswers` item is rendered into a sidecar via `surfaceRung`.
- [ ] `surfaceBlockers: off` does NOT suppress `needs-attention` surfacing (a separate test or assertion confirms a stuck-build still surfaces regardless of this gate).
- [ ] CREATE-vs-CONSUME invariant, applied PER SUB-STEP (DECIDED): `surfaceBlockers` gates only CREATE acts. The `apply` rung's CONSUME part (write the human's answer + resolve/disposition) is ALWAYS allowed and NOT gated, an already-surfaced+answered blocker sidecar STILL applies under `surfaceBlockers: off`, so a human's committed answer is NEVER stranded. A test asserts an answered sidecar applies regardless of the gate. (Mirrors `needs-attention` always-on: gates govern "don't make noise", never "discard the human's work / hide a failure".)
- [ ] The apply-FOLLOWUP edge (forward-looking, verify at build time): `apply` has a re-pause sub-step that can APPEND NEW follow-up questions (`applyFollowups`/`appendQuestions`), which is a CREATE act. VERIFIED 2026-06-12 that follow-up generation is NOT wired in production (`applyFollowups` is set only by tests; `cli.ts`/`advance-drivers.ts` never thread it), so apply is pure consume TODAY and this slice need not gate it. Re-confirm at build time; if it is now wired, the bot-minted-followup CREATE sub-step must respect this gate (gate-off ⇒ apply + resolve, do not mint new questions), while a HUMAN-authored followup stays consume. If wiring exists but cannot distinguish human- from bot-authored followups (the `NewQuestion[]` seam carries no provenance), STOP and surface it (`needsAnswers`), do not guess.
- [ ] DECISION (record): does explicit `advance <slug>` / `advance prd:<slug>` on a `needsAnswers` item BYPASS the gate (surface regardless)? Default to bypass (mirroring the other gates' explicit-invocation bypass); confirm with a test.
- [ ] The two gates compose at the AUTO-PICK layer: a test asserts `observationTriage: ask` + `surfaceBlockers: off` auto-picks + surfaces an untriaged observation's question while NOT enumerating (and so NOT surfacing) a `needsAnswers`-flagged slice, the previously-inexpressible case. (This is a bare-`advance` auto-pick test, NOT explicit naming, since naming bypasses both gates.)
- [ ] Tests in the repo's vitest style; shared/global locations isolated to temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-autopick-lifecycle-pools`: LOGICAL, it adds the `needsAnswers`-blocked pool to the advance auto-pick selection. Without it there is no auto-surface behaviour to gate (`needsAnswers` items are explicit-invocation-only today). This gate governs that new pool.
- `observation-triage-tri-state-gate`: FILE-SERIALISATION + COMPOSE, both edit the shared gate-family files; and the compose-test references the sibling `observationTriage` gate, so build on its landed form.

## Prompt

> Add a BOOLEAN `surfaceBlockers` gate (default `off`) governing whether advance's SURFACE rung renders a slice/PRD's declared `needsAnswers: true` into an answerable sidecar (`on`) or leaves it silently blocked (`off`). Source: `work/ideas/surface-blockers-gate.md`; ADR `docs/adr/ci-config-policy-and-gate-family.md`. ENABLES `work/prd/runner-in-ci.md`; orthogonal PEER to `observationTriage` (the sibling slice this is `blockedBy` for file-serialisation).
>
> FIRST, confirm the BLOCKERS landed: `advance-autopick-lifecycle-pools` added the `needsAnswers`-blocked POOL to auto-pick (so there is now an auto-surface behaviour to gate), and `observation-triage-tri-state-gate` added the `observationTriage` gate (for the compose-test). Then drift-check: advance's surface rung (`advance.ts` `surfaceRung`) renders declared `needsAnswers` into a sidecar via `persistSurfacedQuestions`; an item with `needsAnswers:true` is build-INELIGIBLE (the auto-eligible predicate) so it was NEVER auto-picked before the blocker. If landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: there are TWO question-surfacing gates, `observationTriage` (the raw inbox) and `surfaceBlockers` (declared `needsAnswers` on committed slices/PRDs). They are orthogonal peers; the case this unlocks is `observationTriage: ask|auto` + `surfaceBlockers: off` ("groom my inbox, leave my blocked work alone"). `needs-attention` (a build hit a wall) is SEPARATE and ALWAYS on; `surfaceBlockers` must NOT gate it.
>
> BUILD: (1) the `Config` boolean field + default `false`; (2) the full chain (REPO_ALLOWED_KEYS, boolean env coercion, CLI flag); (3) gate the `needsAnswers`-blocked POOL's enumeration (from the blocker) on `surfaceBlockers`, so `off` drops the pool from auto-pick and `on` enumerates it into `surfaceRung`. CREATE-vs-CONSUME is DECIDED: gate only the SURFACE (create) phase; do NOT gate `apply` (consuming an answer), an answered sidecar still applies under `off`. The one decision to RECORD: does explicit `advance <slug>`/`prd:` bypass the gate (default: yes, mirroring the other gates).
>
> TEST (TDD, vitest, house style): `off` leaves a `needsAnswers` slice silently blocked (no sidecar); `on` surfaces it; `needs-attention` still surfaces under `off`; the compose-test (`observationTriage: ask` + `surfaceBlockers: off`); explicit-bypass. Isolate shared/global locations to temp fixtures.
>
> "Done" = `surfaceBlockers` resolves through the full chain, the surface rung honours it for declared blockers, `needs-attention` is unaffected, the two gates compose, and the gate is green.
