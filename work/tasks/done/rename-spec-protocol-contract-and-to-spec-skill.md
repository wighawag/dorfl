---
title: prd→spec batch 5 — protocol contract source + to-prd→to-spec skill (source of truth)
slug: rename-spec-protocol-contract-and-to-spec-skill
spec: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-remaining-src-modules-a, rename-spec-remaining-src-modules-b, rename-spec-remaining-src-modules-c]
covers: [1, 2]
---

## What to build

Rewrite the CONTRACT source of truth and the producer skill to `spec` — this is the "make dorfl SPEAK spec" contract layer that the migration command's setup-re-sync step later propagates to downstream repos.

### Vocabulary boundary (option A — READ THIS FIRST; it is the crux)

This is a PARTIAL migrate-step, NOT a clean-break rename. The word `prd` appears in the protocol docs in THREE distinct roles; you rename ONLY role 1. Roles 2 and 3 carry the deliberate `prd` ALIAS that the CONTRACT task (`contract-spec-hard-cutover-rejection-and-leak-scan`, the next batch) removes — touching them here would (a) break the still-`prd` alias other layers depend on, and (b) break the doc-consistency tests, which PIN several `prd`/`prds` strings that MUST survive.

1. **The artifact WORD `prd` / `PRD` / `Prd`** — meaning "the parent-spec document" (e.g. "a PRD that has drifted", "move the prd to `tasked/`", "the prd lifecycle", "between prd and buildable task", "the tasker's input is a single prd"). **RENAME this, keep-case → `spec` / `SPEC` / `Spec`.** This is the whole job.
2. **The `prd:` frontmatter FIELD** and its mentions (`prd: historical-store`, `prd: example-prd`, "the task's `prd:` field", "the required `prd` field", "a task with no `prd:`", "`prd:<slug>` tasks", `covers` "within `prd:`"). **DO NOT rename — leave `prd`.** `tasking-protocol-doc.test.ts` asserts `expect(doc).toMatch(/\bprd\b/)` twice AND parses a canonical `prd: example-prd` fixture with `expect(fm.prd).toBe('example-prd')`; the frontmatter field is only renamed by the contract task.
3. **The `work/specs/...` FOLDER paths and the `do prd:<slug>` / `advance prd:<slug>` VERB forms** (`work/specs/ready/`, `work/specs/tasked/`, `work/specs/proposed/`, `work/specs/dropped/`, `specs/` in the layout tree, `refs/dorfl/lock/prd-<slug>`, `do prd:<slug> --propose`, `taskedAfter (cross-prd order)`). **DO NOT rename — leave `prds`/`prd`.** The folder is a SEPARATE concern (the on-disk folder is already `work/specs/` in THIS repo but the docs/prompt literals stay `work/specs/` until the migration command + a later folder pass); the `prd:` verb is an alias the contract task removes. `tasking-protocol-doc.test.ts` asserts the runtime tasking prompt still emits `/work\/prds\/ready\//` and `/work\/prds\/tasked\//`.

Rule of thumb: if the token is followed by `:` (field), or is part of a `work/specs/...` path, or is `do prd:` / `advance prd:` / `prd-<slug>` lock ref, LEAVE IT. Otherwise it is the artifact word → `spec`. The `to-prd` skill name and `prd-template.md` filename are NEITHER a field nor a folder path — they ARE renamed (`to-spec`, `spec-template.md`), see below.

HARD SCOPE-OUTS (do NOT edit):
- `packages/dorfl/src/tasking.ts` and its `work/specs/...` prompt literals — a separate folder concern; the doc-consistency test reads `tasking.ts` for the `work/specs/` builderBody assertions, so leaving it untouched keeps them green.
- `to-prd` / `prd-template` references living in `work/notes/*`, `work/specs/*`, `work/tasks/done/*` — historical provenance/data; the migration command (task 6) rewrites `work/` data, not this task.

- `skills/setup/protocol/*`: keep-case rename the ARTIFACT WORD (role 1 above) `prd → spec` across `WORK-CONTRACT.md`, `TASKING-PROTOCOL.md`, `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`, and `git mv prd-template.md → spec-template.md`. LEAVE the `prd:` field mentions (role 2) and `work/specs/` folder + `do prd:` verb forms (role 3). `vendor-protocol.mjs`'s SET is `CLAIM/REVIEW/SURFACE/TASKING` (no `prd`-named doc), so it needs no edit; update a doc-consistency test ONLY if the ARTIFACT-word rename forces a still-`prd`-artifact-word assertion to change (it should not touch the role-2/role-3 pinned strings).
- `skills/to-prd → skills/to-spec`: in-repo `git mv`, update the skill's frontmatter `name:`/`description:` and body, and every reference to `to-prd` across `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md` (the symlink `~/.agents/skills/to-prd` is a user-machine concern noted for the maintainer, not changed by the build).
- MIRROR: do NOT hand-mirror `work/protocol/*` here — decision B says the migration command's setup-re-sync writes the mirror. BUT the doc-consistency test asserts source == mirror == vendored byte-identical; reconcile this in-task. Options (pick and record): (a) update source + let this task ALSO re-run the vendor + mirror sync so the test passes now (simplest, keeps green), or (b) if the test is meant to be satisfied only after the command runs, adjust the test's expectation in this task. Prefer (a) — keep the existing invariant green; the command re-running the same sync downstream is idempotent.
- `prd-template.md → spec-template.md` and its reference in `to-spec`/`to-task` skills + the template-consistency test.

## Acceptance criteria

- [ ] `skills/setup/protocol/*`: the ARTIFACT WORD `prd`/`PRD`/`Prd` (role 1) rewritten keep-case to `spec`/`SPEC`/`Spec`; the `prd:` FIELD mentions (role 2) and the `work/specs/` FOLDER + `do prd:`/`advance prd:` VERB forms (role 3) LEFT as `prd`/`prds`.
- [ ] `prd-template.md → spec-template.md` (`git mv`); `to-prd → to-spec` skill `git mv`'d + frontmatter/body updated + references updated in `skills/`/`docs/`/`CONTEXT.md`/`AGENTS.md` ONLY (NOT `work/notes|specs|tasks/done`).
- [ ] `packages/dorfl/src/tasking.ts` UNTOUCHED (the `work/specs/` prompt-literal concern is out of scope); the `tasking-protocol-doc.test.ts` role-2 (`toMatch(/\bprd\b/)`, `prd: example-prd`) and role-3 (`work/specs/ready|tasked`) assertions still pass unchanged.
- [ ] Source == `work/protocol/` mirror == `dist/protocol/` vendored, byte-identical (re-run the vendor/sync in-task — option (a)); `work/protocol/VERSION` bumped past `2026-06-23` (the doc test asserts `> 2026-06-23`).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (incl. the tasking-protocol-doc / template-consistency tests).
- [ ] The `to-prd → to-spec` rename note flags the user-machine symlink (`~/.agents/skills/*`) as a manual follow-up (not a build change).
- [ ] Record the option-A vocabulary-boundary decision (which `prd` survived and why) in a `work/notes/observations/` note for the contract task's leak-scan to expect.

## Blocked by

- rename-spec-remaining-src-modules (the code that resolves/vendors protocol docs and references skills is already `spec`, so doc renames don't break resolvers).

## Prompt

> Goal: rewrite the CONTRACT source of truth (`skills/setup/protocol/*`, `prd-template.md → spec-template.md`) and rename the producer skill `skills/to-prd → skills/to-spec` to `spec`, keeping the source/mirror/vendored byte-identical invariant green (re-run the vendor+sync in-task, decision B is satisfied because that sync is idempotent). Migrate-batch 5 of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a). This is the contract layer the migration command's setup-re-sync later propagates downstream.
>
> CRITICAL — read the "Vocabulary boundary (option A)" section in the task body BEFORE editing. This is a PARTIAL rename: rename ONLY the artifact WORD `prd`/`PRD`/`Prd` → `spec`/`SPEC`/`Spec` (keep-case). LEAVE every `prd:` FRONTMATTER-FIELD mention, every `work/specs/...` FOLDER path, and every `do prd:`/`advance prd:` VERB form (and `prd-<slug>` lock ref, `taskedAfter (cross-prd order)`) as `prd`/`prds` — those are the alias the NEXT (contract) batch removes, and the doc-consistency tests PIN them (`toMatch(/\bprd\b/)`, `prd: example-prd`, `work/specs/ready|tasked`). Do NOT touch `packages/dorfl/src/tasking.ts` (its `work/specs/` prompt literals are a separate concern the doc test reads) or any `to-prd`/`prd-template` reference in `work/notes|specs|tasks/done`. Over-renaming BREAKS the build/tests; under-renaming is caught later by the contract task's leak scan — so when in doubt on a token, LEAVE it and note it.
>
> Domain vocabulary: `skills/setup/protocol/*` is the SOURCE OF TRUTH the `setup` skill copies into every repo's `work/protocol/`; the doc-consistency tests assert source == `work/protocol/` mirror == `dist/protocol/` vendored, byte-identical. `AGENTS.md` in this repo requires editing the SOURCE and mirroring; the vendor step (`pnpm build`) regenerates `dist/`.
>
> Where to look: `skills/setup/protocol/*`, `prd-template.md`, `skills/to-prd/`, `vendor-protocol.mjs`, the `*-doc.test.ts` consistency tests, and every `to-prd`/`prd-template` reference in `skills/`+`docs/`+`CONTEXT.md`+`AGENTS.md`. `git mv` the renamed files so history follows.
>
> Done means: contract + skill say `spec`, all three doc copies byte-identical, VERSION bumped, full gate green, and the user-machine symlink flagged as a manual follow-up.
>
> FIRST check drift: confirm batch 4 landed (code resolvers already `spec`); confirm the protocol docs still say `prd`.
