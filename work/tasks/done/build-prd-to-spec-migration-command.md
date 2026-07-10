---
title: Build the self-contained dorfl spec-to-spec migration command (engine + fixture test)
slug: build-prd-to-spec-migration-command
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [contract-spec-hard-cutover-rejection-and-leak-scan]
covers: [4, 5, 6, 7, 9]
---

## What to build

The new `dorfl spec-to-spec` CLI verb: self-contained (decision B), mechanical DATA migration only (it does NOT author contract text — the contract arrives via the setup-re-sync it invokes). Thin command shell over a reusable data-migration ENGINE (user story 9).

Behaviour:
1. **Quiescence check (refuse loudly):** clean working tree AND no held lock AND no in-progress `work/spec-*`/`work/spec-*` work-branch carrying unlanded work. On failure, exit non-zero naming the offending lock/branch. (Matches ADR §7e decision 1a.)
2. **Setup re-sync FIRST:** invoke the `setup` protocol-doc re-sync so the target repo's `work/protocol/*` picks up the new `spec` contract from the (already-upgraded) package. Idempotent.
3. **Data migration (deterministic, all four layers):** (a) FOLDERS `work/specs/{proposed,ready,tasked,dropped}/ → work/specs/…` via `git mv`; (b) FRONTMATTER/body `prd: → spec:`, `taskedAfter` prose, path refs — across ALL data items INCLUDING `work/tasks/done/` and `work/specs/tasked/` (done-items ARE converted — determinism); (c) CONFIG `.dorfl.json` (`prdsLandIn → specsLandIn`, intake type keys, `taskingIntegration` values naming spec folders); (d) LIVE GIT REFS (lock-refs `refs/dorfl/lock/prd-<slug>` and work-branches `work/spec-<slug>` — but per the quiescence gate there are none held/in-flight, so this is renaming only inert refs).
4. **`--dry-run`:** report exactly what would change across (a)–(d), touching nothing.
5. **Idempotent:** a second run on an already-migrated repo is a no-op.
6. The forward+reverse **leak scan is the acceptance gate** for the command's output (reuse the engine from the contract task where possible).

Reuse the ENGINE pieces (factor them so a future cutover reuses them): quiescence check, setup-re-sync invocation, keep-case sweep, folder-move-in-lockstep-with-`work-layout.ts`, config-key rewrite, ref rename, leak scan. Evaluate the npm `change-name`/`change-case` tooling for the keep-case sweep vs a bespoke implementation (parent spec "Rename TOOLING") — record the choice; the leak scan stays the proof regardless.

Test at the behavioural seam with a FIXTURE repo (temp/scratch, isolated — do NOT touch the real repo or a real home dir): a `work/` tree carrying all four layers (a `specs/*` item, a task with `prd:` frontmatter incl. a `done/` item, a `.dorfl.json` with `prdsLandIn`, an inert `prd-<slug>` ref/branch) → assert deterministic conversion, accurate `--dry-run` (no writes), idempotency, and refuse-on-dirty-tree / held-lock / in-progress-branch naming the offender, and a green leak scan on the converted fixture.

## Acceptance criteria

- [ ] `dorfl spec-to-spec` exists; runs quiescence → setup-re-sync → data migration; `--dry-run` + idempotent.
- [ ] Converts all four layers incl. `done/` + `tasked/` items and inert `prd-*` refs/branches; refuses (naming offender) on dirty tree / held lock / in-progress branch.
- [ ] Engine factored into reusable pieces; the `change-name`/bespoke choice recorded (ADR or module JSDoc if it meets the ADR gate).
- [ ] Fixture-repo test covers: deterministic conversion, dry-run-no-writes, idempotency, each refusal path (offender named), leak-scan-green-on-output. Fixtures ISOLATE all writes to temp; the real repo/home is untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- contract-spec-hard-cutover-rejection-and-leak-scan (the command reads the new `spec` `work-layout.ts` folder names + reuses the leak-scan engine; the whole source part must speak `spec` first).

## Prompt

> Goal: build the self-contained `dorfl spec-to-spec` CLI verb — quiescence check → setup contract re-sync → deterministic four-layer DATA migration (folders, frontmatter incl. `done/`, config, inert refs) → `--dry-run` + idempotent, with the forward+reverse leak scan as the acceptance gate. Thin command shell over a REUSABLE engine. Read the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (esp. ADR §7e, user stories 4–9) + `work/protocol/CLAIM-PROTOCOL.md` for the command conventions.
>
> Domain vocabulary: the migration splits at the contract-version boundary — the CODE/CONTRACT already speak `spec` (prior tasks); this command migrates a repo's DATA to match. Decision B = self-contained (setup-re-sync first, then data). Quiescence-required (1a) = refuse on dirty tree / held lock / in-progress `work/spec-*` branch. Done-items ARE converted (determinism). The engine is factored so a future cutover reuses it, but the verb stays purpose-named.
>
> Where to look: `cli.ts` (verb registration), `setup`'s re-sync path, `work-layout.ts` (folder source of truth), `slug-namespace.ts` (ref token), `gc`/`scan` (existing work-tree walkers to model on), the contract task's leak-scan engine. Evaluate npm `change-name`/`change-case` for the keep-case sweep. Test with an ISOLATED fixture repo (temp dir), never the real repo/home.
>
> Done means: the command works end-to-end on the fixture (all layers, dry-run, idempotent, every refusal path), the engine is reusable, the tooling choice is recorded, and the full gate is green. (Running it on dorfl itself is the SEPARATE next task.)
>
> FIRST check drift: confirm the source-part cutover fully landed (batches 1–5 + contract) — the command depends on `work-layout.ts` already saying `spec`. If any `spec` identity survives in the code, that source-part task has not landed and this one should wait.
