---
type: observation
status: spotted
spotted: 2026-07-12
needsAnswers: false
---

## What was seen

Three `advance-lifecycle` CI legs (2026-07-12) failed on observations that are DURABLE RECORDS, not triage candidates:

- `obs:migrate-batch-left-resolveClosingIssue-prd-read-to-brief-sweep-task-2026-07-09` and `obs:observation-triage-already-triaged-benign-skip-decisions-2026-07-12` both hit the LIMBO error: `observation ... is in a limbo: no triaged: frontmatter marker AND no answered question sidecar ... but the surfacer has nothing to ask` (exit 1).
- `obs:prd-to-spec-4f-cli-flags-clean-break-full-internal-purge-and-the-c-audit-single-lens-pattern-2026-07-10` hit the sibling agent-failure error: `the surface-questions agent produced no usable emit (surface agent produced no parseable {questions} result)` (exit 1).

A FOURTH leg failed the same tick while the human watched: `obs:review-nits-advance-surface-limbo-observation-loudly-instead-of-silent-no-op-2026-07-07` hit the SAME agent-failure error as leg #3 (`no parseable {questions} result`). CRUCIALLY it is NOT the same root cause: that file is a GENUINE triage candidate (a review-nits record whose body carries real open questions: "Is this the right cli surface?", "worth flagging for ratification"), so it SHOULD surface questions — the agent merely FLAKED (emitted no extractable `{questions:[]}` JSON). It must NOT be stamped `triaged: keep` (that would silently discard un-triaged nits). See the TWO-FAILURE-MODES split below.

None of the three RECORD legs is an engine bug. The engine reads ONLY the `triaged:` frontmatter marker (`ledger-read.ts`: any non-empty value = SETTLED, drops out of the triage pool; absent/empty = UNTRIAGED, re-enumerated every tick) to decide triage-pool membership. All three files had NO `triaged:` marker, so they were swept into the pool, and the surfacer correctly found NOTHING TO ASK (there is no open promote/keep/drop judgement on a settled decisions/rationale record). The limbo detector (`advance.ts:detectObservationLimbo`, task `advance-surface-limbo-observation-loudly-instead-of-silent-no-op`) then fires LOUDLY by design; the third file threw inside the agent gate before persist, hitting the `catch` in `surfaceRung` instead.

## The systemic gap

`work/notes/observations/` conflates TWO distinct kinds of note:

1. **Triage candidates** — a freshly-captured signal awaiting a human promote/keep/duplicate/drop decision. These SHOULD be in the triage pool.
2. **Durable records** — decisions notes (a completed task's `## Decisions` home), migration/re-scope rationale, family cross-references. These are NOT candidates; there is no open judgement to surface, and they exist to be LINKED, not dispositioned.

The engine cannot tell the two apart: an unmarked record is indistinguishable from a fresh candidate, because pool membership keys ONLY on the absence of `triaged:`. Scope of the problem at capture time: of 86 files in `work/notes/observations/`, 63 have NO `triaged:` marker and 17 have NO frontmatter at all — so any of those that is actually a record (not a candidate) is a latent CI-leg crash, re-fired every tick until a human stamps it.

This also interacts with `capture-signal` / the observation-authoring convention: nothing enforces that a captured note declares whether it is a candidate or a record, and the two most recent record-style notes (a `## Decisions` completion home and a re-scope rationale) were authored WITHOUT a `triaged:` marker, so they crashed the very next lifecycle tick.

## Immediate mitigation (done this session)

Stamped `triaged: keep` on the three offending records (adding minimal `type: observation` / `status` frontmatter to the two that had none / partial), so they drop out of the triage pool. A non-empty `triaged:` value is exactly the "settled, drops out" mechanism (`ledger-read.ts`), and matches how ~23 existing observations already rest. This stops the three CI errors on the next tick but does NOT fix the systemic gap (any future record authored without a marker re-introduces it).

## TWO DISTINCT failure modes (do not conflate)

The `no parseable {questions} result` error has TWO different root causes, needing OPPOSITE fixes:

- **Mode 1 — a RECORD in the triage pool (no open judgement).** Legs #1, #2, #3 (and the pure decision-record in the pre-existing sibling note). The honest surface result is `{questions: []}`; the file should never have been a candidate. FIX: drop it out of the pool (`triaged:` marker / a records bucket / a record type) — the systemic gap this note is about.
- **Mode 2 — a GENUINE candidate the surface agent FLAKED on.** The `review-nits-advance-surface-limbo-...` leg. The file HAS open questions; the agent should have emitted them but produced no extractable JSON. FIX: agent/skill reliability (always emit a bare `{"questions": []}` when nothing to ask; confine prose to `note`) and/or skip the model round-trip for decision-record shapes. This is ALREADY captured, untriaged, in `surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10.md` (both fix angles named there) — that note should be PROMOTED, not left latent. Marking a Mode-2 file `triaged: keep` is a DATA-LOSS bug (discards real un-triaged nits), so the mitigation below was applied ONLY to the three Mode-1 records, NOT to the review-nits candidate.

Latent scope of Mode 2 specifically: 9 `review-nits-*` records currently carry `reviewOf:` but NO `triaged:` marker — each is a genuine triage candidate that will crash a lifecycle leg the moment the agent flakes on it (or, if it does surface, produce a sidecar). They are NOT records to settle; they await real triage.

## Options to weigh (NOT decided here)

1. **A distinct "record, never a candidate" marker/type.** e.g. a `type: record` (or `triaged: record`) the enumeration treats as never-a-candidate, distinct from `triaged: keep` (which historically meant "a human triaged this and chose keep"). Cleanest semantically; touches the ledger-read pool predicate + the authoring convention.
2. **A separate bucket the triage pool does not scan.** Move decisions/rationale records to `work/notes/records/` (or fold them into a done-record channel) so `work/notes/observations/` holds ONLY triage candidates. Touches `capture-signal` + the completion/decisions-home convention + any reader that resolves record links.
3. **Make the surfacer's clean "nothing to ask" auto-settle instead of erroring.** When the surface-questions agent legitimately finds no open judgement, auto-stamp `triaged: keep` rather than emitting the limbo error. Simplest, but it FIGHTS the deliberate limbo-loudness (the loud error exists precisely to catch a human triage decision mis-recorded in the BODY where the engine can't see it), so it risks silently settling a genuinely-untriaged candidate whose surfacer merely under-produced. Needs care: distinguish "no judgement exists" from "agent under-produced" before auto-settling.
4. **Enforce the marker at capture time.** Have `capture-signal` (and/or a `verify`/lint check) require every `work/notes/observations/*.md` to declare candidate-vs-record, so a record can never enter the pool unmarked. Belt-and-braces on top of 1/2.

The judgement call is which of 1–4 (or a combination) to build. 3 alone is risky; 1 or 2 plus 4 is the likely durable shape, but that is a design decision for a human.

## Provenance / refs

- Failing legs: advance-lifecycle run 2026-07-12 (three Mode-1 record `obs:` legs named above, plus the Mode-2 `review-nits-advance-surface-limbo-...` leg).
- Pre-existing sibling (Mode 2, untriaged — should be promoted): `work/notes/observations/surface-questions-agent-still-emits-no-parseable-questions-on-decision-record-obs-2026-07-10.md`.
- `packages/dorfl/src/ledger-read.ts` (~L146-182, L514, L846: `triaged:` = pool membership; non-empty drops out).
- `packages/dorfl/src/advance.ts` (`detectObservationLimbo` ~L718; the `surfaceRung` agent-gate `catch` ~L654; the persist-`nothing` limbo branch ~L668).
- `packages/dorfl/src/lifecycle-pools.ts` (~L154: the SETTLED marker drops the observation out of the TRIAGE pool).
- The three mitigated records (now `triaged: keep`): `migrate-batch-left-resolveClosingIssue-prd-read-to-brief-sweep-task-2026-07-09.md`, `observation-triage-already-triaged-benign-skip-decisions-2026-07-12.md`, `prd-to-spec-4f-cli-flags-clean-break-full-internal-purge-and-the-c-audit-single-lens-pattern-2026-07-10.md`.

## Note on scope

The mitigation is a data fix (uncontested, wanted regardless). The systemic fix (options 1–4) is a real design fork about how the observations bucket distinguishes triage candidates from durable records, captured for a human to decide.
