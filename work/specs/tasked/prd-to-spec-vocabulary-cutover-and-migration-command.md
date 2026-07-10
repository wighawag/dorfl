---
title: prd → spec vocabulary cutover + a self-contained prd-to-spec migration command
slug: prd-to-spec-vocabulary-cutover-and-migration-command
humanOnly: true
needsAnswers: false
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

> One of the LAST artifacts this repo authors under the `prd` vocabulary. Its own migration renames `work/specs/proposed/<this>.md` → `work/specs/proposed/<this>.md` and flips its own filename/vocabulary — fitting provenance.

> Durable rationale + all resolved decisions live in `docs/adr/methodology-and-skills.md` §7 (v1.1 alignment). This prd SEEDS the tasking; §7 is the source of truth for the WHY and the decision record. Read §7 before tasking.

## Problem Statement

Matt Pocock's engineering skills (which we track as canonical, `docs/adr/methodology-and-skills.md`) reached v1.1 and renamed `to-prd → to-spec`, on the correct insight that what the skill produces was never a product-requirements document (product-only) but a **specification** (technical, non-technical, or a blend). The same leak applies to us: our `prd` bodies carry technical and testing decisions that are not product requirements. Our own history confirms the noun is wrong — we renamed `prd → brief` and then reverted `brief → prd` (`403a5be9`, 2026-06-24), two attempts circling a noun that never fit. `spec` is the word both attempts were reaching for: broader than `prd`, less soft than `brief`.

So the user-facing and code vocabulary must cut over from `prd` to `spec` (folders, frontmatter, CLI verb, config keys, lock-ref token, the `to-prd` skill, the protocol contract, ~2025 source occurrences). Two prior cutovers of this exact shape (`slice/prd → task/brief`, `brief → prd`) prove the mechanics but also expose the hazard: the `brief → prd` revert LEFT ~22 lingering `brief` references in live code (`config.ts`, `frontmatter.ts`, `close-job.ts` — incl. the `via: 'brief'` discriminated-union tag — `verify-workflow-template.ts`, …) that mean the SAME artifact — a hand-sweep missed spellings nobody enumerated. **This cutover therefore has scope `{prd, brief} → spec`** (fold the leftover `brief` in rather than leave a third wrong spelling), and the leak-scan gate is BI-WORD so a stray `prd` OR `brief` fails it — the structural fix so a repeat cannot leak again.

Separately, downstream repos that adopted dorfl-with-`prd` need a DETERMINISTIC way to convert their own `work/` data + config + refs — they cannot hand-run the cutover. There is no `migrate`/`convert` command today.

## Solution

Split the cutover at the **contract-version boundary** (ADR §7e), into a source part authored by hand in dorfl and a reusable command that does the mechanical data migration — with dorfl's own migration serving as the command's acceptance test.

- **Source part (hand-authored in dorfl):** (1) rewrite the `spec` work-contract in `skills/setup/protocol/*` (`WORK-CONTRACT.md`, `TASKING-PROTOCOL.md`, templates, `to-prd → to-spec` skill), and (2) rename the dorfl CODE (`packages/dorfl/src`: `work-layout.ts` folder keys/values, config-key definitions, CLI verb `do prd: → do spec:`, the lock-ref/work-branch namespace token in `slug-namespace.ts`, hard-cutover rejection tests, leak scans). This makes dorfl SPEAK `spec`. It is a wide refactor — sequence it expand → migrate → contract (`TASKING-PROTOCOL.md` §3a).

- **Command part (`dorfl prd-to-spec`, self-contained — decision B):** a new CLI verb that (a) runs the `setup` re-sync FIRST (so the target repo's `work/protocol/` picks up the new `spec` contract from the upgraded package), THEN (b) mechanically converts the repo's `work/` DATA + config + refs from `prd` to `spec`. One command for a downstream user. It does NOT author contract text — it only invokes the source-authored setup sync + migrates data.

- **dorfl's own migration = the acceptance test.** After the source part lands and the command is built, RUN `dorfl prd-to-spec` on dorfl itself: it does dorfl's `work/protocol/` mirror re-sync (via its setup step) AND all of dorfl's data conversion (`work/specs/* → work/specs/*`, frontmatter, config, refs). Dorfl is the gnarliest `prd`-using repo, so a green forward+reverse leak scan on dorfl is the trust signal for downstream. No hand-sweep of dorfl's data; the command does it.

## User Stories

1. As a dorfl maintainer, I want the whole `prd` vocabulary renamed to `spec` (folders, frontmatter, CLI verb, config keys, lock-ref token, protocol docs, the `to-prd` skill), so that the artifact is named for what it actually is and we re-converge with canonical Matt Pocock v1.1.
2. As a dorfl maintainer, I want the `to-prd` skill renamed to `to-spec` (in-repo `git mv skills/to-prd skills/to-spec`, updating its frontmatter/body and every reference), so the producer skill matches the noun.
3. As a dorfl maintainer, I want the rename sequenced as a wide refactor (expand → migrate-batches → contract per `TASKING-PROTOCOL.md` §3a), so each task lands green and the review is per-batch, not one unreviewable diff.
4. As a downstream dorfl user, I want a single `dorfl prd-to-spec` command that upgrades my contract (setup re-sync) AND migrates my `work/` data + config + refs, so I convert in one step after upgrading the package.
5. As a downstream dorfl user, I want the command to convert EVERY data item including `work/tasks/done/` and `work/specs/tasked/`, so my repo is internally consistent and no `prd:` reference is left dangling.
6. As a downstream dorfl user, I want the command to REFUSE to run unless my repo is quiescent (clean tree, no held lock, no in-progress `work/spec-*` branch), naming the offending lock/branch, so it never corrupts in-flight work.
7. As a downstream dorfl user, I want a `--dry-run` that reports exactly what would change before anything is touched, and idempotent re-runs (a no-op on an already-migrated repo), so the migration is safe to preview and safe to re-run.
8. As a dorfl maintainer, I want the command's forward+reverse leak scan to be the BI-WORD acceptance GATE (fails on a stray `prd` OR `brief`, green on dorfl before trusting it downstream), so a missed spelling — the `brief`-leftover failure of `403a5be9`, incl. the live `via: 'brief'` tag — is caught by construction, not by hope.
11. As a dorfl maintainer, I want the ~22 leftover `brief` remnants (the doubly-retired word that still means the artifact, incl. the `via: 'brief'` union tag) swept to `spec` in the same cutover, so the code is coherently `spec` end-to-end with no third stale spelling.
9. As a dorfl maintainer, I want the command's data-migration ENGINE factored into reusable pieces (quiescence check, setup-re-sync invocation, keep-case sweep, folder-move-in-lockstep-with-`work-layout.ts`, config-key rewrite, leak scan), so a future vocabulary cutover reuses the structure rather than re-deriving it — even though the verb itself stays purpose-named `prd-to-spec`.
10. As a dorfl maintainer, I want dorfl's own cutover to be the command's end-to-end test (author source part → build command → run command on dorfl), so we never hand-sweep dorfl's data and we validate the command on the hardest real repo.

### Autonomy notes (the two gate axes)

- **`humanOnly: true` (set):** a human must drive the TASKING of this prd. It is a vocabulary/naming decision with load-bearing clean-break choices (the noun `spec`, the contract-boundary split, done-items-converted, quiescence-required) that a human should own before fan-out. This does NOT propagate to the tasks' gates — most emitted tasks are agent-buildable (mechanical rename batches, the command build). The tasker sets each task's gate from its own build-nature.
- **`needsAnswers: false`:** every decision is resolved in ADR §7 (adopt `spec`, decline `ticket`, decision B self-contained command, quiescence-required 1a, done-items converted, leak-scan-as-gate). No open questions block tasking.

> **Tasked-out (2026-07-09):** the per-surface Implementation + Testing detail that seeded the tasking now lives in the emitted tasks under `work/tasks/backlog/` (a linear expand→migrate→contract chain: `preisolate-spec-false-positive-words` → `rename-spec-work-layout-and-folders` → `…-frontmatter-field-and-slug-namespace` → `…-config-and-intake` → `…-remaining-src-modules` → `…-protocol-contract-and-to-spec-skill` → `contract-spec-hard-cutover-rejection-and-leak-scan` → `build-prd-to-spec-migration-command` → `run-prd-to-spec-on-dorfl-acceptance`), and the durable rationale lives in ADR `docs/adr/methodology-and-skills.md` §7. This spec has settled to its durable framing (Problem / Solution / User Stories / Out of Scope).

## Out of Scope

- **Adopting Matt's `ticket` / `to-tickets` noun.** Explicitly DECLINED (ADR §7b): we keep `task`; `ticket` is more tracker-flavoured than `task`, `issue:` is a load-bearing distinct frontmatter concept, and the decline keeps a dorfl+Matt repo legible.
- **Active mid-flight ref renaming.** Rejected in favour of quiescence-required (ADR §7e, decision 1a): the command does not rename a held lock or an in-progress branch; the user lands in-flight work first.
- **A general `migrate <from> <to>` verb.** The verb stays purpose-named `prd-to-spec`; only the internal engine is reusable (ADR §7e).
- **Rewriting landed git-commit MESSAGES.** The command rewrites FILES for internal consistency (incl. `done/`), not git history.
- **The expand → contract discipline doc itself.** Already backported into `TASKING-PROTOCOL.md` §3a (ADR §7c) ahead of this prd; this prd only USES it.

## Further Notes

- Sequencing (ADR §7f): (1) ADR §7 [done], (2) `TASKING-PROTOCOL.md` §3a backport [done], (3) this prd → task it, (4) source part (contract + code, expand→migrate→contract), (5) build `prd-to-spec` command, (6) run it on dorfl = the acceptance test.
- The source part must land BEFORE the command runs on dorfl (the command's setup-re-sync step reads the new `skills/setup/protocol/*`, and its code reads the new `work-layout.ts` folder names). Encode that as `blockedBy` in the emitted tasks.
