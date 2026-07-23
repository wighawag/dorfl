---
title: 'Skill install vendors incur''s harness-destination map (MIT), not the framework'
slug: skill-install-vendors-incur-agents-map
type: adr
created: 2026-07-13
---

# ADR: a `dorfl skills add` vendors incur's `internal/agents.ts` (MIT) rather than depending on incur or hand-rolling the harness map

A newcomer needs a one-command way to install the dorfl skills (`from-idea`, `setup`, and the rest of `skills/`) into whatever agent harness they use, because the skills are the real front door (adopt-the-contract is a SKILL, not the CLI) yet today the only install path is the maintainer's own `~/.agents/skills/*` symlinks back into this repo's `skills/` (see `CONTEXT.md`), which a newcomer with no dorfl checkout cannot reproduce. wevm's [incur](https://github.com/wevm/incur) already solves the hard, drift-prone part: `src/internal/agents.ts` encodes where ~22 agent harnesses read skills (the universal `.agents/skills` set plus the per-harness symlink targets for Claude Code, Windsurf, Codex, etc.) and the copy/symlink/remove logic over them.

**Decision: VENDOR incur's `src/internal/agents.ts` (a single, dependency-free file) into dorfl under its MIT notice, and write a thin native `dorfl skills add` around it — do NOT take incur as an npm dependency, and do NOT re-derive the harness map by hand.**

Why this split:

- **Vendor, not depend.** The one genuinely valuable, hard-to-rederive piece is the harness-destination map in `internal/agents.ts` — self-contained (only `node:fs`/`os`/`path`), exactly the "copy this folder of hand-authored `SKILL.md` files to the right places" shape dorfl needs. The rest of incur (`SyncSkills`/`Skillgen`/`Cli`) is a CLI FRAMEWORK that GENERATES skill files from a command map — the opposite of dorfl's hand-authored skills — and `Agents.install` is only reachable through that framework-coupled `sync()`. Taking the whole dependency to reach one file is heavier than the problem and drags in incur's release cadence; re-deriving the map by hand would be tedious and would silently drift from upstream. Vendoring the one file gets the coverage with none of the framework.
- **Licensing is clean in this direction.** incur is MIT; dorfl is AGPL-3.0(-to-be, see the note below). AGPL consuming MIT is the sanctioned direction (MIT permits copy/modify/sublicense into stronger copyleft). The single MIT condition is attribution: the vendored file keeps incur's copyright + MIT permission text, with incur's `LICENSE` dropped beside it (e.g. `packages/dorfl/src/vendor/incur/`). The vendored file stays MIT-with-attribution; the `skills add` wrapper is AGPL. This dual state is normal and legal.
- **It matches an existing dorfl pattern.** dorfl already "copies canonical artifacts into a target" (setup's verbatim `work/protocol/` copy, the `vendor-protocol.mjs` build step). A native `skills add` that copies `skills/*` into the harness dirs is the same pattern, and keeps dorfl dependency-light (currently only `commander`).

## Considered Options

- **Depend on incur as an npm package** — rejected: a large framework carried for one file, whose useful part isn't cleanly callable in isolation (it's entangled with generate-from-command-map), and whose skill model (generated, not hand-authored) is the wrong shape.
- **Adopt incur as dorfl's CLI framework** — explicitly out of scope (maintainer parked it); a much larger, separate decision that must not be smuggled in via "we need skill install." If ever revisited it deserves its own ADR.
- **Hand-roll the harness map natively** — rejected as the default: correct but tedious, and it would drift from incur's actively-maintained map as new harnesses appear. (If incur's map ever proves unmaintained, re-deriving becomes the fallback — the vendored file is ours to maintain once copied.)

## Consequences

- The vendored map installs skills by COPYING into the canonical `~/.agents/skills/` (+ symlinking non-universal harnesses). This is a DIFFERENT model from the maintainer's current dogfooding setup, where `~/.agents/skills/*` are symlinks INTO this repo's `skills/`. For a newcomer (no dorfl checkout) the copy-into-canonical model is the correct one; the two models coexist (the maintainer keeps their symlinks, `skills add` serves everyone else). The enacting spec (`skills-add-command`) must be explicit about this.
- Keeping the vendored file byte-close to upstream (a clearly-labelled `vendor/incur/` copy, only wrapper code around it) makes pulling future incur harness-map updates a mechanical re-copy, not a merge.

> Separate pre-existing gap (not decided here, flagged for a human): dorfl currently declares NO license at all (no `LICENSE` file, no `license` field in any `package.json`), which legally means all-rights-reserved. Vendoring MIT code is fine regardless, but the project's own license should be set (house default AGPL-3.0-only) independently of this ADR.
