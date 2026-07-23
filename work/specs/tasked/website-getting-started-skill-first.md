---
title: 'Website getting-started rewritten skill-first (adopt-skill → work/ contract → CLI + CI/intake)'
slug: website-getting-started-skill-first
taskedAfter: [skills-add-command]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The Dorfl landing site (`website/src/routes/+page.svelte`) sells dorfl purely as the RUNNER: discover / schedule / claim / run, `npm install -g dorfl`, `dorfl remote add`, `dorfl do`. It never mentions skills at all. That is dishonest getting-started copy, because the real front door for a newcomer is a SKILL, not the CLI: `from-idea` (from scratch) and `setup` (adopt the contract on an existing repo). Both are explicitly runner-agnostic and require no `dorfl` install — the site's own repo states "adopt = skill, execute = command" as an invariant (`CONTEXT.md`). So the site skips layer one (adopt) and leads with layer two (execute), which is exactly backwards for someone getting started.

## Solution

Rewrite the getting-started / install section to present dorfl as THREE layers, in this order, so the reader starts where they actually should:

1. **Adopt (a skill).** The front door. Install the dorfl skills (`dorfl skills add`, from the sibling spec) and point your agent at `from-idea` (from scratch) or `setup` (existing repo). Runner-agnostic; no `dorfl` runtime needed to adopt the contract.
2. **The `work/` contract + protocol side-car.** What adoption gives you: the `work/` tree, the vendored `work/protocol/` docs, the `dorfl.json` gate — the durable, file-based substrate the CLI later consumes.
3. **Execute (the CLI) + CI capabilities.** `dorfl do` / `run`, and the CI capabilities including the UNIQUE ones like `intake` (the issue → spec/task front door). This is today's whole site, repositioned as the last of three.

The current "npm install -g dorfl / remote add / do" panel is NOT deleted — it is demoted to layer three, with a new skill-install panel promoted to the top. The hero/brand can stay; only the "Get started" flow is re-ordered and expanded.

## User Stories

1. As a newcomer landing on the site, I want the first getting-started step to be "install the skills and invoke `from-idea` / `setup`", so that I start at the real front door instead of installing a CLI I don't yet need.
2. As someone with an existing repo, I want the site to show `setup` as the adopt-an-existing-project path, so that I see dorfl works on my current code, not just greenfield.
3. As someone starting from scratch, I want the site to show `from-idea` as the from-zero path, so that I understand the idea-to-spec on-ramp.
4. As a reader, I want the site to then explain what adoption GIVES me (the `work/` contract + the `work/protocol/` side-car docs + `dorfl.json`), so that the substrate the CLI consumes is legible before the CLI is introduced.
5. As a reader ready to automate, I want the CLI + CI section (including the distinctive `intake` capability) presented as the execute layer AFTER adoption, so that the two-layer "adopt then execute" model is clear.
6. As a reader, I want the skill-install step to point at a REAL command (`dorfl skills add`), so that the getting-started copy is actionable, not aspirational.
7. As a maintainer, I want the copy to stay faithful to the repo's own framing (`CONTEXT.md`, `work/protocol/WORK-CONTRACT.md`), so that the site does not drift from the product.

> Tasked 2026-07-13 — implementation/testing detail moved into `work/tasks/` (`website-getting-started-three-layer`, a single content task — one page, so no vertical split). No ADR: a copy rewrite carries no durable decision. This spec has settled to its durable framing below.

## Out of Scope

- Building the `dorfl skills add` command itself (sibling spec `skills-add-command`; this spec only POINTS at it).
- Restyling / rebranding the site, new pages, or docs beyond the getting-started flow.
- The incur-vendoring decision (ADR `skill-install-vendors-incur-agents-map`).

## Further Notes

The `taskedAfter: [skills-add-command]` gate is about NAMING: the layer-one copy references `dorfl skills add`, so that command's spec had to be tasked (the command nameable) before this was tasked. It does NOT require the command to be BUILT first — the page copy can land ahead of the implementation (the emitted task is unblocked), though shipping the built command around the same time keeps the copy honest.
