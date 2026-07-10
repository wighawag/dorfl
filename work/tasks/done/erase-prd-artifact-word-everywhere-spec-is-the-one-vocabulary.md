---
title: Erase the `spec` artifact WORD everywhere it is the concept — make `spec` the one vocabulary across all trees (prose + paths), preserving slug-identities / code aliases / English
slug: erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary
spec: prd-to-spec-vocabulary-cutover-and-migration-command
covers: []
---

## What to build

Human decision (2026-07-10, Approach 1): make the repo read as if `spec` was ALWAYS `spec` — sweep the artifact WORD `spec`/`SPEC`/`Spec` → `spec`/`SPEC`/`Spec` (keep-case) and `work/specs/ → work/specs/` (+ bare `specs/<lifecycle>`) across EVERY tree where it is the concept, INCLUDING terminal `work/` history (spec and spec name the same thing, so normalizing history is honest, not falsifying). Extend the leak scan to GATE these trees so it can never silently re-drift.

Scope-in TREES (sweep the artifact word + folder paths):
- `CONTEXT.md` (the domain glossary — currently has a whole `**spec**` entry + `work/specs/` lifecycle), `README.md`, `AGENTS.md`.
- `skills/*/SKILL.md` (living skill instructions) — EXCLUDING `skills/setup/protocol/*` (already cut over) and `skills/to-spec/` (already renamed; sweep any residual body prose).
- `docs/**` INCLUDING `docs/adr/*` (human chose uniform; the ADR §7 "read spec as spec" note can be simplified once the text itself says spec).
- ALL of `work/**` — active AND terminal: `tasks/{ready,backlog,done,cancelled}`, `specs/{proposed,ready,tasked,dropped}`, `notes/{observations,ideas,findings}`, `questions/`. (~9700 total occurrences repo-wide; the vast majority are the artifact word in prose.)
- The ONE residual CODE leak: `packages/dorfl/src/tasking.ts` `buildTaskingSpec` — its two `work/specs/ready/` / `work/specs/tasked/` PROMPT-STRING literals (ideally via `workFolderRel('specs-ready'/'specs-tasked')`) + its JSDoc prose; re-point `tasking-protocol-doc.test.ts`'s builder-body assertions from `/work\/specs\/(ready|tasked)\//` to `/work\/specs\/…/`.

## The PRESERVE list (do NOT rewrite — the crux; these are NOT the artifact word)

1. **Every `spec`-containing SLUG token / file identity / cross-reference** — a hyphenated slug like `prd-to-spec-vocabulary-cutover-and-migration-command`, `prd-complete-query`, `close-job-via-spec-to-brief-rename`, `code-identifier-slice-prd-to-task-brief-rename`, `example-spec`, `my-spec`, `cross-spec`, `folder-taxonomy-and-prd-edit-handshake`, the `spec-to-spec-*` observation/note filenames, etc. (~82 distinct tokens). These are FILE BASENAMES + `spec:`/`blockedBy:`/`covers:`/link targets: rewriting the word inside them renames files and desyncs references. A slug is a PROPER NOUN naming a past thing; `spec-to-spec` is the command's own published name (`dorfl spec-to-spec`) and MUST keep `spec`. Rule: if the `spec` is inside a `[a-z0-9]+-…-…` hyphenated identifier, a filename, a code-fence path, or a frontmatter `slug:`/`spec:`/`blockedBy:`/`covers:` value — LEAVE it.
2. **The live CODE back-compat aliases (published in dorfl 0.1.x):** `parseFrontmatter`'s `key === 'spec' || key === 'spec'` dual read (frontmatter.ts); the `do prd:`/`advance prd:` VERB dispatch that still ACCEPTS `prd:` as a CLI alias; any `namespace === 'spec'` / `case 'spec'` value-consumer that stayed for that alias. These keep un-migrated downstream repos working — do NOT remove. (Their surrounding PROSE/comments MAY flip to spec; the token in the code condition stays.)
3. **camelCase API-name mentions in terminal history** — `renderPrdBody`, `prdTitle`/`prdBody`, `LedgerPrdPool` etc. appearing in `work/tasks/done/` bodies are the NAMES of (now-renamed) symbols AS THEY WERE at build time — part of the historical record of that task. Leave them (they're proper-noun API names in a past-tense record), OR flip only the free-word `spec` around them. Do not invent `renderSpecBody` where the done-record legitimately describes the old `renderPrdBody`.
4. **Genuine English** (the bi-word `brief` half): `debrief`, `briefly`, `briefing`, `briefcase`. (`spec` itself has zero English collisions.)
5. **`.git/`, `node_modules/`, lockfiles, compiled `.github/workflows/*` (human regen via install-ci).**

## Leak-scan extension (enforce-by-construction, so it can't re-drift)

Extend the source-part leak scan (`spec-to-spec-leak-scan.test.ts`) — OR add a sibling scan — to also walk `CONTEXT.md`/`README.md`/`AGENTS.md`/`skills/` (non-protocol)/`docs/`/`work/**` and FAIL on a standalone artifact-word `spec`/`SPEC` or a `work/specs/`/`specs/<lifecycle>` path OUTSIDE the enumerated PRESERVE allow-list (the ~82 slug tokens + the 2 code aliases + English). The allow-list is CONCRETE + each-entry-justified (a slug is a file identity; an alias is published back-compat). This is the deferred "tree-wide gate over work/" the contract-task note flagged as the final-task's — now do it, but WORD-scoped (not the structural-only data scan the migration command runs).

## Acceptance criteria

- [ ] No standalone artifact-word `spec`/`SPEC`/`Spec` and no `work/specs/`/`specs/<lifecycle>` path remain in `CONTEXT.md`/`README.md`/`AGENTS.md`/`skills` (non-protocol)/`docs`/`work/**`, EXCEPT the enumerated PRESERVE set (slug-identities, code aliases, camelCase historical API names, English).
- [ ] `CONTEXT.md` glossary + `README.md` layout teach `spec` / `work/specs/` (the `**spec**` glossary entry becomes `**spec**`).
- [ ] `tasking.ts` `buildTaskingSpec` emits `work/specs/…` (not `work/specs/…`); `tasking-protocol-doc.test.ts` builder-body assertions updated; the runtime tasking prompt points a fresh agent at a path that EXISTS in a migrated repo.
- [ ] The live code back-compat aliases (`prd:` KEY read, `do prd:` verb) are UNTOUCHED; slug-identities + cross-refs UNTOUCHED (no file renamed, no `spec:`/`blockedBy:`/`covers:` value changed).
- [ ] An extended WORD-scoped leak scan gates all the swept trees with a concrete justified allow-list; it FAILS on a re-introduced stray artifact-word `spec`.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; a `dorfl` changeset added; `work/protocol/` mirror still byte-identical to source (this task does not touch protocol source, already done).

## Open questions

1. camelCase historical API names in `tasks/done/` (`renderPrdBody`, `prdTitle`): leave verbatim as the point-in-time record (this task's default), or flip the free-word `spec` around them while keeping the symbol name? (Default: leave the symbol name; flip surrounding free-word only.)

## Prompt

> Goal (human decision, Approach 1): make `spec` the ONE vocabulary — sweep the artifact WORD `spec`→`spec` (keep-case) and `work/specs/`→`work/specs/` across ALL trees where it is the concept (incl. terminal `work/` history and ADRs — spec and spec name the same thing, so normalizing history is honest), and EXTEND the leak scan to gate it. Read the parent spec + the option-A observation notes + `TASKING-PROTOCOL.md` §3a. This is a WORD/PROSE cutover, distinct from the migration command's STRUCTURAL data conversion (already done).
>
> THE CRUX is the PRESERVE list — do NOT rewrite: (1) any `spec` inside a hyphenated SLUG / filename / code-fence path / frontmatter `slug:`/`spec:`/`blockedBy:`/`covers:` value (they are file identities + cross-refs + proper nouns; `spec-to-spec` is the command's own name); (2) the live published CODE back-compat aliases (`parseFrontmatter` `key === 'spec'` dual read; `do prd:`/`advance prd:` verb acceptance; the `case 'spec'` consumers that stayed for them); (3) camelCase historical API names in `tasks/done/` bodies (`renderPrdBody`, `prdTitle` — the point-in-time record); (4) English `debrief`/`briefly`/`briefing`; (5) `.git`/`node_modules`/lockfiles/compiled `.github/workflows`. When in doubt whether a `spec` is the WORD or an IDENTITY, LEAVE it and let the extended scan's allow-list decide — over-rewriting a slug breaks a file reference; under-rewriting a prose word is caught by the scan.
>
> Also fix the ONE real code leak: `tasking.ts` `buildTaskingSpec`'s `work/specs/ready|tasked/` prompt-string literals → `work/specs/…` (prefer `workFolderRel('specs-ready'/'specs-tasked')`), sweep its JSDoc, and re-point `tasking-protocol-doc.test.ts`'s builder-body assertions.
>
> Done means: every artifact-word `spec` reads `spec` (slugs/aliases/English preserved), `buildTaskingSpec` points at `work/specs/`, an extended WORD-scoped leak scan gates the trees with a concrete allow-list, full gate green, a changeset added. FIRST check drift: confirm the protocol-contract + frontmatter-field cutover already landed (source docs already say spec); grep the artifact word to size the sweep and to build the concrete slug-preserve allow-list from the actual `spec`-containing slug tokens present.
