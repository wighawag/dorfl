---
title: review-gate non-blocking nits for 'work-contract-sanction-deletion-on-apply-discharge' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: work-contract-sanction-deletion-on-apply-discharge
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'work-contract-sanction-deletion-on-apply-discharge' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The new bullet pairs `dropped`/`duplicate` as if `duplicate` were a standalone disposition, but the established disposition vocabulary (SURFACE-PROTOCOL.md L47/L58, the verbatim engine constants: `promote-task | promote-adr | keep | delete | dropped | needs-attention`) has NO `duplicate` disposition. Per WORK-CONTRACT L31/L67 `duplicate` is a REASON recorded in the item body under the generic `dropped` terminal, not a disposition. Reading the new bullet, a contributor could think `duplicate` is a first-class disposition. Consider phrasing it as `dropped` (with `duplicate`/other reason) to stay coherent with the single disposition vocabulary. Same slip exists in the prd's Resolved decision 4, so it is worth pinning here so it does not propagate.
  (skills/setup/protocol/WORK-CONTRACT.md:70 vs SURFACE-PROTOCOL.md:58)
- The bullet references `promote-prd` as an existing disposition, but `promote-prd` is NOT yet in the SURFACE-PROTOCOL disposition set (still `promote-task | promote-adr | keep | delete | dropped | needs-attention`). It is the deliverable of the sibling task `promote-prd-disposition-and-triage-local-cas-prd-writer` (US #4), which is not yet merged per the git log. So WORK-CONTRACT now forward-references a disposition the engine/SURFACE-PROTOCOL does not yet define. Within this prd's coherent end-state this resolves once that sibling lands, but if these tasks land out of order the contract briefly names a disposition that does not exist. Non-blocking (intended end-state), just flagging the ordering coupling.
  (skills/setup/protocol/WORK-CONTRACT.md:70 references `promote-prd`; SURFACE-PROTOCOL.md:58 disposition set does not include it yet)
- The bullet quotes 'the "never auto-delete a signal; a human deletes" clause' as if that exact wording exists verbatim in the contract, but that precise phrase appears ONLY in this new bullet (and in the originating observation/task). The CONCEPT exists at L72 ('a note annotated "resolved" and kept is a contradiction... discharge it by deleting it') and in the bucket table ('leaves by deletion'), but no verbatim 'never auto-delete a signal; a human deletes' sentence is elsewhere in the doc. The quoting is self-coherent shorthand used consistently across this prd's artifacts, so impact is minimal, but a future reader searching for the quoted clause will not find it as written. Optional: anchor the reference to the actual L72 wording.
  (skills/setup/protocol/WORK-CONTRACT.md:70 quotes a clause whose verbatim text is not present elsewhere in WORK-CONTRACT.md)
