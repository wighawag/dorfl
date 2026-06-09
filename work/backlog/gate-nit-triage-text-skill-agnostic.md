---
title: Make the Gate-2 review-nits generator's triage text SKILL-AGNOSTIC — stop hardcoding "batch-qa triage" into every review-nits-*.md (batch-qa is being retired for orchestrate/surface-questions); name no skill so the generator can't keep a retired concept alive
slug: gate-nit-triage-text-skill-agnostic
blockedBy: []
covers: []
---

## What to build

The Gate-2 review-nits generator (`buildReviewNitsObservation` /
`writeReviewNitsObservation` in `src/integration-core.ts`) hardcodes the phrase
**"durable home for batch-qa triage (promote-to-slice / keep / delete)"** into the
BODY of every `work/observations/review-nits-<slug>-<date>.md` file it emits on an
APPROVE-with-nits, plus two doc-comments naming batch-qa. But **batch-qa is being
retired** (the `advance-loop` PRD refocuses it into `surface-questions`;
`orchestrate` is the human-in-the-loop triage path now). So the gate is a LIVE
drift-generator: every slice build that produces nits mints a fresh on-disk
reference to a concept being removed (this happened ~6× in one session).

Fix: make the triage text **skill-AGNOSTIC** — name NO specific skill. The nit file
should say something like "their durable home for triage: promote-to-slice / keep /
delete" (the ACTION is stable; the skill that performs it is not). This way the
generator cannot keep `batch-qa` (or any future-renamed triage skill) alive, and it
needs no edit when batch-qa → surface-questions/orchestrate completes.

Scope:
- Update the EMITTED body text (the hardcoded line) + the two doc-comments in
  `integration-core.ts` to drop "batch-qa" and name no skill (agnostic action-only
  wording).
- Update the generator's test to assert the new agnostic wording (and that it does
  NOT mention batch-qa).
- Do **NOT** rewrite historical provenance markers elsewhere (e.g. PRD
  slice-readiness notes that say "(resolved 2026-06-06, batch-qa)") — those are
  HONEST RECORDS of how a past decision was made and must stay; this slice only
  stops the gate MINTING NEW references.
- Do **NOT** delete the `batch-qa` skill or `work/done/batch-qa.md` — the skill's
  retirement/migration is owned by the `advance-loop` PRD (batch-qa →
  surface-questions, US #32). This slice is the narrow generator fix so the
  retirement is not immediately undone by the next gate run.

## Acceptance criteria

- [ ] `buildReviewNitsObservation`'s emitted body no longer contains "batch-qa";
      it uses skill-agnostic, action-only triage wording (promote-to-slice / keep /
      delete) that names no skill.
- [ ] The two batch-qa doc-comments in `integration-core.ts` are updated to match
      (no "batch-qa triage" / "batch-qa triages it" phrasing).
- [ ] The generator's test asserts the new wording and that the output does NOT
      contain "batch-qa".
- [ ] Historical provenance markers (`(resolved …, batch-qa)`) elsewhere are
      UNCHANGED (this slice does not touch them).
- [ ] The `batch-qa` skill and `work/done/batch-qa.md` are NOT deleted (that is the
      advance-loop migration's job).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately. (Self-contained: one generator function + its two
  doc-comments + its test in `src/integration-core.ts` / the gate-nits test.)

## Prompt

> Make the Gate-2 review-nits generator's triage text SKILL-AGNOSTIC. Today
> `buildReviewNitsObservation` (`src/integration-core.ts`) hardcodes "durable home
> for batch-qa triage (promote-to-slice / keep / delete)" into every emitted
> `work/observations/review-nits-<slug>-<date>.md`, plus two doc-comments naming
> batch-qa. batch-qa is being RETIRED (the `advance-loop` PRD refocuses it into
> `surface-questions`; `orchestrate` is the current triage path), so the gate keeps
> minting references to a dying concept on every slice build. See
> `work/observations/gate-hardcodes-batch-qa-triage-but-batch-qa-is-retired-for-orchestrate.md`.
>
> THE FIX: replace the hardcoded "batch-qa triage" wording with action-only,
> skill-agnostic text (e.g. "their durable home for triage — promote-to-slice / keep
> / delete") that names NO skill, in BOTH the emitted body and the two doc-comments.
> Update the generator's test to assert the new wording and the absence of
> "batch-qa". Naming no skill is deliberate: it survives whatever batch-qa becomes
> (the exact coupling that caused this — a generator hardcoding a sibling concept's
> name — is what we are removing).
>
> WHERE TO LOOK: `src/integration-core.ts` — `buildReviewNitsObservation` (the
> emitted-string builder, ~L908–934) + `writeReviewNitsObservation`'s doc-comment
> (~L872). The test is the gate-nits / review-nits-observation test (grep the test
> dir for the asserted body wording).
>
> SCOPE FENCE: do NOT rewrite historical provenance markers like "(resolved
> 2026-06-06, batch-qa)" in PRDs — those are honest history. Do NOT delete the
> `batch-qa` skill or `work/done/batch-qa.md` — that retirement is the advance-loop
> PRD's job (US #32, batch-qa → surface-questions). This is ONLY the generator fix.
>
> FIRST run the drift check: confirm the generator still emits "batch-qa triage". If
> it has already been made agnostic, route to `needs-attention/` with the
> discrepancy.
>
> "Done" = the gate's nit files name no triage skill (agnostic action-only wording),
> the doc-comments match, the test pins it, history is untouched, and `pnpm -r build
> && pnpm -r test && pnpm -r format:check` is green.

---

## Provenance

Promoted from `work/observations/gate-hardcodes-batch-qa-triage-but-batch-qa-is-retired-for-orchestrate.md`
(2026-06-08), noticed because the conductor kept echoing the gate's own
"batch-qa triage" text in Gate-3 approvals. Delete that observation once this slice
lands in `done/` AND the broader batch-qa→surface-questions migration (advance-loop
US #32) is tracked.
