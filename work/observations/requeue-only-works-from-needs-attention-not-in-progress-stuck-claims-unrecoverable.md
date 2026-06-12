---
title: `requeue` only recovers a slice from `needs-attention/` — a slice STUCK in `in-progress/` (claimed but never surfaced, e.g. the push failed before the needs-attention route) cannot be requeued, so the conductor's standard recovery move errors and the item is stranded
date: 2026-06-12
status: open
---

## The signal

This drive's prior map said "requeue review-comment-fallback". The agent tried and `requeue` ERRORED, because the slice was in `work/in-progress/`, NOT `work/needs-attention/`. `requeue` is hardcoded to the `needs-attention/ → backlog/` transition (it is even in the CLI help: "Requeue a needs-attention item to the backlog"). A slice that is stuck in `in-progress/` on the arbiter — claimed, work possibly done, but NEVER surfaced to needs-attention — is outside requeue's domain, so the conductor's standard recovery verb does not apply and the item is stranded until a human hand-moves it.

## How a slice gets STUCK in in-progress (not needs-attention)

The claim puts `work/in-progress/<slug>.md` on the arbiter main. Surfacing to `needs-attention/` happens only if the run reaches the needs-attention route. Several paths skip it and leave the item in `in-progress/`:

- a push/integration failure that errors out BEFORE the surface routine (the stale-lease-strand class — partly addressed by #97, but any un-surfaced abort leaves in-progress);
- an interrupted/killed run (the abort footgun) that never surfaced;
- a requeue note appended to the in-progress file directly (the prior session did this — the body carried a "return to backlog" note while the file stayed in `in-progress/`).

In all of these the item sits in `in-progress/` on the arbiter, and `requeue` refuses it.

## Why it matters

- The conductor's documented recovery is "requeue (keep+continue) + re-`do`". When the stuck item is in `in-progress/`, that path is unavailable — a gap the conductor must work around by hand (the agent had to investigate + hand-resolve), which is exactly the manual-checkout-touching the isolated model is meant to avoid.
- It is asymmetric: `needs-attention/` is recoverable, `in-progress/` (an equally-stuck, arguably MORE-stuck state) is not.

## The fix

Make `requeue` (or a sibling) accept an `in-progress/` source too — `requeue <slug>` should resolve the slug's ACTUAL current status folder on the arbiter (`needs-attention/` OR `in-progress/`) and move it to `backlog/` via the same tree-less CAS, keep+continue by default. A stuck in-progress claim is recovered identically to a needs-attention one (the kept `work/<slug>` branch, if any, continues from its tip; `--reset` discards). At minimum: when `requeue` is called on a slug that is in `in-progress/` (not needs-attention), do NOT bare-error "not found" — detect it and either handle it or say "the slug is in in-progress/, not needs-attention; <how to recover an in-progress claim>". This composes with the tree-less requeue (#89): the move is already arbiter-native, it just needs to recognise `in-progress/` as a valid source.

## Where

`src/cli.ts` `requeue` action + the requeue transition (`needs-attention.ts`'s return-to-backlog / `ledgerWrite.applyTransition`) — currently `needs-attention/`-source-only. Cross-ref: `requeue-and-recovery-assume-local-checkout-no-remote-arbiter-form.md` (the fetch-from-arbiter-first recovery model), `pr-merge-leaves-orphaned-in-progress-when-claim-landed-on-main.md` (the related in-progress-ledger-integrity gap), and `finish-already-committed-branch.md` (the stranded-already-committed recovery, a sibling lifecycle).
