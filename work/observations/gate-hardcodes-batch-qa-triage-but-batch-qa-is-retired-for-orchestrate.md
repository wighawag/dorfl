---
title: The Gate-2 review-nits generator hardcodes "durable home for batch-qa triage" into EVERY review-nits-*.md it writes — but batch-qa is scheduled for deletion and orchestrate is the new triage path; the gate is a live drift-generator minting stale references on every slice build
date: 2026-06-08
status: open
---

## The signal

The conductor kept writing "recorded for batch-qa triage" in its Gate-3 approvals this session — because it was ECHOING the gate's own generated text. The maintainer flagged it: **batch-qa is scheduled to be DELETED; `orchestrate` is the new way to triage observations/nits.**

Source of the stale phrase: `writeReviewNitsObservation` / `buildReviewNitsObservation` in `src/integration-core.ts` hardcodes, into EVERY `work/observations/review-nits-<slug>-<date>.md` file the gate emits on an APPROVE with non-blocking nits:

- doc-comment (~line 872): _"so batch-qa triages it like any observation."_
- doc-comment (~line 908): _"these are review-gate nits for batch-qa triage"_
- the EMITTED file body (~line 932): _"is their durable home for **batch-qa triage** (promote-to-slice / keep / delete)."_

So every slice build that produces nits writes a fresh on-disk reference to a concept being retired. This session alone minted ~6 such files (one per slice), each pointing future readers at the wrong triage path.

## Why it matters

This is not dead docs sitting still — the gate is an ACTIVE generator. Even after `skills/batch-qa/` and `work/done/batch-qa.md` are removed, every new `do slice:`/`do prd:` run will RE-INTRODUCE the stale phrase into a fresh observation file. A reader (or `orchestrate` itself) triaging nits is told to hand them to a skill that no longer exists, instead of being pointed at `orchestrate`'s triage.

It also illustrates a general hazard: **a generator that hardcodes the name of a sibling concept couples their lifecycles** — retiring the concept requires editing the generator, or the generator keeps the dead name alive.

## Fix direction

1. **Update the gate's nit-generator** (`integration-core.ts` `buildReviewNitsObservation` + its two doc-comments) to point at the CURRENT triage path. Replace "batch-qa triage" with `orchestrate`'s triage language (e.g. "their durable home for triage — `orchestrate` surveys and routes them (promote-to-slice / keep / delete)"), or make it triage-path-AGNOSTIC ("for triage: promote-to-slice / keep / delete") so it does not name a specific skill that can be retired out from under it. Agnostic is the more robust choice given this exact coupling just bit us.
2. **Sweep the existing references** when batch-qa is removed: the already-written `review-nits-*.md` files + other docs/skills/PRDs naming batch-qa (grep shows `skills/batch-qa/SKILL.md`, `work/done/review-skill.md`, `work/done/review-nits-observation.md`, several `work/prd/*.md`, and ~all `work/observations/review-nits-*.md`). Coordinate with the batch-qa→orchestrate migration so the gate stops minting new ones FIRST (else the sweep re-dirties).
3. **Sequencing:** fix the generator (#1) BEFORE/with deleting batch-qa, so the retirement is not immediately undone by the next gate run.

## Related

- `review-nits-observation.md` (`work/done/`) — the slice that introduced the gate's nit-file generator (where the batch-qa phrasing originated).
- `run-thrown-core-error-labeled-agent-failed.md` — also ends with "batch-qa fodder", another live reference to the retiring concept.
- The `orchestrate` skill — the intended replacement triage path the gate's generated text should point at (or stay agnostic of).
