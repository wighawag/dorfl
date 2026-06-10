---
title: a lone issue-derived slice should carry an optional issue: field (provider-robust closure), mutually exclusive with prd:
type: observation
status: spotted
spotted: 2026-06-09
---

## What was spotted

While reviewing the `issue-intake` slice set (2026-06-09), the maintainer challenged the PRD's decision to have NO slice-level `issue:` field. The PRD (`work/prd-sliced/issue-intake.md`, Out of Scope) rejects a slice-level `issue:` with:

> A slice-level `issue:` field — not needed (the only multi-slice case is the PRD, tracked by `prd:`; unrelated multi is bounced).

That rationale covers the PRD-FANNED case correctly (a fanned slice reaches the issue via `slice.prd: → work/prd/<prd>.md → PRD issue:`, and must NOT carry `Fixes #N` — that would close the issue on the first of N merges). But it SILENTLY ASSUMES `Fixes #N` covers the LONE-slice case — and `Fixes #N` is a **GitHub-native** mechanism. The issue seam is explicitly provider-pluggable (GitHub first; others allowed). On a NON-GitHub provider there is no `Fixes #N` auto-close, so a lone issue-derived slice would have NO machine-readable link back to its issue at all.

## The proposed shape (unverified — a design proposal, not a decision)

Add an OPTIONAL slice-level `issue: N` field, used ONLY for the LONE issue-derived slice (the SLICE outcome with no PRD):

- **lone slice (no `prd:`)** → optional `issue: N` on the slice = the robust, provider-AGNOSTIC closure link. `Fixes #N` in the PR body becomes a GitHub OPTIMIZATION layered on top (native auto-close), NOT the sole mechanism — a non-GitHub close-job reads the slice's `issue:` instead.
- **PRD-fanned slice** → `prd:` only; hop to the PRD's `issue:` (unchanged; avoids the premature-close-on-first-merge problem). These slices still carry `Refs #N` (not `Fixes #N`) in their PR.
- **INVARIANT:** `prd:` and `issue:` on a slice are MUTUALLY EXCLUSIVE — they cannot coexist. This encodes "exactly one closure path per slice": either it closes its own issue directly (`issue:`), or it contributes to a PRD that closes the issue (`prd:` → PRD `issue:`). A slice with both, or a slice claiming to fix an issue while also belonging to a PRD, is a contradiction the parser/validator should reject.

## Why it matters

- **Provider portability:** the PRD's `Fixes #N`-only lone-slice closure is a hidden GitHub dependency in an otherwise provider-pluggable design. An optional `issue:` field makes lone-slice closure work on any provider; GitHub's `Fixes #N` stays as a nice-to-have.
- **Robustness:** an explicit field survives PR-body edits, squash-merges that drop `Fixes #N`, and providers that don't parse magic keywords.
- It REVISES a PRD Out-of-Scope decision, so it is a candidate AMENDMENT to `issue-intake` (and a thing the eventual `runner-in-ci` close-job design must know), not something to silently fold into the existing slices.

## Consequence to weigh (the counter-argument the PRD was guarding)

The PRD avoided slice-level `issue:` partly to keep the issue number in ONE place (single source of truth, no drift). The mutual-exclusion invariant preserves that: the number still lives in exactly one place PER SLICE (either the slice's own `issue:` for a lone slice, or the PRD's `issue:` for a fanned slice) — never duplicated across N slices. So the drift concern applies only to the fanned case, which still uses the `prd:` hop. The lone-slice `issue:` is not a duplication (there is only one slice).

## Update (2026-06-10) — decided + sliced

The maintainer RATIFIED the proposed shape AND extended it: not only does a lone slice carry `issue:` (mutually exclusive with `prd:`), but **intake stops emitting `Fixes #N` entirely**. Closure becomes a FUTURE CI close-job that scans for open issues whose lone `done/` slice carries `issue: N`, OR whose PRD carries `issue: N` with all referencing slices in `done/`. `Fixes #N` is demoted to a deferred GitHub-only OPTIMISATION (possibly via `do` auto-injecting it on the build PR later) because it is not known to work on every provider. A SECOND, structural reason (raised 2026-06-10): in `--merge` mode there is NO PR at all (the artifact lands directly on `main`), so there is no PR body for the keyword to live in — `Fixes #N` is structurally impossible to place cleanly on the merge path, even on GitHub. So it fails for TWO independent reasons (provider portability AND no merge-mode slot), which is why the field + CI close-job is the only uniform model.

Also decided in the same session: intake should POST a completion comment on the SLICE/PRD success outcomes (`slice created` / `prd created`, never `issue resolved`).

Sliced into:

- `work/backlog/slice-level-issue-field-for-lone-issue-derived-slice.md` (the field + mutual-exclusion + `Fixes #N` removal + PRD drift correction).
- `work/backlog/intake-posts-completion-comment-on-slice-prd-outcomes.md` (blocked by the above).

## Refs

- Source: the `issue-intake` slice review session, 2026-06-09 (maintainer's challenge to B2's resolution).
- Affected PRD: `work/prd-sliced/issue-intake.md` — Out of Scope ("A slice-level `issue:` field — not needed …") + Loop closure section.
- Related slices: `work/backlog/intake-tracer-slice-outcome.md` (emits the lone slice with `Fixes #N`), `work/backlog/intake-decision-prompt-and-four-outcome-dispatch.md` (adds `issue:` PARSING to `frontmatter.ts` for the PRD; this observation proposes the slice-level field + the mutual-exclusion rule on top).
- Related: `work/observations/skillset-missing-the-to-slices-vs-do-prd-choice.md` (the same review session).
