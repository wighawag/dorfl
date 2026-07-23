---
title: 'Author the convert-from-prd-to-spec skill (drive prd-to-spec, then sweep the prose it skips)'
slug: author-convert-from-prd-to-spec-skill
spec: vocabulary-cutover-prose-sweep-skill
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
---

## What to build

A new operator skill `skills/convert-from-prd-to-spec/SKILL.md` that migrates a repo off the retired `prd` vocabulary end-to-end, so a user invokes ONE thing and the agent drives both halves. It is a protocol-native, runner-agnostic skill doc (like `skills/to-spec/SKILL.md` / `skills/to-task/SKILL.md`) — an operator skill, NOT a `work/protocol/`-mirrored discipline, so it lives ONLY under `skills/` (no `work/protocol/` copy, no `dist/protocol/` vendor).

The skill's authoritative discipline is the two-half orchestration + the reusable pattern toolkit:

1. **Deterministic half — CALL `dorfl prd-to-spec` (do not re-implement it).** The command owns the quiescence gate, the `work/**`+config+refs conversion, the `work/protocol/*` re-sync, idempotency, `--dry-run`, and the forward+reverse leak-scan gate over the converted tree. The skill runs it (`--dry-run` first to preview), reads its report, and only proceeds on a clean/green result. If `dorfl` is not installed, the skill hand-follows the same layers (the command exposes them as documented independent pieces: `checkQuiescence`, `resyncProtocol`, `migrateFolders`, `migrateItemContent`, `migrateConfig`, `migrateRefs`, `scanForLeaks`) — the command is the FAST PATH, not a hard dependency (ADR §9).
2. **Judgement half — sweep the prose the command skips.** Walk the non-`work/` trees (`CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**`/source comments+strings), propose keep-case rewrites of the artifact WORD, and DEFER the ambiguous ones to the human. Offer a preview-only pass (propose rewrites, write nothing) so the human can review the judgement calls before they land, mirroring the command's `--dry-run`.
3. **Acceptance — the widened bi-word leak scan is the PROOF.** The skill ends by running the leak scan over BOTH halves; the repo is done only when the only survivors are marker/backtick/slug/English/provenance.

The skill must TEACH (and point at the existing reference implementation of) the reusable pattern rather than fork its logic:

- The **`''word''` provenance marker** (double-single-quote) for a retired token named ONLY as provenance in a live doc/comment — uniquely greppable, stripped by the scan like a backtick span.
- The **BI-WORD scan** (fail on the retired word OR a reverted-away word, e.g. `brief` from the `spec → brief → spec` thrash).
- The **coined-vs-real-word English asymmetry** (`prd` = zero English collisions; `brief` = real English needing an allow-list + following-noun heuristic).
- The **provenance-vs-living per-tree split** (gate current-guidance docs; EXEMPT terminal-history bodies, dated incident narration in active task bodies, and ADR text that RECORDS what was retired / the migration's pre-cutover INPUT).
- The **concrete IDENTITY allow-list** (never rewrite a `prd`-containing hyphenated slug / filename / `slug:`/`spec:`/`blockedBy:`/`covers:` value / camelCase symbol / historical API name).

The skill points at the existing scans as the reference implementation of the discipline: `packages/dorfl/test/prd-src-prose-leak-scan.test.ts` and `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` already encode the marker-strip, the bi-word lens, the English allow-list, the per-tree scoping, and the enumerated identity allow-list.

Per the maintainer decisions in the spec: it is a NEW standalone skill (not folded into `migrate`); the skill OWNS the doc-sweep coverage (so `dorfl prd-to-spec` is NOT extended with a report-line fallback); it is `prd`-SPECIFIC (authored for the `prd → spec` cutover, not pre-generalised to `<from> → <to>`).

## Acceptance criteria

- `skills/convert-from-prd-to-spec/SKILL.md` exists with valid frontmatter (`name: convert-from-prd-to-spec`, a `description`, `disable-model-invocation: true` like the sibling operator skills), and NO `work/protocol/` mirror or `dist/protocol/` vendor is added (it is an operator skill, not a runner-invoked discipline).
- The doc describes the TWO-HALF orchestration in order: (1) call `dorfl prd-to-spec` (deterministic, gated), (2) prose sweep of the non-`work/` trees, (3) the bi-word leak scan as the acceptance gate over both.
- The doc states the runner-agnostic fallback (complete the cutover by hand when `dorfl` is absent) and names the command's documented independent layers the fallback leans on.
- The doc teaches all five reusable-pattern items (marker, bi-word, English asymmetry, provenance-vs-living split, identity allow-list) and POINTS at the two existing leak-scan tests as the reference implementation (it does not fork the detector logic).
- The doc offers a preview-only (write-nothing) prose pass mirroring the command's `--dry-run`.
- The doc records the three maintainer decisions (standalone skill; skill owns doc-sweep coverage; prd-specific).
- Uses the project's domain vocabulary (`CONTEXT.md`): spec / task / `work/` contract / `dorfl prd-to-spec` / leak scan, keep-case correctly (never introduce a stray `prd`/`brief` artifact-word LEAK in the new doc — the doc names the retired word only in backticks or the `''…''` marker so the WORD leak scan stays green; `skills/**` IS walked by that scan).
- Test coverage: this task's guard (that the skill doc carries its load-bearing discipline) is the sibling task `convert-from-prd-to-spec-skill-doc-conformance-guard`; this task need not add the test itself, but the doc it writes must satisfy that guard's assertions.
- The full acceptance gate is green: `pnpm -r build && pnpm -r test && pnpm format:check` (in particular the two leak scans stay green with the new `skills/` doc present).

## Blocked by

None — can start immediately.

## Prompt

GOAL: author a new operator skill `skills/convert-from-prd-to-spec/SKILL.md` that drives the `prd → spec` vocabulary cutover end-to-end for a repo already on the `work/` contract: it CALLS `dorfl prd-to-spec` for the deterministic+gated half (the `work/**`+config+refs conversion + `work/protocol/*` re-sync + the command's own leak-scan gate) and then does the JUDGEMENT-heavy prose sweep the command deliberately skips (`CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**`/source comments+strings), gated by the widened bi-word leak scan.

DOMAIN VOCABULARY (from `CONTEXT.md`): a **spec** is a north-star doc in `work/specs/`; a **task** is a buildable item in `work/tasks/`; the **`work/` contract** is the on-disk protocol; **`dorfl prd-to-spec`** is the purpose-named migration COMMAND (ADR §7e) whose DATA migration is scoped to `work/**`+config+refs and which ALSO re-syncs `work/protocol/*`. Adopt/convert work is a SKILL, execute work is a COMMAND (ADR §8) — this is why the prose sweep is a skill, not a new command layer.

WHERE TO LOOK (by concept, not brittle paths): the sibling operator skills `skills/to-spec/SKILL.md` and `skills/to-task/SKILL.md` for the skill-doc shape + frontmatter (`disable-model-invocation: true`, protocol-native, no `work/protocol/` mirror). The migration command surface + its documented independent layers in `packages/dorfl/src/prd-to-spec.ts` (`checkQuiescence`, `resyncProtocol`, `migrateFolders`, `migrateItemContent`, `migrateConfig`, `migrateRefs`, `scanForLeaks`, and the `VocabularyMigration`/`MIGRATION` shape). The two existing leak-scan tests `packages/dorfl/test/prd-src-prose-leak-scan.test.ts` and `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` — these are the REFERENCE IMPLEMENTATION of the discipline the skill teaches (the `''…''` marker-strip, the bi-word lens, the English allow-list, the per-tree provenance-vs-living scoping, the enumerated identity allow-list); the skill points at them, it does not fork them. The incubation note `work/notes/ideas/prd-to-spec-sweep-beyond-work-tree-and-reusable-cutover-pattern.md` for the full pattern toolkit and the maintainer's rationale.

CONSTRAINTS / DECISIONS (from the spec `work/specs/tasked/vocabulary-cutover-prose-sweep-skill.md`): (1) a NEW standalone skill named `convert-from-prd-to-spec`, NOT folded into `migrate`; (2) the SKILL owns the doc-sweep coverage — do NOT extend `dorfl prd-to-spec` with a report-line fallback; (3) `prd`-SPECIFIC, authored for the one cutover that exists (not pre-generalised to `<from> → <to>`). Out of scope: re-implementing the DATA migration in the skill, a general `migrate <from> <to>` command, a `doctor` command, editing the generated `.github/workflows/*.yml` (regenerated by `dorfl install-ci`).

WATCH OUT: `skills/**` IS walked by the WORD leak scan, so the new doc must never introduce a stray artifact-word `prd`/`brief` LEAK — name the retired word only inside backticks or the `''…''` provenance marker (both are stripped by the scan). Run `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green before finishing.

DONE = the skill doc exists, carries the two-half orchestration + the runner-agnostic fallback + all five reusable-pattern items + the three decisions + the pointer to the reference-implementation scans, and the full acceptance gate is green (both leak scans included).
