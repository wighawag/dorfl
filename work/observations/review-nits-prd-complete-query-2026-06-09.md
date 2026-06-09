---
title: review-gate non-blocking nits for 'prd-complete-query' (Gate 2 approve)
date: 2026-06-09
status: open
slug: prd-complete-query
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'prd-complete-query' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the result-shape decision: the query returns a rich PrdCompleteResult { complete: boolean; slices: PrdSlice[] } rather than the bare boolean the acceptance criteria literally specified ("returns whether the PRD is COMPLETE"). Is exposing the matched slice set (with file/slug/folder, sorted by slug) the intended public surface for the downstream runner-in-ci close-JOB, or should the query return just the boolean verdict? (packages/agent-runner/src/prd-complete.ts — PrdCompleteResult and isPrdComplete return; the slices array is additive over the slice's stated 'whether complete' contract. Additive, well-documented, and cheap to reverse, so non-blocking — but it is an in-scope, self-made API decision affecting what the future CI consumer sees.)
- Confirm the deliberate non-use of the existing ledgerRead seam is the intended layering. The acceptance criterion mentions reusing the 'folder/ledger read,' but the slice body forbids reaching for the ledger seam and the code instead does a direct four-folder residence scan keyed on parsed prd:. This is correct (the seam exposes no prd field, no per-slice folder, and does not even read in-progress), but it does duplicate the listMarkdown/slug-resolution idiom already present in ledger-read.ts and slicing.ts. (Compare prd-complete.ts's listMarkdown + slug fallback (fm.slug ?? basename(file,'.md')) against ledger-read.ts's listMarkdown/slugForFile. The duplication is of a trivial, already-thrice-repeated idiom rather than a load-bearing concept, and routing through the claim-state seam would have been the WRONG layer per the slice's own disambiguation — so this is a coherence note, not a defect.)
