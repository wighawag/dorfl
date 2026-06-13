---
title: surfaceBlockers - a gate for whether a slice/PRD's declared needsAnswers is rendered into an answerable question sidecar, or left silently blocked
slug: surface-blockers-gate
blockedBy: [observation-triage-tri-state-gate]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: `work/ideas/surface-blockers-gate.md` + ADR `docs/adr/ci-config-policy-and-gate-family.md`. ENABLES `work/prd/runner-in-ci.md`. `blockedBy` its sibling `observation-triage-tri-state-gate` ONLY to serialise edits to the SAME gate-family files (config.ts / repo-config.ts / env-config.ts / cli.ts), avoiding a merge conflict, not a logical dependency.

## What to build

Add a BOOLEAN gate **`surfaceBlockers`** (default `off`) governing whether `advance`'s SURFACE rung renders a slice/PRD's DECLARED `needsAnswers: true` into an answerable question sidecar, or leaves the item silently blocked in the backlog:

- **`off`** (default, calm): a slice/PRD with `needsAnswers: true` is left silently blocked. It is already build-ineligible (the auto-eligible predicate excludes it); this gate just means advance does NOT proactively render it into a question sidecar.
- **`on`**: advance's surface rung renders the declared `needsAnswers` into a sidecar so the human can answer + unblock it in-repo (the apply rung then consumes the committed answer).

This is the SECOND of the two orthogonal question-surfacing gates (the first is `observationTriage`). They are PEERS, not a hierarchy: observation triage grooms the raw inbox; `surfaceBlockers` is about declared/committed work. So "groom my inbox but leave my blocked work alone" = `observationTriage: ask|auto` + `surfaceBlockers: off` must be expressible.

`needs-attention` (a build that hit a wall) is a SEPARATE, ALWAYS-on mechanism, NOT a "question"; `surfaceBlockers` must NOT gate it (a stuck build must never go invisible).

## Acceptance criteria

- [ ] `surfaceBlockers` is a `Config` boolean field, default `false`, with merge handling, threading the full gate-family chain: `REPO_ALLOWED_KEYS`, `env-config.ts` `KEY_COERCIONS` boolean (`AGENT_RUNNER_SURFACE_BLOCKERS`), and a CLI flag, resolving `flag > env > per-repo > global > default`.
- [ ] The advance surface rung honours it for the DECLARED-`needsAnswers` slice/PRD path: `off` ⇒ a `needsAnswers` slice/PRD is NOT rendered into a sidecar (left silently blocked), and a test asserts no sidecar is created and the item stays put; `on` ⇒ the sidecar is surfaced as today.
- [ ] `surfaceBlockers: off` does NOT suppress `needs-attention` surfacing (a separate test or assertion confirms a stuck-build still surfaces regardless of this gate).
- [ ] CREATE-vs-CONSUME invariant (DECIDED, not open): `surfaceBlockers` gates only the CREATE phase (the first-pass SURFACE of a declared `needsAnswers`). The `apply` rung (CONSUMING a human's committed answer) is ALWAYS allowed and is NOT gated, an already-surfaced+answered blocker sidecar STILL applies under `surfaceBlockers: off`, so a human's committed answer is NEVER stranded. A test asserts an answered sidecar applies regardless of the gate. (This mirrors `needs-attention` being always-on: gates govern "don't make noise", never "discard the human's work / hide a failure".)
- [ ] DECISION (record): does explicit `advance <slug>` / `advance prd:<slug>` on a `needsAnswers` item BYPASS the gate (surface regardless)? Default to bypass (mirroring the other gates' explicit-invocation bypass); confirm with a test.
- [ ] The two gates compose: a test asserts `observationTriage: ask` + `surfaceBlockers: off` grooms observations (surfaces their questions) while leaving a `needsAnswers`-flagged slice silently blocked (no sidecar), the previously-inexpressible case.
- [ ] Tests in the repo's vitest style; shared/global locations isolated to temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `observation-triage-tri-state-gate`: serialises edits to the shared gate-family files (config.ts / repo-config.ts / env-config.ts / cli.ts) to avoid a merge conflict; build on its landed `observationTriage` so the two gates' compose-test references a real sibling.

## Prompt

> Add a BOOLEAN `surfaceBlockers` gate (default `off`) governing whether advance's SURFACE rung renders a slice/PRD's declared `needsAnswers: true` into an answerable sidecar (`on`) or leaves it silently blocked (`off`). Source: `work/ideas/surface-blockers-gate.md`; ADR `docs/adr/ci-config-policy-and-gate-family.md`. ENABLES `work/prd/runner-in-ci.md`; orthogonal PEER to `observationTriage` (the sibling slice this is `blockedBy` for file-serialisation).
>
> FIRST, drift-check: confirm `observation-triage-tri-state-gate` landed (the `observationTriage` enum gate exists; this slice builds the compose-test against it). Confirm advance's surface rung (`advance.ts` `surfaceRung`) renders declared `needsAnswers` into a sidecar via `persistSurfacedQuestions`, and that an item with `needsAnswers:true` is already build-ineligible (the auto-eligible predicate). If landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: there are TWO question-surfacing gates, `observationTriage` (the raw inbox) and `surfaceBlockers` (declared `needsAnswers` on committed slices/PRDs). They are orthogonal peers; the case this unlocks is `observationTriage: ask|auto` + `surfaceBlockers: off` ("groom my inbox, leave my blocked work alone"). `needs-attention` (a build hit a wall) is SEPARATE and ALWAYS on; `surfaceBlockers` must NOT gate it.
>
> BUILD: (1) the `Config` boolean field + default `false`; (2) the full chain (REPO_ALLOWED_KEYS, boolean env coercion, CLI flag); (3) the read site at the surface rung's declared-`needsAnswers` path. CREATE-vs-CONSUME is DECIDED: gate only the SURFACE (create) phase; do NOT gate `apply` (consuming an answer), an answered sidecar still applies under `off`. The one decision to RECORD: does explicit `advance <slug>`/`prd:` bypass the gate (default: yes, mirroring the other gates).
>
> TEST (TDD, vitest, house style): `off` leaves a `needsAnswers` slice silently blocked (no sidecar); `on` surfaces it; `needs-attention` still surfaces under `off`; the compose-test (`observationTriage: ask` + `surfaceBlockers: off`); explicit-bypass. Isolate shared/global locations to temp fixtures.
>
> "Done" = `surfaceBlockers` resolves through the full chain, the surface rung honours it for declared blockers, `needs-attention` is unaffected, the two gates compose, and the gate is green.
