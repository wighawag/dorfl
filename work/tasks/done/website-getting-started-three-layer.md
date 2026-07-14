---
title: Rewrite the website getting-started section skill-first (three layers)
slug: website-getting-started-three-layer
spec: website-getting-started-skill-first
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 7]
---

## What to build

Rewrite the getting-started / install section of the Dorfl landing page so it presents dorfl as THREE layers, in order, instead of leading with the CLI. Currently the page sells only the runner (`npm install -g dorfl` / `remote add` / `do`) and never mentions skills, which is backwards for a newcomer: the real front door is a SKILL (`from-idea` from scratch, `setup` for an existing repo), which needs no `dorfl` install.

Replace the single "Install" / `#install` section with three panels, top to bottom:

1. **Adopt (a skill).** The front door. Install the dorfl skills with `dorfl skills add`, then point your agent at `from-idea` (from scratch) or `setup` (existing repo). Runner-agnostic; no `dorfl` runtime needed to adopt the contract.
2. **The `work/` contract + protocol side-car.** What adoption gives you: the `work/` tree, the vendored `work/protocol/` docs, the `dorfl.json` gate — the file-based substrate the CLI later consumes.
3. **Execute (the CLI) + CI capabilities.** `dorfl do` / `run`, plus the distinctive CI capabilities — call out `intake` (the issue → spec/task front door) by name. This is today's whole install section, repositioned last.

Keep the existing `# install (placeholder)` demoted/updated: layer one uses the real `dorfl skills add`; layer three keeps an accurate CLI install. Reuse the page's existing section/pillar/step component patterns and brand tokens (clay/bone/slate) — re-order and add content only, do NOT restyle or rebrand. Map the existing `#install` nav anchor onto the new flow (rename its label to "Get started" if clearer).

## Acceptance criteria

- [ ] The getting-started section presents the three layers in order (adopt-skill → work/ contract → CLI+CI), replacing the current CLI-first single install section.
- [ ] Layer one shows `dorfl skills add` and names `from-idea` (from scratch) and `setup` (existing repo) as the adopt paths; it is clear no `dorfl` install is needed to adopt.
- [ ] Layer two explains what adoption yields (the `work/` tree, `work/protocol/` docs, `dorfl.json` gate).
- [ ] Layer three presents the CLI (`do`/`run`) and CI capabilities, mentioning `intake` explicitly as the issue → spec/task front door; the CLI install command is accurate (not a placeholder).
- [ ] The nav anchor/link that pointed at `#install` still resolves to the new section (anchor kept or link updated); no dead in-page links.
- [ ] Styling is unchanged (existing brand tokens + component patterns reused); no new pages, no rebrand.
- [ ] Any deviation from the house template made while doing this is recorded in `website/TEMPLATE-NOTES.md` (Dorfl-specific vs backport-candidate), per `website/AGENTS.md`.
- [ ] Copy stays faithful to the repo's framing (`CONTEXT.md`, `work/protocol/WORK-CONTRACT.md`); no invented claims.
- [ ] The site builds and checks clean: `pnpm --filter <site> build && pnpm --filter <site> check`, and the repo gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`). (The site has no unit tests; acceptance is build + svelte-check + format.)

## Blocked by

- None — can start immediately. (The prerequisite spec `skills-add-command` is already tasked, so `dorfl skills add` is a nameable command; this task ships the copy that references it. The command need not be BUILT before this page copy lands.)

## Prompt

> Rewrite the getting-started section of the Dorfl marketing site to be skill-first. Today the landing page sells only the CLI runner and never mentions skills; a newcomer should instead start by installing the skills and invoking `from-idea` / `setup`, because adopting the `work/` contract is a SKILL and needs no `dorfl` install ("adopt = skill, execute = command" is a stated invariant in the repo-root `CONTEXT.md`).
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): open the landing page and confirm it still has a single CLI-first install section with an `#install` anchor and a `# install (placeholder)` block. Confirm the skill names (`from-idea`, `setup`) and the CLI/CI verbs (`do`, `run`, `intake`) still match the repo (`CONTEXT.md`, the `skills/` folder, the command surface). If the page or the vocabulary has moved, adapt to what actually exists rather than building on a stale premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Scope and where to look: this is a CONTENT rewrite of ONE page in the `website/` workspace (the landing route). READ `website/AGENTS.md` FIRST — it is binding: pnpm only, touch only `website/`, do NOT auto-commit, reuse the committed brand palette/tokens (clay/bone/slate) and existing section/pillar/step component patterns, and log any template deviation in `website/TEMPLATE-NOTES.md` (Dorfl-specific vs backport-candidate). Do NOT restyle or rebrand — re-order and add copy only.
>
> Deliver the three-layer structure (adopt-skill → work/ contract → CLI + CI/intake) described in "What to build", keep the `#install` nav anchor resolving (or update the link + label to "Get started"), demote the current CLI install to layer three with an accurate command (not a placeholder), and use the real `dorfl skills add` in layer one. Stay faithful to the product framing in `CONTEXT.md` and `work/protocol/WORK-CONTRACT.md`; invent no capabilities.
>
> Done = the getting-started section reads skill-first in three ordered layers, the site builds and `svelte-check`s clean, the repo gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`), and any template deviation is recorded. The review gate is a human eyeballing the rendered page copy.
>
> RECORD non-obvious in-scope decisions durably and linked from the done record (e.g. renaming the `#install` anchor/label, how the three panels map onto existing components, any copy that makes a product claim you had to verify). ADR-worthy choices → `docs/adr/`; otherwise a note in the done record / `website/TEMPLATE-NOTES.md`. An un-recorded in-scope decision is a review finding.

---

### Claiming this task

```sh
dorfl claim website-getting-started-three-layer --arbiter <remote>
git fetch <remote> && git switch -c work/website-getting-started-three-layer <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/ready/website-getting-started-three-layer.md work/tasks/done/website-getting-started-three-layer.md
```
