---
title: Vendor incur's harness map + package the skills, exposing an installSkills engine
slug: skills-add-vendor-incur-agents-map
spec: skills-add-command
blockedBy: []
covers: [2, 3, 4, 6, 7]
---

## What to build

The foundation for `dorfl skills add`: make the dorfl skills installable into any agent harness, WITHOUT yet wiring the CLI command (that is the sibling task `skills-add-cli-command`). Three parts, delivered as one vertical path (vendored map → build-time packaging → a resolver + install engine → tests):

1. **Vendor incur's harness-destination map.** Copy incur's `src/internal/agents.ts` (MIT) into this package as a clearly-labelled vendored file (e.g. under a `vendor/incur/` directory in the package source), kept byte-close to upstream, with incur's `LICENSE` file dropped beside it and its MIT copyright/permission header preserved. Only Node built-ins are imported, so it compiles as-is. This file provides the `Agent` map (~22 harnesses: the universal `.agents/skills` set plus per-harness symlink targets like Claude Code, Windsurf, Codex, Cursor, Gemini, Copilot), `detect()`, and an `install(sourceDir, options)` that copies each skill dir into the canonical `~/.agents/skills/` and symlinks non-universal harnesses.

2. **Package the skills into the published CLI.** The `skills/` directory lives at the MONOREPO ROOT, outside `packages/dorfl/`, and a published npm package cannot reference files outside itself. Follow the EXACT precedent of `vendor-protocol.mjs`: add a build step (part of `pnpm build`, alongside the existing `vendor-protocol.mjs`) that copies the root `skills/*` (each `<name>/SKILL.md` plus any assets) into `dist/skills/<name>/`. The build is `tsc && node scripts/vendor-protocol.mjs`; extend it (either append a second script invocation or a sibling `vendor-skills.mjs`) so `dist/skills/` is populated on every build.

3. **Expose a resolver + install engine.** Add a small module that resolves the packaged skills SOURCE directory the same way `resolveProtocolDoc` resolves protocol docs: prefer `dist/skills/` (the vendored, published-CLI copy), then fall back to the dev-only monorepo-root `skills/` walk. Export an `installSkills(...)`-style function that resolves that source dir and drives the vendored `install()` (global-by-default; project-local option), returning the installed canonical paths + per-harness results for the caller to report.

## Acceptance criteria

- [ ] incur's `agents.ts` is vendored under a clearly-labelled path with its MIT `LICENSE` beside it and its copyright/permission header intact; the vendored file is not rewritten (wrapper code lives outside it).
- [ ] `pnpm build` populates `dist/skills/<name>/SKILL.md` (+ assets) for every dir under the repo-root `skills/`, via a build step mirroring `vendor-protocol.mjs`.
- [ ] A resolver returns the packaged-skills source dir, preferring `dist/skills/` and falling back to the dev monorepo-root `skills/` walk (mirroring `resolveProtocolDoc`'s candidate order).
- [ ] An exported `installSkills` engine resolves the source and drives the vendored `install()`, supporting global (default) and project-local placement, and returns the installed canonical paths + per-harness install details.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style: throwaway dirs, override home/cwd): a temp source dir with fake skill folders installs into a temp canonical dir; non-universal harnesses get symlinks; idempotent re-run; stale-skill cleanup; project-local vs global placement; the resolver prefers `dist/skills/` when present and falls back otherwise.
- [ ] **Shared-write isolation (WORK-CONTRACT.md):** because the vendored `install()` writes to real home/config harness dirs, every test MUST point home/cwd at a temp/scratch dir via the vendored file's `global`/`cwd` options (or an env/config override) AND assert the real `~/.agents/skills/` and real harness dirs are UNTOUCHED after the run. A test that writes to the real home is a defect.
- [ ] The acceptance gate stays green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — can start immediately.

## Prompt

> Build the vendored skill-install foundation for a forthcoming `dorfl skills add` command. Do NOT wire the CLI command itself (that is the sibling task `skills-add-cli-command`); this task delivers the vendored harness map, the build-time packaging of the skills, and an `installSkills` engine + resolver, all tested.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): confirm `skills/` still lives at the monorepo ROOT (not inside `packages/dorfl/`), that `packages/dorfl` builds via `tsc && node scripts/vendor-protocol.mjs`, and that `resolveProtocolDoc` (in the prompt module) still resolves docs by the candidate order `<cwd>/work/protocol/` → `dist/protocol/` → dev monorepo-root `skills/setup/protocol/` walk. If any of these has moved, route to needs-attention rather than building on the stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Domain: this is dorfl (a TS/Node pnpm monorepo, `type: module`, NodeNext, tsc, commander, vitest, prettier with tabs+single-quotes). The dorfl SKILLS are the operator's toolbox (`from-idea`, `setup`, and the rest under the repo-root `skills/`). This command installs them into the OPERATOR's own agent harness dirs — it does NOT propagate skills into any target repo's `work/` tree, so it does not conflict with the "skills don't travel" invariant (ADR `methodology-and-skills` §6: only `work/protocol/` docs propagate).
>
> Decision constraints: follow ADR `docs/adr/skill-install-vendors-incur-agents-map.md` — VENDOR incur's MIT `src/internal/agents.ts` (fetch it from the upstream incur repo), do NOT add incur as an npm dependency, do NOT adopt it as a CLI framework, do NOT hand-roll the harness map. Keep the vendored file byte-close to upstream so future incur updates are a mechanical re-copy.
>
> Where to look (by concept, not brittle paths): the `vendor-protocol.mjs` build script and the `resolveProtocolDoc` resolver are the two precedents to mirror exactly — the first for "copy repo-root files into `dist/` because a published package can't reference outside itself", the second for the prefer-`dist/`-then-dev-walk resolution order. Package the skills the same way the protocol docs are packaged.
>
> Seams to test at: the `installSkills` engine and the resolver (unit-level, with home/cwd overridden to temp dirs). Trust the vendored `install()`'s internal behaviour (it is upstream-tested) but assert dorfl's wrapper: source-dir resolution, option threading (global/local), and the returned paths/report. Done = the engine + resolver exist and are exercised by isolated tests, `dist/skills/` is populated on build, and the gate is green.
>
> RECORD non-obvious in-scope decisions durably and linked from the done record (e.g. whether you appended to `vendor-protocol.mjs` or added a sibling `vendor-skills.mjs`; exact vendored-file location; the resolver's module home). If a choice meets the ADR bar (hard to reverse + surprising + a real trade-off), write it as an ADR in `docs/adr/`; otherwise a module JSDoc / a `## Decisions` block in the done record suffices. An un-recorded in-scope decision is a review finding.

---

### Claiming this task

```sh
dorfl claim skills-add-vendor-incur-agents-map --arbiter <remote>
git fetch <remote> && git switch -c work/skills-add-vendor-incur-agents-map <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/skills-add-vendor-incur-agents-map.md work/tasks/done/skills-add-vendor-incur-agents-map.md
```
