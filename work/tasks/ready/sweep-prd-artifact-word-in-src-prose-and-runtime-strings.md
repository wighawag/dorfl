---
title: Sweep the `prd` artifact word + `work/prds/` in packages/dorfl/src PROSE + runtime/prompt STRINGS (the last non-identifier residual), extend the leak scan to gate src
slug: sweep-prd-artifact-word-in-src-prose-and-runtime-strings
spec: prd-to-spec-vocabulary-cutover-and-migration-command
covers: []
---

## What to build

The final residual of the `prd → spec` word cutover: `packages/dorfl/src` still carries the artifact word `PRD`/`prd` + `work/prds/` folder paths in ~37 files, in TWO kinds of position the existing scans do NOT gate:

1. **Doc-comment / JSDoc PROSE** (~85 standalone `PRD` + `work/prds/` in comments) — the source-part identifier scan (`prd-to-spec-leak-scan.test.ts`) deliberately EXEMPTS prose, and the WORD scan (`prd-word-cutover-leak-scan.test.ts`) only covers `work/`/docs/skills/CONTEXT, NOT `src`. So these silently survived.
2. **LIVE runtime + agent-prompt STRINGS pointing at a nonexistent folder** (the load-bearing ones, same class as the just-fixed `buildTaskingSpec`):
   - `cli.ts:3571` `promote` `--help` + `:3599` runtime message name `work/prds/proposed/`→`work/prds/ready/` (a folder that no longer exists in a migrated repo; user-facing).
   - `intake.ts:2388` agent-prompt: "writes the prd file (`work/prds/ready/<slug>.md`)".
   - `review-gate.ts:270`, `tasker-review-loop.ts:626` agent-prompt strings telling the agent to read `work/prds/ready/<slug>.md`.
   These point agents/users at `work/prds/…` paths that migrated to `work/specs/…`.

Sweep the artifact WORD `prd`/`PRD`/`Prd`→`spec`/`SPEC`/`Spec` (keep-case) and `work/prds/`→`work/specs/` (+ `prds/<lifecycle>`, `prd -> prd-tasked` shorthand → `specs/ready -> specs/tasked`) across `packages/dorfl/src/*.ts` PROSE (comments/JSDoc) AND user-facing/agent-prompt STRINGS. Prefer `workFolderRel('specs-*')` for any path a string BUILDS (so it can't re-drift), plain text for pure prose.

## PRESERVE (do NOT rewrite — same rules as the word-cutover task)

- **Live CODE back-compat aliases:** the `prd:` frontmatter KEY (`parseFrontmatter`), the `do prd:`/`advance prd:` VERB dispatch + its `--help` grammar that ADVERTISES the `prd:` alias (e.g. `do prd:<slug>` shown as an accepted form), `PRD_PREFIX`, `namespace === 'prd'`/`case 'prd'`/`explicit: 'prd'` consumers, `prd:<slug>` CLI-arg examples in help that document the still-accepted alias. The VERB alias is published back-compat; its help text may KEEP one `prd:` example as "(legacy alias)" but the surrounding prose flips to spec.
- **camelCase / PascalCase identifiers** that legitimately carry prd (none should remain post-cutover, but e.g. a `renderPrdBody` mention in a comment describing history) — leave the symbol name; flip free-word prose around it.
- **Slug identities / provenance** in comments (`prd `land-time-reverify…``, `runner-in-ci` prd refs to `work/prds/tasked/runner-in-ci.md` — wait: that PATH is stale (→ `work/specs/tasked/`), but the SLUG `runner-in-ci` stays; only the folder path flips). A `prd `<slug>`` doc-comment attribution: flip the word `prd`→`spec`, keep the slug.
- English (`debrief`/`briefly`), `.git`/`node_modules`/compiled workflows.

## Leak-scan extension

Extend the source-part scan (or the WORD scan) to ALSO gate `packages/dorfl/src` for a standalone artifact-word `PRD`/`Prd`/`prd` (in prose OR a whole-literal `work/prds/…` string) OUTSIDE the code-alias allow-list — so src prose can't re-drift. Keep the existing identifier-scan's exemption of the deliberate `prd:` field/verb aliases; the NEW assertion is specifically "no artifact-word `prd`/`PRD` prose + no `work/prds/` runtime string in src".

## Acceptance criteria

- [ ] No standalone artifact-word `PRD`/`Prd`/`prd` and no `work/prds/`/`prds/<lifecycle>` path remain in `packages/dorfl/src/*.ts` PROSE or runtime/prompt STRINGS, except the enumerated code-alias survivors.
- [ ] The 4 load-bearing runtime/prompt strings (`cli.ts` promote help+msg, `intake.ts`, `review-gate.ts`, `tasker-review-loop.ts`) point at `work/specs/…` (prefer `workFolderRel('specs-*')`); a fresh agent/user is never sent to a nonexistent `work/prds/` path.
- [ ] The live `prd:` field/verb CLI aliases + their documented `prd:` grammar UNTOUCHED (published back-compat); no code identifier renamed.
- [ ] The leak scan gates `src` artifact-word prose + `work/prds/` strings; FAILS on a re-introduced one; concrete alias allow-list.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green; a `dorfl` changeset added. (docs/ci template ↔ emitter inline-template word divergence the prior task noted is resolved.)

## Prompt

> Goal: finish the `prd → spec` WORD cutover in `packages/dorfl/src` — the last residual (see `work/notes/observations/advance-lifecycle-template-src-prose-still-says-prd-2026-07-10.md`). Sweep the artifact word `prd`/`PRD`→`spec`/`SPEC` + `work/prds/`→`work/specs/` in src COMMENT/JSDoc PROSE and in LIVE runtime + agent-prompt STRINGS (the load-bearing ones: `cli.ts` promote help/message, `intake.ts`, `review-gate.ts`, `tasker-review-loop.ts` — they currently point at a `work/prds/` folder that no longer exists in a migrated repo, exactly like the just-fixed `buildTaskingSpec`). Prefer `workFolderRel('specs-ready'/'specs-tasked'/'specs-proposed')` for any path a string BUILDS. Read the parent spec + the word-cutover task's PRESERVE rules.
>
> PRESERVE (do NOT touch): the live CODE back-compat aliases — `parseFrontmatter`'s `prd:` KEY read, the `do prd:`/`advance prd:` VERB dispatch + the `prd:<slug>` grammar its `--help` advertises as the accepted legacy alias, `PRD_PREFIX`, `namespace === 'prd'`/`case 'prd'` consumers; slug identities (flip the word `prd`→`spec` in a `prd `<slug>`` attribution but keep the slug); English. Over-touching the verb alias or a `prd:`-arg example breaks published back-compat; leave a single `prd:` "(legacy alias)" example if the help documents the accepted form.
>
> Extend the leak scan to gate `packages/dorfl/src` for artifact-word `PRD`/`prd` prose + `work/prds/` runtime strings (outside the alias allow-list), so it can't re-drift.
>
> Done means: src reads `spec` in prose + strings, no runtime/prompt string points at `work/prds/`, the code aliases are intact, the scan gates src, full gate green, a changeset added. FIRST check drift: grep `packages/dorfl/src` for `\bPRD\b` + `work/prds/` to size it and to separate load-bearing strings from pure comment prose.
