---
title: prd→spec batch 5 (protocol contract + to-spec skill) — option-A vocabulary boundary + decisions for the leak scan
slug: 2026-07-10-spec-contract-batch5-vocabulary-boundary-and-decisions
---

Provenance note for `contract-spec-hard-cutover-rejection-and-leak-scan` (the next / contract batch) so its BI-WORD leak scan knows which `prd` tokens SURVIVED batch 5 ON PURPOSE (option A, a partial migrate-step), and where a few `to-prd`/`prd`-artifact-word references were deliberately LEFT out of this task's scope.

## What batch 5 renamed (role 1 — artifact WORD → `spec`, keep-case)

In `skills/setup/protocol/*` (`WORK-CONTRACT.md`, `TASKING-PROTOCOL.md`, `REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `CLAIM-PROTOCOL.md`) the artifact word `prd`/`PRD`/`Prd` meaning "the parent-spec document" was rewritten to `spec`/`SPEC`/`Spec`. `prd-template.md → spec-template.md` (`git mv`, source + mirror). The `to-prd` skill was `git mv`'d to `to-spec` (`skills/to-spec/`, frontmatter `name: to-spec`, body cut over). Source == `work/protocol/` mirror == `dist/protocol/` vendored are byte-identical; `work/protocol/VERSION` bumped to `2026-07-10`.

## What SURVIVED as `prd`/`prds` on purpose (roles 2 + 3 — the alias the contract task removes)

The doc-consistency tests PIN several of these; do NOT read them as leaks:

- **Role 2 — the `prd:` frontmatter FIELD** and its mentions: `prd: historical-store`, `prd: example-prd`, "the required `prd`", `covers` "within `prd`", "inherit (prd, else repo)", the whole `### The prd link` section in `WORK-CONTRACT.md`, and the `### Prd gate vs task gate` cross-references that describe the field. `tasking-protocol-doc.test.ts` asserts `toMatch(/\bprd\b/)` (twice) and parses a canonical `prd: example-prd` fixture.
- **Role 3 — the `work/prds/...` FOLDER paths + verb/lock forms**: every `work/prds/{proposed,ready,tasked,dropped}/` path, `prds/` in the layout tree, `refs/dorfl/lock/prd-<slug>`, the `do prd:<slug>` / `advance prd:` verb forms, `taskedAfter` + `taskedAfter (cross-prd order)` (incl. `[other-prd]` slug references and the whole `### taskedAfter — prd tasking-order` section, which reads against `work/prds/tasked/` residence). `tasking-protocol-doc.test.ts` asserts the runtime tasking prompt still emits `work/prds/ready|tasked/` — but that test reads `packages/dorfl/src/tasking.ts`, which was left UNTOUCHED (a separate folder concern).

Rule of thumb applied: token followed by `:` (field), OR part of a `work/prds/...` path, OR `do/advance prd:` / `prd-<slug>` lock ref → LEFT as `prd`. Otherwise (artifact word) → `spec`.

## Decisions (recorded per the record-durably rule; also in the done record / PR body)

1. **CLAIM-PROTOCOL.md wrapper prose `prd → spec` forced a coupled CODE-TEST edit.** The runner's work-agent prompt wrapper is read VERBATIM from `skills/setup/protocol/CLAIM-PROTOCOL.md` by `packages/dorfl/src/prompt.ts` (`extractCanonicalWrapperTemplate`). Renaming the wrapper's artifact word ("your complete prd" / "source prd" / "the task file is the prd") to `spec` therefore changed the literal `prompt.test.ts` pins (`toContain('complete prd')` → `toContain('complete spec')`). That is the ONE code test this artifact-word rename forced; I updated `packages/dorfl/test/prompt.test.ts` accordingly (the "coupled test" the task sanctions). `prompt.ts` code + `<prd>` placeholder + `prd:` field mention inside the wrapper were LEFT (role 2/3). Alternative considered: leave the wrapper as `prd` — rejected, it is unambiguously the artifact word and CLAIM-PROTOCOL.md is in this task's rename scope, so leaving it would fork the contract's own voice.

2. **`docs/adr/methodology-and-skills.md` LEFT untouched (still says `to-prd`/`prd`).** This ADR is the DECISION RECORD for this very rename; its §7 forward-note explicitly declares "§2–§6 text is left intact; where §2–§6 say `prd`/`to-prd`, read the noun as `spec`/`to-spec` per §7", and §7 itself is decision-prose describing "rename `to-prd → to-spec`". Editing it would corrupt the record / contradict its own freeze note. The acceptance criterion's "update references in docs/" was satisfied by updating the LIVE skill-list pointer in `docs/adr/command-surface-and-journeys.md` instead. Alternative considered: mechanically rewrite the ADR's `skills/to-prd` path mentions — rejected as record corruption.

3. **`packages/dorfl/src/intake.ts` LEFT with two stale `to-prd` references** (lines ~2314, ~2388: "Draft a prd in the `to-prd` shape"). The acceptance criterion scopes reference-updates to `skills/`/`docs/`/`CONTEXT.md`/`AGENTS.md` ONLY (NOT `packages/`), and `intake.ts` is src (batch-4 / contract-task territory). They are prompt-string prose (not a file load), so nothing breaks. Flagging here so the contract task's leak scan expects + sweeps them.

## Manual follow-up (NOT a build change)

The user-machine symlink `~/.agents/skills/to-prd` still points at the now-renamed `skills/to-spec/` directory (or dangles). Re-pointing `~/.agents/skills/*` is a user-machine concern OUTSIDE this repo (see `CONTEXT.md`: "a renamed skill directory needs its `~/.agents/skills/` symlink re-pointed by the user"). The maintainer must re-point `~/.agents/skills/to-spec → skills/to-spec` (and remove the stale `to-prd` symlink) by hand.
