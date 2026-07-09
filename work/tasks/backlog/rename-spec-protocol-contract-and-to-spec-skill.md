---
title: prd→spec batch 5 — protocol contract source + to-prd→to-spec skill (source of truth)
slug: rename-spec-protocol-contract-and-to-spec-skill
prd: prd-to-spec-vocabulary-cutover-and-migration-command
blockedBy: [rename-spec-remaining-src-modules-a, rename-spec-remaining-src-modules-b, rename-spec-remaining-src-modules-c]
covers: [1, 2]
---

## What to build

Rewrite the CONTRACT source of truth and the producer skill to `spec` — this is the "make dorfl SPEAK spec" contract layer that the migration command's setup-re-sync step later propagates to downstream repos.

- `skills/setup/protocol/*`: keep-case rename `prd → spec` across `WORK-CONTRACT.md`, `TASKING-PROTOCOL.md`, `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `CLAIM-PROTOCOL.md`, `ADR-FORMAT.md`, and `git mv prd-template.md → spec-template.md`. Update the vendored-doc SET list (`vendor-protocol.mjs`) and the doc-consistency tests if a `prd`-named doc is referenced.
- `skills/to-prd → skills/to-spec`: in-repo `git mv`, update the skill's frontmatter `name:`/`description:` and body, and every reference to `to-prd` across `skills/`, `docs/`, `CONTEXT.md`, `AGENTS.md` (the symlink `~/.agents/skills/to-prd` is a user-machine concern noted for the maintainer, not changed by the build).
- MIRROR: do NOT hand-mirror `work/protocol/*` here — decision B says the migration command's setup-re-sync writes the mirror. BUT the doc-consistency test asserts source == mirror == vendored byte-identical; reconcile this in-task. Options (pick and record): (a) update source + let this task ALSO re-run the vendor + mirror sync so the test passes now (simplest, keeps green), or (b) if the test is meant to be satisfied only after the command runs, adjust the test's expectation in this task. Prefer (a) — keep the existing invariant green; the command re-running the same sync downstream is idempotent.
- `prd-template.md → spec-template.md` and its reference in `to-spec`/`to-task` skills + the template-consistency test.

## Acceptance criteria

- [ ] `skills/setup/protocol/*` rewritten to `spec` (keep-case); `prd-template.md → spec-template.md`; `to-prd → to-spec` skill `git mv`'d + updated + all references.
- [ ] The vendored SET + source + `work/protocol/` mirror are byte-identical (via re-running the vendor/sync in this task — option (a)); `VERSION` bumped.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green (incl. the tasking-protocol-doc / template-consistency tests).
- [ ] The `to-prd → to-spec` rename note flags the user-machine symlink (`~/.agents/skills/*`) as a manual follow-up (not a build change).

## Blocked by

- rename-spec-remaining-src-modules (the code that resolves/vendors protocol docs and references skills is already `spec`, so doc renames don't break resolvers).

## Prompt

> Goal: rewrite the CONTRACT source of truth (`skills/setup/protocol/*`, `prd-template.md → spec-template.md`) and rename the producer skill `skills/to-prd → skills/to-spec` to `spec`, keeping the source/mirror/vendored byte-identical invariant green (re-run the vendor+sync in-task, decision B is satisfied because that sync is idempotent). Migrate-batch 5 of the parent spec `prd-to-spec-vocabulary-cutover-and-migration-command` (read it + `TASKING-PROTOCOL.md` §3a). This is the contract layer the migration command's setup-re-sync later propagates downstream.
>
> Domain vocabulary: `skills/setup/protocol/*` is the SOURCE OF TRUTH the `setup` skill copies into every repo's `work/protocol/`; the doc-consistency tests assert source == `work/protocol/` mirror == `dist/protocol/` vendored, byte-identical. `AGENTS.md` in this repo requires editing the SOURCE and mirroring; the vendor step (`pnpm build`) regenerates `dist/`.
>
> Where to look: `skills/setup/protocol/*`, `prd-template.md`, `skills/to-prd/`, `vendor-protocol.mjs`, the `*-doc.test.ts` consistency tests, and every `to-prd`/`prd-template` reference in `skills/`+`docs/`+`CONTEXT.md`+`AGENTS.md`. `git mv` the renamed files so history follows.
>
> Done means: contract + skill say `spec`, all three doc copies byte-identical, VERSION bumped, full gate green, and the user-machine symlink flagged as a manual follow-up.
>
> FIRST check drift: confirm batch 4 landed (code resolvers already `spec`); confirm the protocol docs still say `prd`.
