---
title: prd-to-spec (and future vocabulary cutovers) should sweep the artifact WORD beyond work/+config; harvest the reusable ''marker'' + bi-word-scan pattern from the dorfl self-migration
slug: prd-to-spec-sweep-beyond-work-tree-and-reusable-cutover-pattern
type: idea
status: incubating
---

# `prd-to-spec` stops at `work/`+config+refs; the artifact WORD leaks everywhere else

> Captured 2026-07-11 after finishing the dorfl self-cutover cleanup by HAND (commits `97d0a4c3` + `6c658f2e`). Two sibling observations already recorded the leak surface piecemeal (`installed-close-job-workflow-yml-stale-prd-prose-2026-07-10`, `advance-lifecycle-template-src-prose-still-says-prd-2026-07-10`, `word-scan-*-2026-07-10`); this idea is the FORWARD-looking consolidation: what the migration command should grow, and the reusable pattern the hand-sweep proved out.

## The gap

`dorfl prd-to-spec`'s DATA migration (`migrateItemContent` + `migrateFolders` + `migrateConfig` + `migrateRefs`) is deliberately scoped to `work/**` bodies, `dorfl.json`, and inert git refs. Layer 2 (`resyncProtocol`) also correctly re-syncs `work/protocol/*` (VERIFIED: it copies the package-canonical contract, never the target's old copy, and bumps `VERSION` — so a downstream repo DOES pick up the corrected `spec` contract, incl. the removed "`prd:` still read as back-compat" claim, which is byte-identical in `dist/protocol/`).

What it does NOT touch: `CONTEXT.md`, `README.md`, `AGENTS.md`, `docs/**` (incl. ADRs), and any SOURCE prose / comments / strings. In dorfl those were the bulk of the residue and had to be swept by hand across ~40 files + two commits. A downstream repo running `prd-to-spec` today gets a converted `work/` tree but is left with a `CONTEXT.md` / README / source that still says `prd`.

## Why this matters LESS for downstream repos than for dorfl

dorfl is the WORST case by far: it is both the AUTHOR and a USER of the protocol, so it carries the vocabulary in (a) its own `work/` tree, (b) its product source (the CLI that speaks the vocabulary), (c) its ADRs that DECIDED the vocabulary, and (d) its protocol docs. A normal downstream project has the word only in its `work/` tree + maybe a few `CONTEXT.md`/README mentions — no product-source layer, no ADR-that-invented-it layer. So the un-swept residue after `prd-to-spec` is typically small (a handful of doc mentions), NOT the ~40-file sweep dorfl needed. Design accordingly: the downstream need is a light "also sweep my docs" pass, not dorfl's full hand-audit.

## Options (not decided)

1. **Widen `prd-to-spec` with an OPT-IN doc-sweep layer** — e.g. `--sweep-docs` (or default-on with `--no-sweep-docs`) that runs `keepCaseReplace` over `CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**` prose the SAME way it sweeps `work/**` bodies, with the SAME `scanForLeaks` gate widened to those trees. Risk: source/prose has a real IDENTITY/English/slug allow-list surface that `work/` data does not (this session proved `prd/task` vs `prd-<slug>` vs `''prd''`-marker vs English `brief` are all distinct), so a blind `keepCaseReplace` over source would over-rewrite. So this layer wants the ALLOW-LIST-aware lens, not the raw find/replace the data layer uses.
2. **A separate `sweep-vocabulary` skill (protocol-layer, runner-agnostic)** — judgement-carrying, human-in-the-loop, sits next to `setup`/`migrate` (see `setup-and-migrate-skills.md`). It walks the non-`work/` trees, proposes keep-case rewrites, and defers the ambiguous ones (slug vs word vs English) to the human. This matches the "adopt/convert = skill, deterministic data = command" split (ADR §8): the `work/`+config+refs conversion is deterministic (command), the prose sweep is judgement-heavy (skill).

   **The skill ORCHESTRATES the whole migration end-to-end so a user invokes ONE thing.** It does NOT re-implement the deterministic part: it CALLS `dorfl prd-to-spec` (which owns the quiescence gate, the `work/`+config+refs conversion, the `work/protocol/*` re-sync, and the forward+reverse leak-scan gate over the converted tree), then does the judgement-heavy PROSE sweep over the trees the command deliberately skips (`CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**`/source comments+strings), applying the allow-list-aware lens + the `''marker''` convention + the provenance-vs-living split from the pattern toolkit below. So the agent flow is: (1) run `dorfl prd-to-spec` (deterministic layers), (2) sweep the prose trees by judgement, (3) run the widened bi-word leak scan as the acceptance gate over BOTH. The user just invokes the skill; the agent drives both halves. (If `dorfl` is not installed, the skill can still hand-do the whole thing per the runner-agnostic stance — the command is the fast path, not a hard dependency.) This keeps the deterministic guarantees where they belong (the command, gated + idempotent + `--dry-run`) while the skill adds ONLY the judgement layer on top.
3. **Do nothing in tooling; document the manual follow-up** — the migration command's `--help`/report tells the user "now sweep your CONTEXT.md/docs by hand; here is the grep." Cheapest; fine given downstream residue is small.

Leaning: (2) or (3) over (1). The prose sweep is exactly the judgement `migrate` already owns; folding it into the deterministic command risks the over-rewrite the allow-list exists to prevent.

## The REUSABLE pattern this session proved out (harvest regardless of which option)

The dorfl hand-sweep produced a small, transferable toolkit worth generalising for ANY future keep-case vocabulary cutover (the engine is already `VocabularyMigration`-parameterised for the DATA layer; this is the PROSE-layer companion):

- **The `''word''` provenance marker.** A doubly-single-quoted retired token (`''prd''`) is a UNIQUELY-greppable "named here only as the retired token" handle, distinct from ordinary backticks (which appear ~40x). Used in narrate-the-removal comments so a maintainer can `grep "''prd''"` for exactly the provenance mentions. The leak scans strip `''…''` spans like backtick spans.
- **The BI-WORD scan.** A cutover with a REVERT in its history (`spec → brief → spec`) needs the scan to fail on BOTH the retired word AND the reverted-away word — a forward-only scan silently passes a stray `brief` (it did: `via: 'brief'`). Every future cutover with a thrash needs this.
- **The English-collision asymmetry.** `prd` is a coined acronym with ZERO English false positives; `brief` is real English (`debrief`/`briefly`/"a brief note"). The lens for a real-word token needs an English allow-list + a "followed by a disambiguating noun" heuristic; the coined-token lens does not. Record which class a `from`/`to` word is.
- **The PROVENANCE-vs-LIVING split.** The retired word is IMMUTABLE PROVENANCE inside terminal-history bodies (and dated incident narration in ACTIVE task bodies) and inside ADRs that RECORD what was retired — rewriting falsifies history. It is a LIVE LEAK in current-guidance docs (CONTEXT/README/skills/live ADR reference). The scans encode this as a per-tree scoping (`isTerminalHistory` / `isWorkItemBody` / backtick-and-marker strip), NOT a blanket exemption.
- **The IDENTITY allow-list.** A `prd`-containing hyphenated slug / filename / `slug:`/`spec:`/`blockedBy:` value / camelCase symbol is a FILE IDENTITY or proper noun and must NEVER be rewritten (breaks references + history). The scans enumerate these concretely and assert the list is non-vacuous.

## Disposition

Becomes a spec when prioritised, likely folded into the `migrate` skill's scope (option 2) with the reusable-pattern toolkit above stated as its acceptance shape. If deferred, at minimum do option (3): have `prd-to-spec`'s report print the manual doc-sweep grep so a downstream user is not left with a silently half-converted repo.
