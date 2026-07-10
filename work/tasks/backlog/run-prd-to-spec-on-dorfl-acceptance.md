---
title: Run dorfl prd-to-spec on dorfl itself — the end-to-end acceptance test
slug: run-prd-to-spec-on-dorfl-acceptance
spec: prd-to-spec-vocabulary-cutover-and-migration-command
humanOnly: true
blockedBy: [build-prd-to-spec-migration-command]
covers: [5, 8, 10]
---

## What to build

The final step: run the built `dorfl prd-to-spec` command on THIS repo (dorfl) to convert dorfl's own `work/` data, and treat the result as the command's end-to-end acceptance test on the gnarliest `prd`-using repo in existence (ADR §7e, user story 10).

`humanOnly: true` — this is not a normal agent build task: it mutates the live repo's `work/` tree wholesale (folder moves + ~271 data files + refs) and is the operation the whole spec exists to prove. A human runs it, inspects the diff, and confirms the gate, rather than an agent doing it unattended. (This is a NATURE-of-the-task human gate, per WORK-CONTRACT: wholesale live-data migration of the repo's own ledger.)

Steps (human-driven):
1. Ensure dorfl is quiescent (clean tree, no held lock, no in-flight `work/*` build) — the command will refuse otherwise; that refusal is itself a passing test.
2. Run `dorfl prd-to-spec --dry-run`; inspect the reported changes for correctness across all four layers.
3. Run `dorfl prd-to-spec`; it does the `work/protocol/` mirror re-sync (via its setup step) + all data conversion (`work/specs/* → work/specs/*`, frontmatter incl. `done/`, config, inert refs).
4. Run the full acceptance gate + both leak scans; confirm green.
5. Run the command a SECOND time; confirm it is a no-op (idempotency on the real repo).

## Acceptance criteria

- [ ] `dorfl prd-to-spec` run on dorfl converts `work/specs/* → work/specs/*`, all `prd:` frontmatter → `spec:` (incl. `work/tasks/done/` + `work/specs/tasked/`), `.dorfl.json` keys, and inert `prd-*` refs.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green after migration; forward+reverse leak scans clean on dorfl (the downstream trust signal).
- [ ] A second run is a verified no-op (idempotency on the real repo).
- [ ] The parent spec itself now resides at `work/specs/{ready|tasked}/prd-to-spec-vocabulary-cutover-and-migration-command.md` (it migrated itself — the fitting provenance).
- [ ] Any missed spelling the leak scan catches is fixed by strengthening the COMMAND (exhaustive-by-construction), not by a manual patch — a manual patch would hide a command bug that would then bite downstream.

## Blocked by

- build-prd-to-spec-migration-command (the command must exist and pass its fixture tests before it is trusted on the live repo).

## Prompt

> Goal: run the built `dorfl prd-to-spec` command on THIS repo (dorfl) as the command's end-to-end acceptance test, converting dorfl's own `work/` data to `spec` and confirming the full gate + both leak scans green, plus idempotency. Read the parent spec `work/specs/*/prd-to-spec-vocabulary-cutover-and-migration-command.md` (ADR §7e, user story 10). This task is `humanOnly` — a human runs the wholesale live-ledger migration and inspects it; do not run it unattended.
>
> Domain vocabulary: because the command touches only data/config/refs (never contract text), running it on dorfl after the source part landed is a real end-to-end test — dorfl is the hardest `prd` repo, so a green leak scan here is the trust signal for downstream users. The command does dorfl's `work/protocol/` mirror re-sync via its setup step AND all data conversion; there is NO hand-sweep.
>
> Steps: verify quiescence (a refusal is a passing test) → `--dry-run` + inspect → run → full gate + leak scans → second run is a no-op. If the leak scan catches a missed spelling, fix the COMMAND (make it exhaustive), not the repo by hand — a manual patch hides a bug that bites downstream.
>
> Done means: dorfl now speaks `spec` end-to-end (data included), the gate + scans are green, the migration is idempotent, and the parent spec has migrated ITSELF into `work/specs/`.
>
> FIRST check drift: confirm `build-prd-to-spec-migration-command` landed and its fixture tests pass; confirm dorfl's source part is fully `spec` (else the command will mis-target).
