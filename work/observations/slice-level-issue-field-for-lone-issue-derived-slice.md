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

- `work/backlog/slice-level-issue-field-for-lone-issue-derived-slice.md` (the field + the one-closure-path PRECEDENCE rule — `prd:` wins if both present, NO throwing validator — + `Fixes #N` removal + PRD drift correction). The mutual-exclusion is enforced by precedence, not a validator: intake never emits both, and a human typo degrades to "use the PRD's number" rather than crashing.
- `work/backlog/intake-self-awareness-resumption-tracking.md` (a SEPARATE, pre-existing gap surfaced 2026-06-10: intake has NO marker / bot-identity / cursor, and `classifyIntakeEvent` re-evaluates EVERY new comment with no self-filter — so intake's OWN comments can re-trigger intake. The maintainer specified the fix as a DETERMINISTIC pre-decision TRIAGE GATE on a MARKER (kind `ask` non-terminal / `bounced`,`created` terminal): last comment is intake's → SKIP `no-new-input`; last comment is a human but a terminal marker exists → SKIP `already-terminal`; else PROCEED to the prompt on the new human input. The triage gate is the real guard, NOT the prompt; the `classifyIntakeEvent` self-filter demotes to a scheduling optimisation. Two new named skip outcomes.).
- `work/backlog/intake-posts-completion-comment-on-slice-prd-outcomes.md` (blocked by BOTH the above: it needs the settled closure model AND the self-awareness marker so the completion comment does not re-trigger intake).

## Update (2026-06-10) — review pass + a new race

Reviewing the three slices surfaced fixes (all folded in):

- **Slice A:** the "read-time precedence rule + test" had NO reader to live in (`prd-complete.ts` is keyed on `prd:` only; the lone-slice-`issue:` close-job is `runner-in-ci`'s, out of scope). Reduced to: DOCUMENT the `issue:` XOR `prd:` invariant (no throwing validator); the precedence is optionally a tiny pure `resolveClosingIssue` helper for the future close-job, or deferred entirely. Also: the PRD "Loop closure" drift is on BOTH `Fixes #N` (lone) AND `Refs #N` (fanned) — nothing emits `Refs #N` either; correct both.
- **Slice B:** "merge → link the commit" needs a commit SHA that `IntegrateResult` does NOT expose today (it has `mode`/`mergedToMain`/`url?` only). Decision (maintainer): EXTEND `IntegrateResult` with an additive optional `commit?` (the more-correct option) — acknowledged shared-seam scope, kept additive so `do`/`run`/`complete` are unaffected.
- **Slice C — a NEW race the maintainer spotted:** a human comment that lands AFTER intake READS but BEFORE intake POSTS would be lost forever (intake's comment becomes last → `no-new-input` skip; the raced comment never read). Fix (final design): the marker carries the **IDS** intake read (`seen=<id>,…`), as a per-run DELTA — the full `seenSet` is the UNION of all intake markers in the thread (the CHAIN model, so each marker stays bounded by per-run new comments). The triage, when the last comment is intake's, checks for an UNSEEN comment (thread − seenSet); if one raced in → PROCEED, feeding it to the prompt flagged as PRE-DATING intake's turn. Ids (not a count) because a count cannot distinguish "new comment appeared" from "old one deleted"; this requires an ADDITIVE seam change (`IssueComment` gains `id`/`createdAt`, surfaced by `normaliseComments`). DELETION handling (maintainer): only when ALREADY proceeding for an unseen comment does the triage also compute `seenSet − thread`; a deleted previously-seen comment → flag the prompt "N previously-seen comments deleted; reassess" (the bodies are gone, so a flag+count, not content). A bare deletion with NO new comment does NOT wake intake (it resolves whenever the user next comments).

## Update (2026-06-10) — second review pass

A second adversarial review caught two defects, both DRIFT introduced by our own iteration (a slice referencing a mechanism a later decision obsoleted):

- **Slice C:** the `classifyIntakeEvent` marker self-filter CONTRADICTED that module's deliberate design (`IntakeEvent` is `{kind}`-only by contract — "no author, no CI trigger policy") AND C itself called it non-load-bearing. DROPPED entirely: the deterministic TRIAGE GATE is the complete safety mechanism (intake is safe even if a run is scheduled); marker-aware SCHEDULING, if ever wanted, is `runner-in-ci`'s (it owns the event/trigger policy). Net simplification + a cleaner `intake-event.ts`.
- **Slice B:** its `created` completion-comment marker OMITTED the `seen=` field C now mandates on EVERY marker (chain model) — it would have been a malformed marker breaking the `seenSet` union. Fixed: B stamps the FULL marker (`kind=created slug=<slug> seen=<ids-read>`) via C's shared stamp helper, and its safety story retargets from the (now-removed) `classifyIntakeEvent` self-filter to C's triage gate (`already-terminal`).

Slice A re-reviewed clean (approve). Lesson: when a later decision removes/changes a mechanism, grep the OTHER slices for references to it — both defects were "a slice still pointing at an obsoleted mechanism".

## Update (2026-06-10) — third review pass (algorithm-level)

With C's structure + grammar settled, a third pass attacked the SET-ALGORITHM itself (tracing it on a concrete multi-marker thread, not reading prose) and found a genuine under-specification earlier passes hadn't reached:

- **The trap is intake's OWN comments.** The unseen-check is "is there a comment intake never read?" — but intake's own marker-comments are IN the thread, so a naive set-membership check would see them as "unseen" every run and falsely PROCEED. PINNED: `seen=` is the per-run delta of HUMAN comment ids (excluding intake's own marker-comments AND already-seen ids); the unseen-check + deletion-check range over HUMAN comments only (intake comments identified by their marker, excluded). This is now stated in C's marker semantics, triage, criteria, Decisions, and prompt.
- **Cut `createdAt`** from the `IssueComment` seam change — it was speculative ("ordering robustness") but nothing in the triage reads a timestamp (it is id-set membership + `listComments`' documented oldest-first order). YAGNI.

Lesson (for the algorithm-y slices): once the prose is consistent, TRACE the algorithm on a concrete adversarial input (here: a multi-turn thread with intake's own comments interleaved) — that is what surfaces "two valid implementations, one wrong" gaps the prose hides.

## Update (2026-06-10) — fourth review pass: bounce is terminal → intake CLOSES the issue (a deliberate PRD reversal)

The fourth pass surfaced a product question the triage had silently decided: `bounced` is classified TERMINAL, so after a bounce intake skips forever (`already-terminal`) — but the PRD's BOUNCE row says "leave the issue OPEN". Flagged rather than guessed. **Maintainer decision:** bounce IS terminal, AND — since terminal — an open issue is a dishonest "still in play" signal, so **intake CLOSES the issue on bounce**.

This REVERSES, for the BOUNCE case only, the PRD's repeated invariant "intake never closes the issue / closing is CI's close-job" + the BOUNCE "leave the issue OPEN" line. The settled split:

- **bounce** → intake closes the issue DIRECTLY (terminal, no `work/` follow-up).
- **slice / prd** → intake does NOT close; the future CI close-job closes via the `issue:` field.
- **ask** → never closes.

Because it reverses a stated invariant AND adds a new issue-mutating power (`closeIssue`, previously deferred to `runner-in-ci`), it is its OWN slice, not folded into the self-awareness slice: `work/backlog/intake-closes-issue-on-bounce.md` (adds `closeIssue` to the seam + closes on bounce + amends the PRD + reconciles the in-code "never closes" statements). Slice C classifies `bounced` terminal (the skip side); slice D performs the close (the action side) — two halves of one decision. Slice B's "intake never closes the issue" wording was reconciled to "never closes ON THE SLICE/PRD PATH".

FUTURE (noted, not now): if leaving a bounced issue open to let the user reply/push-back turns out preferable, revisit — `bounced` would move to non-terminal in C's triage and the close would drop. The data/interpretation split (marker stores `kind`, triage owns terminal-ness) keeps that cheap.

## Refs

- Source: the `issue-intake` slice review session, 2026-06-09 (maintainer's challenge to B2's resolution).
- Affected PRD: `work/prd-sliced/issue-intake.md` — Out of Scope ("A slice-level `issue:` field — not needed …") + Loop closure section.
- Related slices: `work/backlog/intake-tracer-slice-outcome.md` (emits the lone slice with `Fixes #N`), `work/backlog/intake-decision-prompt-and-four-outcome-dispatch.md` (adds `issue:` PARSING to `frontmatter.ts` for the PRD; this observation proposes the slice-level field + the mutual-exclusion rule on top).
- Related: `work/observations/skillset-missing-the-to-slices-vs-do-prd-choice.md` (the same review session).
