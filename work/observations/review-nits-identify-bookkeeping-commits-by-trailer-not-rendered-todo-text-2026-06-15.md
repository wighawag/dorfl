---
title: review-gate non-blocking nits for 'identify-bookkeeping-commits-by-trailer-not-rendered-todo-text' (Gate 2 approve)
date: 2026-06-15
status: open
reviewOf: identify-bookkeeping-commits-by-trailer-not-rendered-todo-text
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'identify-bookkeeping-commits-by-trailer-not-rendered-todo-text' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the raw-`%B`-body-scan trailer detection over `git interpret-trailers --parse` / `%(trailers:…)`. The implementer chose to scan the raw body with a whole-line regex because the tree-less CAS (`ledger-write.ts stampNonce`) appends a `CAS-Nonce` trailer in its own block, and git's trailer parser only recognises the last contiguous block — so `%(trailers:…)` returns empty for `Agent-Runner-Bookkeeping` on every tree-less-published commit. Is the raw-body scan the accepted long-term mechanism (vs., say, fixing the producer to keep both trailers in one contiguous block)?
  (drop-bookkeeping-rebase.ts `bodyHasBookkeepingTrailer`; reason verified against ledger-write.ts line ~539 `stampNonce` appending `\n\n${CAS_NONCE_TRAILER}: ${nonce}`. This is a non-obvious, load-bearing in-scope decision driven by a cross-module interaction; correct as implemented but the human should ratify it as the intended approach.)
- Ratify keeping the legacy un-trailered fallback ON (`LEGACY_UNTRAILERED_FALLBACK = true`), i.e. still dropping a slug-anchored route-to-needs-attention commit that has no trailer (matched via real `%s` subject, never the rendered todo). The slice recommended this default because live pre-existing kept branches on the arbiter predate the trailer; confirm the intended retirement path for this fallback (when can it flip to false?).
  (drop-bookkeeping-rebase.ts `LEGACY_UNTRAILERED_FALLBACK` + `computeBookkeepingDropSet`. Matches the slice's recommended default and is tested; this is the explicit legacy/in-flight decision the slice asked to be recorded.)
- The code comment references a `## Decisions` note 'in the done record' that does not actually exist (the done slice file has no Decisions block and the squashed commit message is a bare one-liner). The decision IS captured in-code via the named constant + comment. Should a `## Decisions` note be added to the done record / PR description so the comment's pointer is honoured and the legacy-fallback rationale is discoverable outside the source?
  (drop-bookkeeping-rebase.ts line ~73 says 'See the `## Decisions` note in the done record'; `grep '## Decisions'` finds only the slice's own acceptance-criteria text, not an actual recorded note. Recording-completeness nit, not a defect — the slice permitted 'a `## Decisions` note in the done record/PR' and the runner squashed the message.)
- The done commit folds in unrelated sibling-ledger transitions (`work/advancing/slice-claim-cas-spinner.md` deleted; `work/needs-attention/onboard-and-reset-reconcile-mirror-to-arbiter.md` → `work/backlog/…`) reconciled by the integration rebase. Confirm this is expected runner-owned ledger churn and not accidental scope bleed from another slice's state.
  (Commit 23644d3 numstat shows the move/delete of two ledger files unrelated to the trailer change; the commit subject names it 'reconcile sibling-ledger rebase'. No source/test impact; flagged only so the human is not surprised by non-slice files in the diff.)
