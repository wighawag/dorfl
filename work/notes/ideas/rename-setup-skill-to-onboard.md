---
title: 'Rename the `setup` skill to `onboard` (or `adopt`) so it reads as "put a repo on the contract", not "the universal step 1"'
slug: rename-setup-skill-to-onboard
type: idea
status: incubating
relatesTo: [from-idea-on-ramp, work-router-skill]
---

# Rename `setup` → `onboard` / `adopt`

## The idea

`setup` describes itself as "Onboard a repo onto the file-based `work/` contract." The verb `setup` is generic and, as step 1 of the main flow in `work/SKILL.md`, reads as the universal "always start here" entrance — which makes the new `from-idea` on-ramp look redundant ("don't I always run setup first?"). Renaming the skill to **`onboard`** (preferred) or **`adopt`** would make its meaning self-evident: it ADOPTS a repo onto the contract, and `from-idea` is the idea-front-door that runs onboard FOR you. `onboard` reads better than `adopt` here ("onboard a repo" is concrete; "adopt what?" is vaguer), and the skill's own first line already uses "onboard."

This is a NAMING/clarity change only — the behaviour (one skill, two phases, auto-detected depth) is unchanged.

## Why this is NOT a quick edit — the blast radius (the reason it is an idea, not a one-liner)

The string `skills/setup/` and the skill name `setup` are **load-bearing as a PATH**, not just a label. A rename is a cross-cutting protocol/code refactor, not a doc tweak. It must touch ALL of:

- **The folder rename itself:** `skills/setup/` → `skills/onboard/`, including the protocol source-of-truth subtree `skills/setup/protocol/` → `skills/onboard/protocol/`.
- **Build / runtime path resolution (the breakage risk):**
  - `packages/dorfl/src/vendor-protocol.mjs` — vendors the protocol docs FROM `skills/setup/protocol/` into the package; the build step that copies them as part of `pnpm build`.
  - `resolveClaimProtocolPath` / `resolveProtocolDoc` and any monorepo-relative walks that reference `skills/setup/protocol/...` (see `work/tasks/done/claim-protocol-path-target-repo-and-vendored.md`).
  - `package.json` `files` manifest and any path that ships the vendored protocol copy.
  - The doc-consistency test(s) that assert the vendored set matches the source.
- **The project's own AGENTS.md rule:** it names `skills/setup/protocol/` as the SOURCE OF TRUTH for protocol docs and requires the `work/protocol/` mirror to stay byte-identical. The rename must preserve that rule's wording AND the mirror (`diff -r skills/onboard/protocol work/protocol` clean).
- **Sibling skills that name it in prose:** `from-idea/SKILL.md`, `work/SKILL.md` (the router main-flow step 1 AND the "what this repo deliberately does NOT have" mapping `setup-matt-pocock-skills → setup`), `to-brief`, `to-task`, `drive-tasks`, `orchestrate`, the `CONTEXT.md` template's "Skills this repo uses" list.
- **A large body of `work/` items** referencing `skills/setup/` (briefs, tasks in backlog/done, observations, questions, the skill-eval-engine brief which is keyed on `skills/setup/`). Most are historical prose (done/ tasks, observations) and arguably should be left as-is (they describe the past, and notes/observations are append-only) — DECIDE per-bucket which references to rewrite (live: from-idea, work, CONTEXT template, build code, AGENTS.md) vs leave (historical done/ tasks, observations).

## Open questions for whoever tasks this

- **Keep an alias / back-compat?** Is there any external consumer that references the `setup` skill name or the `skills/setup/` path? (The CLAIM-PROTOCOL vendoring is internal; likely no external skill-name consumers, but confirm.)
- **`onboard` vs `adopt`** — pick one. (Leaning `onboard`.)
- **The Matt-Pocock lineage mapping** `setup-matt-pocock-skills → setup` in `work/SKILL.md`: does it become `→ onboard`? (Yes, but it is a deliberate vocabulary anchor — note the lineage so the rename does not erase the provenance.)
- **Scope of `work/` prose rewrite:** rewrite only LIVE references (skills, build code, AGENTS.md, CONTEXT template) and leave historical `tasks/done/` + `notes/observations/` mentions untouched (they are records of the past), OR a full sweep? Recommend live-only.

## Interim mitigation (already shipped, so this is not urgent)

The routing confusion was addressed cheaply WITHOUT the rename: `work/SKILL.md`'s main-flow step 1 now reads "`setup` (onboard / adopt the contract)" and states the `from-idea`-vs-`setup` boundary explicitly (the idea is the discriminator, not emptiness). So this rename is now a clarity/aesthetics improvement, not a fix for a live confusion — task it only if the cleaner vocabulary is judged worth the cross-cutting churn.
