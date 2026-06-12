---
title: Distribute the repo's skills via the standardized .agents/skills/ convention (and prefix their names)
slug: distribute-skills-via-agents-skills-convention
humanOnly: true
blockedBy: []
covers: []
---

## What to build

Make this repo's own skills (the ten under `skills/`) discoverable by skills-compatible harnesses through the standardized **Agent Skills** convention, the same way `setup` already copies `work/protocol/` into a target repo. Two coupled changes:

1. **Adopt the `.agents/skills/` location.** The Agent Skills open standard (agentskills.io) defines the `SKILL.md` format but does NOT mandate where skill directories live; the de-facto cross-client convention that has emerged — and that pi implements — is to scan `<repo>/.agents/skills/` (project scope) and `~/.agents/skills/` (user scope), walking ancestors to the git root. A bare top-level `skills/` is NOT auto-discovered by any harness. So the skills must live under `.agents/skills/<name>/SKILL.md` to be picked up. Decide and implement whether `skills/` MOVES to `.agents/skills/` or whether `setup` (and/or a sync step) COPIES them there — analogous to the protocol-owned `work/protocol/` re-sync. The skills are protocol-owned, so the copy-and-resync model likely fits, but the maintainer decides.

2. **Prefix the skill names to prevent collisions.** The skills are named generically (`setup`, `review`, `orchestrate`, `to-slices`, …) and will collide with same-named skills from other projects or the user's `~/.agents/skills/`. pi's loader does NOT dedup by skill `name` — two same-named skills in different directories both surface in the catalog, so the model picks by description alone. Prefix each with a hyphenated namespace (the spec forbids colons, uppercase, and leading/trailing/consecutive hyphens; `name` must match its parent directory). The maintainer picks the prefix (e.g. `agent-runner-`); apply it consistently to BOTH the frontmatter `name` and the directory name, and sweep every cross-reference (skills referencing each other like `drive-backlog` → `review`/`to-slices`, docs, ADRs, `.agent-runner.json`, CONTEXT.md) so no dangling old name remains.

Per-harness auto-loading is NOT universal — claim only "pi and other clients honoring the `.agents/skills/` convention discover these automatically; some harnesses need manual wiring," and note pi gates project-scope skills on project trust.

## Acceptance criteria

- [ ] The repo's skills are discoverable via the `.agents/skills/` convention (moved or copied there; the move-vs-copy decision is made and recorded with its rationale).
- [ ] If `setup` copies/syncs skills into a target repo's `.agents/skills/`, that step mirrors the existing `work/protocol/` re-sync semantics (create-if-absent, overwrite-to-resync protocol-owned content, never clobber repo-owned items) and is documented in the `setup` SKILL.md.
- [ ] Each skill's frontmatter `name` is prefixed and EXACTLY matches its parent directory name (Agent Skills spec requirement); no uppercase, no colons, no leading/trailing/consecutive hyphens.
- [ ] Every cross-reference to a renamed skill is updated (skill-to-skill references, docs, ADRs, `.agent-runner.json`, `CONTEXT.md`); grep confirms no dangling old bare name remains where the prefixed one is meant.
- [ ] Docs do NOT overclaim universal auto-loading; the cross-harness caveat and pi's project-trust gate are stated.
- [ ] CONTEXT.md / relevant ADR reflect the decision (where skills live, the naming convention) without enumerating individual skills (the folder is the index).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green. No shared/global location written outside test fixtures (skill discovery scans real home/project dirs — any test that exercises it MUST isolate `HOME`/cwd to a temp dir and assert the real `~/.agents/skills` is untouched).

## Blocked by

- None — can start immediately.

## Why humanOnly

This is a naming/coherence and distribution-model decision, not a mechanical build: it picks the namespace prefix, decides move-vs-copy for protocol-owned skills, and touches the protocol/skill layer plus every cross-reference. It needs the maintainer's judgement on the convention and a coherence pass against CONTEXT.md and the ADRs (the "consistency is a first-class quality" invariant). A human must drive it.

## Prompt

> A HUMAN drives this slice (`humanOnly`). Make this repo's own skills discoverable by skills-compatible harnesses via the standardized Agent Skills `.agents/skills/` convention, and prefix their names to avoid catalog collisions.
>
> Context: the Agent Skills open standard (agentskills.io; repo `agentskills/agentskills`) standardizes the `SKILL.md` format (YAML frontmatter `name`/`description` required; optional `license`/`compatibility`/`metadata`/`allowed-tools`; optional `scripts/`/`references/`/`assets/`) but explicitly does NOT mandate WHERE skill directories live. The emerged cross-client convention — implemented by pi and others — is to scan `<repo>/.agents/skills/` and `~/.agents/skills/`, walking ancestors to the git root. A bare top-level `skills/` is NOT auto-discovered. pi gates project-scope skill loading on project trust, and its loader dedups by PATH, not by skill `name` — so two same-named skills in different dirs both appear in the catalog and the model picks by description, which is why a namespace prefix is needed.
>
> Two coupled changes: (1) get the skills under `.agents/skills/<name>/SKILL.md` — DECIDE move-vs-copy (the copy/re-sync model mirrors how `setup` already owns and re-syncs `work/protocol/`, since skills are protocol-owned; the maintainer picks); if `setup` is to distribute them into target repos, mirror the `work/protocol/` re-sync semantics and document it in `setup`'s SKILL.md. (2) Prefix each skill's `name` AND its directory name (they must match per spec; hyphen only, no colon/uppercase/leading-trailing-or-consecutive hyphen; the maintainer picks the prefix, e.g. `agent-runner-`), then sweep EVERY cross-reference — skill-to-skill (`drive-backlog`→`review`/`to-slices`, `orchestrate`→`drive-backlog`, etc.), docs, ADRs, `.agent-runner.json`, `CONTEXT.md` — so no dangling bare name is left where the prefixed one is meant. Grep to verify.
>
> Coherence: run this against CONTEXT.md's "Coherence (a first-class quality)" invariant and the `review` skill's conceptual-coherence lens — the prefix/location must not silently re-mean an existing term or sit at the wrong layer. Record the decision (where skills live + the naming convention) in CONTEXT.md and/or an ADR per `work/protocol/ADR-FORMAT.md`, WITHOUT enumerating individual skills (the folder is the index). Do NOT overclaim universal auto-loading: state the cross-harness caveat and pi's project-trust gate.
>
> FIRST, check this slice against current reality (drift): confirm the skills still live under `skills/`, the cross-reference graph still holds, and no later slice already moved/renamed them. If a dependency landed differently, route to `needs-attention/` rather than building on a stale premise.
>
> READ FIRST: this repo's `skills/` directory (all ten SKILL.md files and their cross-references), `CONTEXT.md` (the coherence invariant + the "adopt = skill" boundary), the `setup` skill's `work/protocol/` re-sync handling (the model to mirror), and the Agent Skills spec at https://agentskills.io/specification and https://agentskills.io/client-implementation/adding-skills-support.
>
> "Done" = skills discoverable via `.agents/skills/`, every name prefixed and matching its directory, every cross-reference swept (grep-clean), the decision recorded coherently, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

---

### Claiming this slice

```sh
agent-runner claim distribute-skills-via-agents-skills-convention --arbiter origin
git fetch origin && git switch -c work/distribute-skills-via-agents-skills-convention origin/main
git mv work/in-progress/distribute-skills-via-agents-skills-convention.md work/done/distribute-skills-via-agents-skills-convention.md
```
