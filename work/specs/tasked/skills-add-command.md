---
title: 'A `dorfl skills add` command that installs the dorfl skills into any agent harness'
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

> Tasked 2026-07-13 — implementation/testing detail moved into `work/tasks/` (`skills-add-vendor-incur-agents-map`, `skills-add-cli-command`); the durable rationale (vendor-not-depend, licensing, packaging precedent) lives in ADR `docs/adr/skill-install-vendors-incur-agents-map.md`. This spec has settled to its durable framing below.

## Out of Scope

- Adopting incur as dorfl's CLI framework (parked; would be its own ADR).
- Depending on incur as an npm package (rejected in the ADR).
- Setting dorfl's own project license (a separate pre-existing gap flagged in the ADR — do it independently).
- The website getting-started rewrite that will POINT at this command — that is the sibling spec `website-getting-started-skill-first`, which depends on this command existing.
