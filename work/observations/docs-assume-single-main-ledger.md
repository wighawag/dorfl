---
title: Docs still describe a single-main claim ledger + unconditional offline scan (pre two-mode ADR)
type: observation
status: spotted
spotted: 2026-06-04
---

# Docs assume the OLD single-`main` claim model (re-scope when the ledger seam lands)

> **Spotted, not yet actioned.** The accepted ADR
> `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted, 2026-06-04)
> decided agent-runner has **two ledger modes** behind a read/write seam
> (**M = main-writable, the default**, ≈ today; **P = protected-main**, deferred).
> Several existing docs still describe the system as if `main` is *unconditionally*
> the claim ledger and `scan` is *unconditionally* offline. Those statements are
> now true only of **mode M**. They are not wrong today (M is the default and the
> only built mode) — but they will drift the moment the seam / mode P is built.
> Recording so the implementation slice re-scopes them rather than leaving a
> contradicting invariant in the source-of-truth docs.

## Concrete references to re-scope (when the seam slice is built)

- **`CONTEXT.md`**
  - L74 `arbiter` — "the single git remote whose **`main` ref serialises claims**"
    → true in M; in P the claim serialises off `main` (substrate deferred).
  - L76–77 `claim (CAS)` — "pushing a micro-commit to the arbiter's **`main`** with
    `--force-with-lease`" → that is the **mode-M** primitive; P's primitive differs
    (and is part of the write seam).
  - The **Invariants** / house section asserting status=folder-on-main and the
    general framing should gain a "in mode M; mode P reads intermediates off the
    work branches" qualifier once P exists.

- **`work/ideas/needs-attention-surfacing.md`** — already partly updated (the
  "Subsumed by…" section now points at the accepted ADR), BUT the earlier body
  still says **"`scan` stays a fast, OFFLINE claim-ledger view"** as if
  unconditional. That sentence needs the "offline **in mode M**" qualifier (it is
  network-bound in P). Left as-is for now; fix alongside the seam.

- **`docs/adr/execution-substrate-decisions.md`** — describes the claim CAS / the
  `scan` reader against `main` throughout (e.g. §9 the claim-command parity with
  `claim.sh`, the needs-attention § on `scan`/`status` reading folders). These
  describe **mode M** behaviour. When the seam lands, add a cross-reference to the
  two-mode ADR so the substrate ADR isn't read as asserting a single global model.
  (NB: the "offline" hits at L130/L145 there are about the `--bare` *arbiter* being
  offline-capable, NOT about `scan` — those are unrelated and fine.)

## Why an observation, not a work item

This is a documentation-consistency signal that becomes actionable **only when the
ledger seam / mode P is actually implemented** — re-scoping the prose before the
code exists would describe behaviour that isn't there yet. So it rides WITH that
future slice. Captured here (append-only bucket) so it is not lost; delete this
note when the seam slice has re-scoped the references above.
