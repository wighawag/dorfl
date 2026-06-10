---
title: slice-level-issue-field-for-lone-issue-derived-slice — add an optional slice `issue:` field (one closure path per slice; `prd:` wins if both present) and STOP intake emitting `Fixes #N`; closure becomes folder+field state read by a future CI close-job
slug: slice-level-issue-field-for-lone-issue-derived-slice
prd: issue-intake
covers: [8]
---

> Derives from the `issue-intake` PRD; it REVISES that PRD's "Out of Scope" + "Loop closure" sections, so part of this slice is a drift-correction of the PRD itself. Source signal: `work/observations/slice-level-issue-field-for-lone-issue-derived-slice.md`.

## What to build

Intake today writes a literal `Fixes #N` line into the body of the emitted `work/backlog/<slug>.md` (`renderBacklogSlice` in `src/intake.ts`). That is wrong on three counts (maintainer-confirmed):

1. `Fixes #N` is a GitHub PR/commit close-keyword — it does nothing inside a slice's markdown body, and it leaks into the eventual build PR's diff.
2. The PR that should ever carry `Fixes #N` is the one that **implements** the slice (a `do <slice>` build PR), NOT the intake PR that merely creates the backlog file — so as-is, merging the intake PR would close the issue **before any work is done**.
3. Intake does not always create a PR (the `--merge` path lands the file directly on `main`), so a "the slice's PR carries `Fixes #N`" model is already broken.

**Settled model (maintainer decision):** closure is by an `issue:` FIELD + folder state, read by a FUTURE CI close-job — `Fixes #N` is dropped from intake entirely (it is a GitHub-only optimisation we are not sure works on every provider, so it is deferred; later, `do` MAY auto-inject `Fixes #N` on the build PR as an optimisation — out of scope here).

TWO independent reasons `Fixes #N` is at best a propose-only OPTIMISATION, never the closure mechanism:

- **Provider portability:** `Fixes #N` is a GitHub-native magic keyword; the issue seam is provider-pluggable, and a non-GitHub provider has no auto-close.
- **`--merge` mode has no slot for it at all:** in propose mode the artifact rides a PR whose BODY can carry `Fixes #N`; in `--merge` mode the artifact lands DIRECTLY on `main` with NO PR — so there is no PR body for the keyword to live in (a commit-message `Fixes #N` is murkier still: default-branch-only, stripped by squash/rebase, fires on landing = the same premature-close problem). So even on GitHub, `Fixes #N` is structurally impossible to place cleanly on the merge path. The field + CI close-job is the ONLY model that works uniformly across propose/merge AND across providers.

Build:

- **Add an OPTIONAL slice-level `issue: N` frontmatter field** (the parser already reads `issue:` as a flat number — today its DOC says "PRD-only". Make it legal/documented on a slice too. NOTE: there is no separate frontmatter-validation layer today, and `covers` is not even parsed in `frontmatter.ts` — so do NOT invent a validator; see the one-closure-path rule below for how the invariant is enforced cheaply.) Used ONLY for the LONE issue-derived slice (the SLICE outcome, no `prd:`).
- **INVARIANT: one closure path per slice — `prd:` and `issue:` should not coexist.** Enforce it as a READ-TIME PRECEDENCE RULE, NOT a throwing validator: if a slice somehow carries BOTH (only possible via a human hand-edit — intake's own `dispatchSlice`/`dispatchPrd` branches are mutually exclusive and never emit both), the closure reader IGNORES the slice's `issue:` and uses `prd: → PRD issue:`. This is lossless (the referenced PRD carries the authoritative number) and degrades gracefully on a typo instead of throwing. Document the invariant; the precedence rule is the enforcement.
- **Intake SLICE outcome emits `issue: N` in the slice frontmatter, NOT `Fixes #N`** anywhere. Remove the `Fixes #N` body line from `renderBacklogSlice`.
- **Intake PRD outcome is unchanged** — the PRD still carries `issue: N`; its fanned slices reach it via `prd: → PRD issue:` (no `Fixes #N`, no slice `issue:` on a fanned slice).
- **Correct the `issue-intake` PRD drift** (`work/prd-sliced/issue-intake.md`): the "Loop closure" section's "a lone slice's PR carries `Fixes #N` → its merge closes the issue directly" premise is false; and "Out of Scope" rejects a slice-level `issue:`. Revise both to the settled model (lone slice → `issue:` field; closure is a CI close-job over folder+field state; `Fixes #N` is a deferred GitHub optimisation, not the mechanism). Since the PRD lives in `work/prd-sliced/`, follow the contract's "small factual correction you are certain of" path — fix the PRD text in place.

The actual issue-closing (the CI close-job that scans for open issues whose lone-`done/`-slice carries `issue: N`, OR whose PRD carries `issue: N` with all referencing slices in `done/`) is `runner-in-ci`'s, NOT built here. The `prd-complete.ts` query is the existing half of it.

## Acceptance criteria

- [ ] A slice may carry an optional `issue: N` frontmatter field; the `frontmatter.ts` `issue` doc no longer says "PRD-only" (it is parsed as a flat number already — only the type/doc + the closure reader change).
- [ ] When a slice carries BOTH `prd:` and `issue:`, the closure path PREFERS `prd:` (hops to the PRD's `issue:`) and IGNORES the slice's `issue:` — a read-time precedence rule, NOT a thrown error; a test pins the precedence (the lone-slice path uses `issue:`; the both-present path uses the PRD).
- [ ] Intake's SLICE outcome writes `issue: N` in the emitted slice's frontmatter and emits NO `Fixes #N` anywhere (body or PR); a test asserts the emitted slice file contains `issue: N` and does NOT contain `Fixes`.
- [ ] Intake's PRD outcome is unchanged (`issue: N` on the PRD; fanned slices use `prd:`); existing PRD-outcome tests still pass.
- [ ] The `issue-intake` PRD's "Loop closure" + "Out of Scope" sections are corrected to the settled model (no false `Fixes #N` lone-slice-close claim; `issue:` field is in-scope; closure is the CI close-job; `Fixes #N` is a deferred optimisation).
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None — can start immediately.

## Prompt

> Add an OPTIONAL slice-level `issue: N` field and STOP intake emitting `Fixes #N`. Source: `work/observations/slice-level-issue-field-for-lone-issue-derived-slice.md`; PRD: `work/prd-sliced/issue-intake.md` (this slice REVISES its "Loop closure" + "Out of Scope"). Settled model: closure is by an `issue:` field + folder state read by a FUTURE CI close-job; `Fixes #N` is dropped from intake entirely (a deferred GitHub-only optimisation, not assumed to work on every provider).
>
> DRIFT CHECK FIRST: confirm `renderBacklogSlice` (`src/intake.ts`) still writes a literal `Fixes #N` body line, and that `frontmatter.ts` documents `issue:` as PRD-only. If already field-based, this slice is done.
>
> WHAT TO BUILD: (1) make `issue: N` legal/documented on a slice (the parser already reads it as a flat number — update the type/doc; there is NO frontmatter validator today, do not add one); (2) enforce the one-closure-path invariant as a READ-TIME PRECEDENCE rule — if a slice has both `prd:` and `issue:`, the closure reader prefers `prd:` and ignores `issue:` (lossless: the PRD carries the number); a human hand-edit is the only way both appear (intake never emits both); (3) intake SLICE outcome writes `issue: N` in frontmatter, NOT `Fixes #N` — remove the `Fixes` line from `renderBacklogSlice`; (4) leave the PRD outcome unchanged; (5) correct the PRD's "Loop closure" + "Out of Scope" text in place (it is in `work/prd-sliced/`; this is a certain factual correction).
>
> SCOPE FENCE: do NOT build the CI close-job or `do`'s `Fixes #N` auto-injection (both `runner-in-ci` / a later optimisation). Do NOT add `issue:` to fanned slices (they use `prd:`). Do NOT add a throwing frontmatter validator — the precedence rule is the enforcement.
>
> SEAM TO TEST AT: `frontmatter.ts` (the `issue` field doc/type) and the intake SLICE-outcome dispatcher at the stubbed seam (the emitted slice carries `issue: N`, contains no `Fixes`), plus a test of the both-present precedence (PRD wins). Mirror the existing intake + frontmatter tests.
>
> "Done" = a lone intake slice carries `issue: N` (not `Fixes #N`), a both-present slice resolves via `prd:` (precedence, no throw), the PRD drift is corrected, and `pnpm -r build && pnpm -r test && pnpm format:check` is green.
