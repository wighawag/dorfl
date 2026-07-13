---
title: A `dorfl skills add` command that installs the dorfl skills into any agent harness
slug: skills-add-command
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The dorfl skills (`from-idea`, `setup`, and the rest of `skills/`) are the real front door to the whole system — adopting the `work/` contract is a SKILL, deliberately runner-agnostic, and needs no `dorfl` install (see `CONTEXT.md`'s "adopt = skill, execute = command" invariant). But there is no way for a newcomer to INSTALL those skills. The only install path today is the maintainer's own dogfooding setup, where `~/.agents/skills/*` are symlinks back into this repo's `skills/` folder. A newcomer has no dorfl checkout to symlink from, and even a clone would leave them hand-copying directories into a harness-specific skills dir they'd have to know the location of. So the getting-started story the website wants to tell ("start with the `from-idea` skill") has nothing to point at.

## Solution

A `dorfl skills add` command that copies the dorfl skills into whatever agent harness(es) the user runs, in ONE command. It reuses incur's harness-destination map (VENDORED, per ADR `skill-install-vendors-incur-agents-map`): incur's `src/internal/agents.ts` already encodes where ~22 harnesses read skills (the universal `.agents/skills` set plus per-harness symlink targets for Claude Code, Windsurf, Codex, Cursor, Gemini, Copilot, and the rest) and the copy/symlink/remove logic over them. dorfl vendors that one dependency-free file (MIT, kept under its notice) and wraps it with a thin native command that feeds it dorfl's `skills/` directory as the source.

The command COPIES skills into the canonical `~/.agents/skills/` (and symlinks the non-universal harnesses that need it), which is the correct model for a newcomer with no dorfl checkout — and is deliberately DISTINCT from the maintainer's own "symlink back into `skills/`" dogfooding setup, which stays untouched.

**This does NOT violate the "skills don't travel" invariant** (ADR `methodology-and-skills` §6: skills are the operator's toolbox, deliberately NOT copied into target repos — only `work/protocol/` docs propagate). `skills add` installs skills into the OPERATOR's own harness dirs (where the interactive agent driving the contract lives), not into any target repo's `work/` tree. Operator-tooling install and target-repo propagation are different axes; this command is squarely the former.

## User Stories

1. As a newcomer, I want to run one command and have the dorfl skills installed into my agent, so that I can immediately invoke `from-idea` / `setup` without knowing where my harness stores skills.
2. As a user of one of the ~22 supported harnesses (the same set incur covers), I want `skills add` to detect my installed harness(es) and place the skills where THAT harness reads them, so that it works whether I use Claude Code, Cursor, Codex, Gemini, Copilot, pi, etc.
3. As a user, I want `skills add` to be idempotent and re-runnable, so that re-running it picks up new/updated skills and cleans up ones that were removed, without duplicating or stranding stale copies.
4. As a user, I want to install skills GLOBALLY (into my home harness dirs) by default, or PROJECT-LOCALLY into the current repo, so that I can scope skills to one project when I want to.
5. As a user, I want the command to report exactly what it installed and where (canonical path + which harnesses got a symlink/copy), so that the effect is visible and auditable.
6. As the maintainer, I want the command to source skills from dorfl's own `skills/` folder (packaged with the CLI), so that `skills add` ships the CURRENT dorfl skills without a separate download step.
7. As a project reading the license carefully, I want the vendored incur file kept under its MIT notice with incur's LICENSE beside it, so that AGPL-consuming-MIT attribution is honoured (per the ADR).

### Autonomy notes (the two gate axes — set the frontmatter flags accordingly)

Straightforwardly agent-taskable: a bounded, well-understood command that vendors a known file and wraps it. No `humanOnly` (no product/security judgement beyond the already-decided ADR), no `needsAnswers` (the open questions below are refinements the tasker can resolve against the vendored file + existing command conventions, not blockers). Both flags omitted.

## Implementation Decisions

- **Vendor incur's `src/internal/agents.ts`** into dorfl (per ADR `skill-install-vendors-incur-agents-map`) as a clearly-labelled `vendor/incur/` copy under `packages/dorfl/src/`, kept byte-close to upstream with incur's MIT `LICENSE` beside it. Only wrapper code is written around it; the vendored file is not rewritten, so future incur harness-map updates are a mechanical re-copy.
- **Source of skills = dorfl's `skills/` directory, PACKAGED via the `vendor-protocol.mjs` precedent — NOT via `files`.** `skills/` lives at the MONOREPO ROOT, outside `packages/dorfl/`, and a published npm package cannot reference files outside itself (the exact constraint `vendor-protocol.mjs` already solves for the protocol docs, which live at the same root under `skills/setup/protocol/`). So `files: ["dist","src"]` cannot include `skills/`. Follow the established pattern: add a build step (part of `pnpm build`, like `vendor-protocol.mjs`) that copies the root `skills/*` into `dist/skills/`, and have `skills add` resolve its source from `dist/skills/` at runtime with a dev-only fallback to walking the repo-root `skills/` tree (mirroring how `resolveProtocolDoc` checks `dist/protocol/` then falls back to the dev `skills/` walk). This is what makes the skill files present after `npm i -g dorfl`.
- **New command surface: `dorfl skills add`** under a `skills` group, consistent with the existing command surface (`docs/adr/command-surface-and-journeys.md`) and its commander-based structure. Likely `--global` (default) / `--local`, and a report of installed paths. A `skills list` / `skills remove` may fall out of the vendored file's `list`/`remove` exports but are secondary — the tasker decides whether to expose them now or defer.
- **Coherence check (per `CONTEXT.md`):** the word "skills" and any new flags must not re-mean existing dorfl concepts; `skills add` is a new, orthogonal surface (it touches the OPERATOR's harness dirs, never a repo's `work/` tree).

## Testing Decisions

- Drive the vendored install against a TEMP source dir + TEMP target dirs (override home/cwd), asserting: canonical copy created, non-universal harness symlinks created, idempotent re-run, stale-skill cleanup, project-local vs global placement. Mirror dorfl's existing test style (throwaway dirs, no real home writes).
- Keep the vendored file's own behaviour trusted (it's upstream-tested); test dorfl's WRAPPER: correct source dir resolution from the packaged skills, correct option threading, correct report output.

## Out of Scope

- Adopting incur as dorfl's CLI framework (parked; would be its own ADR).
- Depending on incur as an npm package (rejected in the ADR).
- Setting dorfl's own project license (a separate pre-existing gap flagged in the ADR — do it independently).
- The website getting-started rewrite that will POINT at this command — that is the sibling spec `website-getting-started-skill-first`, which depends on this command existing.

## Further Notes

Open refinements for the tasker (not blockers): whether to ship `skills list`/`skills remove` in the first cut or defer; exact flag names; whether project-local install writes into `.agents/skills` or the harness-specific project dirs the vendored map already knows. All resolvable against the vendored `agents.ts` and existing dorfl command conventions.
