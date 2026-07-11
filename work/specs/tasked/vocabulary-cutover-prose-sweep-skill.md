---
title: convert-from-prd-to-spec — a skill that drives prd-to-spec then sweeps the prose the command skips
slug: vocabulary-cutover-prose-sweep-skill
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Decisions (maintainer-resolved at launch)

1. **A NEW standalone skill named `convert-from-prd-to-spec`** — NOT folded into the not-yet-built `migrate` skill. `migrate` is about foreign-format mapping (another system → the contract); this is a same-format keep-case vocabulary sweep of a repo ALREADY on the contract, so it stands alone.
2. **The skill OWNS the doc-sweep coverage; `dorfl prd-to-spec` is NOT extended with an option-3 report-line fallback.** Because the skill can (and should) do the prose sweep the command skips, there is no need to make the bare command print a manual grep — invoking the skill IS the complete path. (A user running the bare command without the skill still gets the correctly-converted `work/`+config+refs+protocol; the residual prose is the skill's job.)
3. **The skill is `prd`-SPECIFIC** — authored for the `prd → spec` cutover (today's only cutover), NOT generalised to an arbitrary `<from> → <to>` from day one. The DATA engine's `VocabularyMigration` parameterisation remains the reuse mechanism if a future cutover appears; the skill is not pre-generalised.

## Problem Statement

A maintainer who runs `dorfl prd-to-spec` to migrate a repo off the retired `prd` vocabulary gets a correctly-converted `work/` tree, `.dorfl.json`, inert git refs, AND a re-synced `work/protocol/*` contract — but the artifact WORD is left untouched everywhere ELSE: `CONTEXT.md`, `README.md`, `AGENTS.md`, `docs/**` (including ADRs), and any source comments / strings / doc prose. The command's DATA migration is deliberately scoped to `work/**` + config + refs (the deterministic, gated, idempotent layers); prose is out of scope because sweeping it correctly needs JUDGEMENT the deterministic `keepCaseReplace` cannot safely apply (a blind find/replace over source over-rewrites slugs, symbols, and English).

So today the human finishes the job by hand. In the dorfl self-migration that was a ~40-file, multi-commit sweep (dorfl is the WORST case — it is both AUTHOR and USER of the protocol, so it carries the word in its `work/` tree, its product source, its ADRs that DECIDED the vocabulary, and its protocol docs). A normal downstream repo carries the word only in its `work/` tree plus a handful of `CONTEXT.md`/README/doc mentions — far less residue, but still enough that a bare `prd-to-spec` leaves the repo visibly half-converted with no signposting.

## Solution

A **skill** (protocol-layer, runner-agnostic — adopt/convert = skill, per ADR §8) that drives the WHOLE vocabulary cutover end-to-end, so a user invokes ONE thing and the agent does both halves:

1. **Deterministic half — CALL the command, do not re-implement it.** The skill runs `dorfl prd-to-spec` (optionally `--dry-run` first), which owns the quiescence gate, the `work/**`+config+refs conversion, the `work/protocol/*` re-sync, idempotency, and the forward+reverse leak-scan gate over the converted tree. If `dorfl` is not installed, the skill can hand-do these layers per the runner-agnostic stance — the command is the FAST PATH, not a hard dependency.
2. **Judgement half — sweep the prose the command skips.** The skill walks the non-`work/` trees (`CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**`/source comments+strings), proposes keep-case rewrites of the artifact WORD, and DEFERS the ambiguous ones to the human, applying the reusable pattern toolkit (below). It ends by running the widened bi-word leak scan as the acceptance gate over BOTH halves.

The reusable pattern — proven out by hand in the dorfl self-cutover (commits `97d0a4c3`, `6c658f2e`, `8f9e04fc`) — becomes the skill's authoritative discipline so a future cutover reuses it rather than re-deriving it.

## User Stories

1. As a maintainer migrating a repo off the `prd` vocabulary, I want to invoke ONE skill and have the agent run `dorfl prd-to-spec` AND sweep the leftover prose, so I do not finish the job by hand.
2. As that maintainer, I want the skill to CALL the deterministic command (not re-implement it), so the gated/idempotent/`--dry-run` guarantees stay where they belong and the skill adds only the judgement layer.
3. As a maintainer on a repo without `dorfl` installed, I want the skill to still complete the whole cutover by hand-following the same layers, so adoption never requires the runner (ADR §9).
4. As a maintainer, I want the skill to sweep the artifact WORD in `CONTEXT.md`/`README.md`/`AGENTS.md`/`docs/**` and source prose, so the repo is not left visibly half-converted after the command runs.
5. As a maintainer, I want the skill to NEVER rewrite a `prd`-containing hyphenated slug / filename / `slug:`/`spec:`/`blockedBy:`/`covers:` value / camelCase symbol / historical API name, so file identities and cross-references are not broken and history is not desynced.
6. As a maintainer, I want the skill to keep the retired word where it is IMMUTABLE PROVENANCE — terminal-history bodies, dated incident narration in active task bodies, and ADR text that RECORDS what was retired or the migration's pre-cutover INPUT — so the sweep does not falsify history.
7. As a maintainer, I want a uniquely-greppable `''word''` provenance marker written around a retired token that is named ONLY as provenance in a live doc/comment, so `grep "''prd''"` finds exactly those mentions and the leak scan can exempt the marker span like a backtick span.
8. As a maintainer whose cutover has a REVERT in its history (e.g. `spec → brief → spec`), I want the acceptance leak scan to be BI-WORD (fail on the retired word OR the reverted-away word), so a forward-only scan does not silently pass a stray `brief`.
9. As a maintainer, I want the skill to distinguish a COINED token (zero English collisions, e.g. `prd`) from a REAL-WORD token (English collisions, e.g. `brief` / `debrief` / "a brief note"), so the real-word lens carries an English allow-list and a following-noun disambiguation heuristic while the coined lens does not.
10. As a maintainer, I want the acceptance leak scan to gate current-guidance docs (CONTEXT/README/AGENTS/skills/live ADR reference) but EXEMPT provenance trees, with the split encoded as concrete per-tree scoping and a concrete, non-vacuous, each-entry-justified allow-list (not a blanket exemption).
11. As a maintainer, I want the SKILL to be the complete path for a fully-converted repo (deterministic command + prose sweep), so there is no need for the bare command to print a manual-grep fallback — invoking the skill IS the coverage (decision 2).
12. As a maintainer, I want a `--dry-run`-equivalent for the skill's prose half (propose the rewrites, write nothing), so I can review the judgement calls before they land — mirroring the command's `--dry-run`.

### Autonomy notes (the two gate axes — set the frontmatter flags accordingly)

- **`humanOnly`:** OMITTED. This is tooling/methodology work (a skill doc + the leak-scan pattern); its tasks are agent-buildable. The prose SWEEP itself is judgement-heavy at RUN time, but AUTHORING the skill is not human-only.
- **`needsAnswers`:** OMITTED — the three launch open questions are resolved (see `## Decisions`): a new standalone `convert-from-prd-to-spec` skill, the skill owns the doc-sweep coverage (no bare-command report-line fallback), `prd`-specific (not pre-generalised). The spec is complete and agent-taskable.

> Tasked 2026-07-11 into `work/tasks/backlog/` (`author-convert-from-prd-to-spec-skill`, `convert-from-prd-to-spec-skill-doc-conformance-guard`). The Implementation / Testing detail moved into those tasks; the durable rationale (adopt = skill / execute = command, runner-agnostic, purpose-named migration verb) lives in ADR §7e/§8/§9 of `docs/adr/command-surface-and-journeys.md`.

## Out of Scope

- **Re-implementing the DATA migration in the skill.** The `work/**`+config+refs+protocol conversion stays in `dorfl prd-to-spec` (deterministic, gated). The skill CALLS it.
- **A general `migrate <from> <to>` command.** ADR §7e keeps the verb purpose-named; the DATA engine's `VocabularyMigration` parameterisation is the reuse mechanism, not a new generic command.
- **A GENERIC `<from> → <to>` skill.** Decision 3: the skill is `prd`-SPECIFIC, authored for the one cutover that exists; it is not pre-generalised.
- **Folding into the `migrate` skill.** Decision 1: this is a NEW standalone `convert-from-prd-to-spec` skill, distinct from `migrate` (foreign-format mapping).
- **A bare-command doc-sweep report fallback.** Decision 2: the skill owns the prose-sweep coverage; `dorfl prd-to-spec` is not extended to print a manual grep.
- **A `doctor` command.** Separate, undecided idea (`setup-and-migrate-skills.md`).
- **Sweeping the `.github/workflows/*.yml`.** Those are regenerated by `dorfl install-ci` (not hand-edited); a regen is the fix. The skill may NOTE they are stale, not edit them.
- **The dorfl self-cutover itself** — already done by hand (commits `97d0a4c3`/`6c658f2e`/`8f9e04fc`); this spec generalises the learning into reusable tooling, it does not re-do dorfl.

## Further Notes

- Provenance: incubated in `work/notes/ideas/prd-to-spec-sweep-beyond-work-tree-and-reusable-cutover-pattern.md` (2026-07-11), itself consolidating the sibling observations `installed-close-job-workflow-yml-stale-prd-prose-2026-07-10`, `advance-lifecycle-template-src-prose-still-says-prd-2026-07-10`, `word-scan-exempts-prd-cutover-task-bodies-2026-07-10`, `word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10`.
- Related idea: `setup-and-migrate-skills.md` (the `setup`/`migrate`/`doctor` family) — decision 1 keeps this a standalone skill, distinct from `migrate`.
- VERIFIED during incubation: `dorfl prd-to-spec` DOES re-sync `work/protocol/*` (layer 2 copies the package-canonical contract, never the target's old copy, bumps `VERSION`); the corrected `spec` contract is byte-identical in `dist/protocol/`, so it propagates to downstream repos. That layer needs no change — the gap is strictly the non-`work/` prose.
