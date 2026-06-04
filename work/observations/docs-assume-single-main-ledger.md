---
title: Docs hard-wire the claim CAS to main; re-point at the seam when the ledger-transition refactor lands
type: observation
status: spotted
spotted: 2026-06-04
---

# Docs describe the claim CAS as a direct `main`-write (pre ledger-transition seam)

> **Spotted, not yet actioned.** The accepted ADR
> `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted, 2026-06-04)
> decided to introduce a **ledger-transition seam** \u2014 a pure, behaviour-identical
> refactor that routes the three `work/` transitions (claim / complete /
> needs-attention) through a read seam + a write seam, with the current
> behaviour as the only strategy. **No mode, no config, nothing observable
> changes.**
>
> Several docs describe the claim/complete transitions as *directly* writing
> `main` (which is still TRUE \u2014 that is what the one strategy does). They are not
> wrong. But when the seam refactor lands, the prose should mention that these
> transitions now route *through* the seam (so a future strategy could differ),
> rather than implying the `main`-write is hard-wired. Light touch \u2014 this is a
> "add a sentence / cross-reference" pass, not a rewrite.

## Concrete references to touch (when the seam slice is built)

- **`CONTEXT.md`**
  - L74 `arbiter` ("the single git remote whose `main` ref serialises claims")
    and L76\u201377 `claim (CAS)` ("pushing a micro-commit to the arbiter's `main`
    with `--force-with-lease`") \u2014 still accurate; add a note that this is the
    *current (only) strategy* behind the ledger-transition seam, cross-ref the ADR.

- **`docs/adr/execution-substrate-decisions.md`**
  - The claim-command / `scan` descriptions against `main` (e.g. \u00a79 claim parity
    with `claim.sh`, the needs-attention \u00a7 on `scan`/`status`) describe the same
    single strategy \u2014 add a cross-reference to the ledger-transition-seam ADR so
    the substrate ADR isn't read as asserting the `main`-write can never be
    indirected. (NB: the "offline" hits at L130/L145 are about the `--bare`
    *arbiter* being offline-capable, NOT about `scan`; leave them alone. And
    `scan` genuinely STAYS offline \u2014 the seam does not change that.)

## Why an observation, not a work item

This is a documentation-consistency signal that becomes actionable **only when the
ledger-transition seam refactor is actually implemented** \u2014 the prose is correct
until then. So it rides WITH that slice (the `ledger-transition-seam` PRD).
Captured here so it is not lost; delete this note once that slice has added the
seam cross-references above.
