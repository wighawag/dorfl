---
title: review-gate non-blocking nits for 'work-layout-keys-and-folder-union-names-to-new-vocabulary' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: work-layout-keys-and-folder-union-names-to-new-vocabulary
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'work-layout-keys-and-folder-union-names-to-new-vocabulary' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the ~79 old-vocabulary fixture call sites across the test suite were left speaking the OLD status words (`'backlog'`, `'prd'`, `'prd-sliced'`, …) and translated to the new keys via a new `FIXTURE_WORD_TO_KEY` alias map in test/helpers/gitRepo.ts, rather than swept to the new vocabulary. Is keeping the old words alive (now via an explicit alias) in the test layer the intended end state, given the slice's premise was to eliminate stale vocabulary?
  (fixtureFolderRel was already designed as the single seam for exactly this kind of value flip, so the one-map change is minimal-churn and keeps tests green with unchanged values — a reasonable scope-containment call. The trade-off is that the old `slice`/`prd` words now persist permanently in the test fixtures and a translation map, which is the same 'stale vocabulary' the slice set out to remove (just confined to the test layer). The slice listed 'the tests' only for renamed symbols/keys, not a fixture-word sweep, so this is within the letter of scope; flagging for the human to confirm the test layer is allowed to keep speaking the old words long-term vs. wanting a follow-up sweep.)
- Ratify: the landing-config vocabulary (`SlicesLandIn = 'pre-backlog'|'backlog'`, `PrdsLandIn = 'pre-prd'|'prd'`, and the `--slices-land-in`/`--prds-land-in` CLI flag values) was deliberately left on the old spelling and NOT renamed. Confirm this is intended — i.e. the CLI flag values are a separate user-facing concept from the `WORK_FOLDER_NAME` keys and must stay stable.
  (These literals are NOT WORK_FOLDER_NAME keys: `landingToSide` (slicing.ts) maps them onto the lifecycle-generic `'staging'|'pool'` side enum which then indexes the renamed placement slots, so they never reach `workFolderPath` as a key. The slice explicitly mandated 'NO user-facing surface change', and `--slices-land-in pre-backlog` is a documented CLI flag, so renaming would have been a breaking surface change and out of scope. This is the correct boundary; the finding exists only so a human ratifies that this shared spelling between an internal key-vocabulary and a user-facing config-vocabulary is acknowledged and acceptable (a possible future coherence cleanup, not a defect here).)
