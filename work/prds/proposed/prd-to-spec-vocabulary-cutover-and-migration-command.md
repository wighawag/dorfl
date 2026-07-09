---
title: prd → spec vocabulary cutover + a self-contained prd-to-spec migration command
slug: prd-to-spec-vocabulary-cutover-and-migration-command
humanOnly: true
needsAnswers: false
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

> One of the LAST artifacts this repo authors under the `prd` vocabulary. Its own migration renames `work/prds/proposed/<this>.md` → `work/specs/proposed/<this>.md` and flips its own filename/vocabulary — fitting provenance.

> Durable rationale + all resolved decisions live in `docs/adr/methodology-and-skills.md` §7 (v1.1 alignment). This prd SEEDS the tasking; §7 is the source of truth for the WHY and the decision record. Read §7 before tasking.

## Problem Statement

Matt Pocock's engineering skills (which we track as canonical, `docs/adr/methodology-and-skills.md`) reached v1.1 and renamed `to-prd → to-spec`, on the correct insight that what the skill produces was never a product-requirements document (product-only) but a **specification** (technical, non-technical, or a blend). The same leak applies to us: our `prd` bodies carry technical and testing decisions that are not product requirements. Our own history confirms the noun is wrong — we renamed `prd → brief` and then reverted `brief → prd` (`403a5be9`, 2026-06-24), two attempts circling a noun that never fit. `spec` is the word both attempts were reaching for: broader than `prd`, less soft than `brief`.

So the user-facing and code vocabulary must cut over from `prd` to `spec` (folders, frontmatter, CLI verb, config keys, lock-ref token, the `to-prd` skill, the protocol contract, ~2025 source occurrences). Two prior cutovers of this exact shape (`slice/prd → task/brief`, `brief → prd`) prove the mechanics but also expose the hazard: the `brief → prd` revert LEFT lingering `brief` references in live code (`config.ts`, `frontmatter.ts`, `close-job.ts`, `verify-workflow-template.ts`, …) — a hand-sweep missed spellings nobody enumerated. A repeat by hand would leak again.

Separately, downstream repos that adopted dorfl-with-`prd` need a DETERMINISTIC way to convert their own `work/` data + config + refs — they cannot hand-run the cutover. There is no `migrate`/`convert` command today.

## Solution

Split the cutover at the **contract-version boundary** (ADR §7e), into a source part authored by hand in dorfl and a reusable command that does the mechanical data migration — with dorfl's own migration serving as the command's acceptance test.

- **Source part (hand-authored in dorfl):** (1) rewrite the `spec` work-contract in `skills/setup/protocol/*` (`WORK-CONTRACT.md`, `TASKING-PROTOCOL.md`, templates, `to-prd → to-spec` skill), and (2) rename the dorfl CODE (`packages/dorfl/src`: `work-layout.ts` folder keys/values, config-key definitions, CLI verb `do prd: → do spec:`, the lock-ref/work-branch namespace token in `slug-namespace.ts`, hard-cutover rejection tests, leak scans). This makes dorfl SPEAK `spec`. It is a wide refactor — sequence it expand → migrate → contract (`TASKING-PROTOCOL.md` §3a).

- **Command part (`dorfl prd-to-spec`, self-contained — decision B):** a new CLI verb that (a) runs the `setup` re-sync FIRST (so the target repo's `work/protocol/` picks up the new `spec` contract from the upgraded package), THEN (b) mechanically converts the repo's `work/` DATA + config + refs from `prd` to `spec`. One command for a downstream user. It does NOT author contract text — it only invokes the source-authored setup sync + migrates data.

- **dorfl's own migration = the acceptance test.** After the source part lands and the command is built, RUN `dorfl prd-to-spec` on dorfl itself: it does dorfl's `work/protocol/` mirror re-sync (via its setup step) AND all of dorfl's data conversion (`work/prds/* → work/specs/*`, frontmatter, config, refs). Dorfl is the gnarliest `prd`-using repo, so a green forward+reverse leak scan on dorfl is the trust signal for downstream. No hand-sweep of dorfl's data; the command does it.

## User Stories

1. As a dorfl maintainer, I want the whole `prd` vocabulary renamed to `spec` (folders, frontmatter, CLI verb, config keys, lock-ref token, protocol docs, the `to-prd` skill), so that the artifact is named for what it actually is and we re-converge with canonical Matt Pocock v1.1.
2. As a dorfl maintainer, I want the `to-prd` skill renamed to `to-spec` (in-repo `git mv skills/to-prd skills/to-spec`, updating its frontmatter/body and every reference), so the producer skill matches the noun.
3. As a dorfl maintainer, I want the rename sequenced as a wide refactor (expand → migrate-batches → contract per `TASKING-PROTOCOL.md` §3a), so each task lands green and the review is per-batch, not one unreviewable diff.
4. As a downstream dorfl user, I want a single `dorfl prd-to-spec` command that upgrades my contract (setup re-sync) AND migrates my `work/` data + config + refs, so I convert in one step after upgrading the package.
5. As a downstream dorfl user, I want the command to convert EVERY data item including `work/tasks/done/` and `work/specs/tasked/`, so my repo is internally consistent and no `prd:` reference is left dangling.
6. As a downstream dorfl user, I want the command to REFUSE to run unless my repo is quiescent (clean tree, no held lock, no in-progress `work/prd-*` branch), naming the offending lock/branch, so it never corrupts in-flight work.
7. As a downstream dorfl user, I want a `--dry-run` that reports exactly what would change before anything is touched, and idempotent re-runs (a no-op on an already-migrated repo), so the migration is safe to preview and safe to re-run.
8. As a dorfl maintainer, I want the command's forward+reverse leak scan to be the acceptance GATE (green on dorfl before trusting it downstream), so a missed spelling — the `brief`-leftover failure of `403a5be9` — is caught by construction, not by hope.
9. As a dorfl maintainer, I want the command's data-migration ENGINE factored into reusable pieces (quiescence check, setup-re-sync invocation, keep-case sweep, folder-move-in-lockstep-with-`work-layout.ts`, config-key rewrite, leak scan), so a future vocabulary cutover reuses the structure rather than re-deriving it — even though the verb itself stays purpose-named `prd-to-spec`.
10. As a dorfl maintainer, I want dorfl's own cutover to be the command's end-to-end test (author source part → build command → run command on dorfl), so we never hand-sweep dorfl's data and we validate the command on the hardest real repo.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (set):** a human must drive the TASKING of this prd. It is a vocabulary/naming decision with load-bearing clean-break choices (the noun `spec`, the contract-boundary split, done-items-converted, quiescence-required) that a human should own before fan-out. This does NOT propagate to the tasks' gates — most emitted tasks are agent-buildable (mechanical rename batches, the command build). The tasker sets each task's gate from its own build-nature.
- **`needsAnswers: false`:** every decision is resolved in ADR §7 (adopt `spec`, decline `ticket`, decision B self-contained command, quiescence-required 1a, done-items converted, leak-scan-as-gate). No open questions block tasking.

## Implementation Decisions

> Trimmed at tasking-time: this detail moves into the tasks (what to build) and, where durable, is ALREADY in ADR §7. It is here only to seed the tasking.

- **Clean break, no migration window** (this repo owes no external users one — matches `allowAgents → autoBuild` and `slice → task` precedents). Keep-case sweep of all six casings (`spec/specs/Spec/Specs/SPEC/SPECS`), protecting provenance slugs and genuine English via sentinels.
- **`spec` collides with common English/test vocabulary** (`.spec.ts`, `specify`, `specific`, `specification`) far more than `prd` did, so the REVERSE leak scan + sentinel protection matter MORE than in prior cutovers. The forward direction (`prd → spec`) is the safe one.
- **Rename MECHANICS — PRE-ISOLATE the false-positive words FIRST (the proven `brief` technique).** A keep-case substring sweep of `prd → spec` is dangerous precisely because `spec` appears INSIDE genuine words that have nothing to do with the artifact (`specify`, `specific`, `specification`, `.spec.ts`, `respectively`, `especially`, `spectrum`). The `403a5be9` `brief` cutover handled the mirror-image problem (`briefly`, `briefing`, `briefcase`, `debrief`) by PROTECTING those words with control-char sentinels during the sweep. The sharper technique the maintainer prefers: **first, in a SEPARATE prefactor pass, rename every artifact-unrelated word that contains the target substring to a synonym** (e.g. an artifact-unrelated `specify` → `require`, `specific` → `particular`), so the ambiguous substring survives ONLY where it means the artifact — THEN the bulk sweep is unambiguous and needs no sentinel gymnastics. This runs as the FIRST expand-phase task(s) (`TASKING-PROTOCOL.md` §3a) before any `prd → spec` edit. (Note: retired PRIOR words can survive as live code identifiers — `via: 'brief'` is still a discriminated-union tag in `close-job.ts`/`frontmatter.ts` today — confirming that a substring sweep missing a spelling is a REAL, current failure mode, not hypothetical.)
- **Rename TOOLING — evaluate a bulk-identifier-rename tool (e.g. the npm `change-name` package) vs the bespoke sweep.** `change-name` recursively renames identifiers across file/dir NAMES and file CONTENTS with all case-variant transformations (camelCase/PascalCase/kebab/CONSTANT/…), excluding `.git`/`node_modules` — which is most of the keep-case sweep mechanic we hand-rolled in `403a5be9`. At tasking time, evaluate using it (or `change-case` as the case primitive) for BOTH the source-part code rename AND the migration command's data-conversion engine, so we do not re-hand-roll case handling. Constraint: whatever tool is chosen, the forward+reverse leak scan stays the ACCEPTANCE GATE (the tool is the mechanism, the scan is the proof), and the pre-isolation pass above still runs first so the tool's substring matching is safe.
- **Surfaces (source part):** folders `work/prds/{proposed,ready,tasked,dropped}/ → work/specs/…` in lockstep with `work-layout.ts` keys/values + `PRD_FOLDERS`/`PrdFolder` + the self-renaming-folder guard; frontmatter `prd: → spec:` and `taskedAfter` prose; CLI verb `do prd: → do spec:` and `--prds-land-in → --specs-land-in`; config `prdsLandIn → specsLandIn`, intake type key `{task, prd} → {task, spec}`; the lock-ref/work-branch namespace token `prd- → spec-` in `slug-namespace.ts` (`SlugNamespace` `'prd' → 'spec'`); the hard-cutover rejection tests (flip the now-dead `prd:` token to rejected, `spec:` to live); `to-prd → to-spec` skill; protocol source `skills/setup/protocol/*` (the mirror is written BY the command's setup step, not hand-mirrored — decision B).
- **Command (`prd-to-spec`) contract (ADR §7e):** self-contained (setup-re-sync then data-migration); converts the FOUR data layers — folders (`git mv`), frontmatter/body incl. `done/` + `tasked/`, config (`.dorfl.json`), and live git refs (lock-refs `refs/dorfl/lock/prd-<slug>`, work-branches `work/prd-<slug>`); quiescence-required (refuse on dirty tree / held lock / in-progress `work/prd-*` branch, naming the offender); `--dry-run`; idempotent; forward+reverse leak scan as the gate. Thin command shell over a reusable data-migration engine.
- **Closest existing verbs/seams to model on / extend:** `setup` skill (the re-sync the command invokes); `work-layout.ts` (folder-name source of truth); `slug-namespace.ts` (ref token identity); `gc`/`scan` (existing work-tree walkers); the `403a5be9` commit + `code-identifier-slice-prd-to-task-brief-rename` prd (the prior clean-break playbook to reuse). Confirm exact seams against live code at tasking time (a prd is a launch snapshot — verify before slicing).

## Testing Decisions

> Also trimmed at tasking-time (moves into tasks' acceptance criteria / an ADR).

- **Test the command at its behavioural seam, not internals:** a fixture `work/` repo carrying all four layers (`work/prds/*` folders with items, tasks with `prd:` frontmatter incl. a `done/` item, a `.dorfl.json` with `prdsLandIn`, and lock-refs / a `work/prd-*` branch) → assert deterministic conversion to `spec`, a `--dry-run` that changes nothing but reports accurately, idempotency (second run = no-op), refuse-on-held-lock / dirty-tree / in-progress-branch (naming the offender), and a GREEN forward+reverse leak scan.
- **The source-part rename tasks** keep `pnpm -r build && pnpm -r test && pnpm format:check` green per batch, and update the coupled doc-consistency/hard-cutover tests in the SAME task as the rename they assert (prior-art: the `slice/prd → task/brief` cutover tasks).
- **dorfl's own migration is the integration test:** running `dorfl prd-to-spec` on dorfl must land the full acceptance gate green (build + tests + format:check) with both leak scans clean — the trust signal for downstream.

## Out of Scope

- **Adopting Matt's `ticket` / `to-tickets` noun.** Explicitly DECLINED (ADR §7b): we keep `task`; `ticket` is more tracker-flavoured than `task`, `issue:` is a load-bearing distinct frontmatter concept, and the decline keeps a dorfl+Matt repo legible.
- **Active mid-flight ref renaming.** Rejected in favour of quiescence-required (ADR §7e, decision 1a): the command does not rename a held lock or an in-progress branch; the user lands in-flight work first.
- **A general `migrate <from> <to>` verb.** The verb stays purpose-named `prd-to-spec`; only the internal engine is reusable (ADR §7e).
- **Rewriting landed git-commit MESSAGES.** The command rewrites FILES for internal consistency (incl. `done/`), not git history.
- **The expand → contract discipline doc itself.** Already backported into `TASKING-PROTOCOL.md` §3a (ADR §7c) ahead of this prd; this prd only USES it.

## Further Notes

- Sequencing (ADR §7f): (1) ADR §7 [done], (2) `TASKING-PROTOCOL.md` §3a backport [done], (3) this prd → task it, (4) source part (contract + code, expand→migrate→contract), (5) build `prd-to-spec` command, (6) run it on dorfl = the acceptance test.
- The source part must land BEFORE the command runs on dorfl (the command's setup-re-sync step reads the new `skills/setup/protocol/*`, and its code reads the new `work-layout.ts` folder names). Encode that as `blockedBy` in the emitted tasks.
