---
title: review-gate non-blocking nits for 'adr-land-primitive-rebase-reverify-advance' (Gate 2 approve)
date: 2026-06-26
status: open
reviewOf: adr-land-primitive-rebase-reverify-advance
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'adr-land-primitive-rebase-reverify-advance' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: ADR filename uses the slug-only house style (no NNNN- prefix), deviating from ADR-FORMAT.md's sequential-numbering template, matching the existing docs/adr/ files.
  (docs/adr/land-primitive-rebase-reverify-advance.md vs work/protocol/ADR-FORMAT.md which prescribes 0001-slug.md. Recorded in the ADR's 'In-scope decisions' block.)
- Ratify: slug shortened from the prd's working title land-is-rebase-reverify-advance-one-primitive-two-frontends to land-primitive-rebase-reverify-advance (the task-declared slug).
  (Recorded in the ADR's in-scope decisions; full framing kept in the title and §3.)
- Cross-link target drift: the ADR points the WORK-CONTRACT.md / CLAIM-PROTOCOL.md invariant line at itself, but those protocol docs do not yet contain that line — it lives in a sibling task. Worth a forward-reference note so a reader today is not confused.
  (§Consequences and §Cross-references both phrase the invariant line as already pointing here; the protocol-doc edit is a separate ready task (protocol-land-time-reverify-invariant).)
