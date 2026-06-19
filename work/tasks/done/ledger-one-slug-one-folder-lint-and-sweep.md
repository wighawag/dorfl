---
title: status/scan LINT the ledger + a gc-style SWEEP that REPORTS (never auto-deletes) any slug present in more than one work/ status folder
slug: ledger-one-slug-one-folder-lint-and-sweep
prd: ledger-integrity
blockedBy: [atomic-done-move-one-slug-one-folder]
covers: [3]
---

## What to build

Make a corrupt ledger DISCOVERABLE: `status`/`scan` LINTS the `work/` ledger and WARNS (never silently) when any slug appears in more than one `work/` status folder (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`), and a `gc`-style SWEEP DETECTS + REPORTS the same — never auto-deleting without confirmation (defect 1's belt-and-suspenders, story 3).

This is the read-side complement to the atomic done-move slice: even with the transition hardened, a PRE-EXISTING orphan (from a past or hand-built merge, like the one hand-cleaned in `279b542`) must be FINDABLE so a drive isn't misled into "recovering" an already-done slice. The lint surfaces it; it does not fix it (a human confirms the cleanup).

The lint is a derived check over folder residence (consistent with WORK-CONTRACT.md "no shared index — derive lists on demand"): list each status folder, find any slug appearing in more than one, and report it loudly. The `gc` sweep is the on-demand variant that reports the duplicate set and the candidate canonical folder, leaving the deletion to a confirmed human action (never silent auto-delete).

This slice is file-orthogonal to the atomic-done-move slice (it lives in the scan/status/gc surfaces, not the integration core), but it CONSUMES the same one-slug-one-folder concept, so build it after the invariant is defined.

## Acceptance criteria

- [ ] `status` and/or `scan` LINT the ledger: when any slug resides in more than one `work/` status folder, they WARN loudly (a clear, listed report of the slug and the folders it appears in) — never silently pass.
- [ ] A `gc`-style SWEEP detects + REPORTS every slug present in multiple `work/` status folders on demand, and NEVER auto-deletes without explicit confirmation (it reports the duplicate + the candidate canonical folder; the human confirms).
- [ ] A clean ledger (every slug in exactly one folder) reports no duplicates (no false positives; capture buckets `ideas`/`observations`/`findings` are NOT status folders and are excluded).
- [ ] Tests construct a fixture ledger with a slug deliberately present in two status folders and assert the lint/sweep surfaces it (with the folders named); plus a clean-ledger fixture asserts a clean report.
- [ ] Tests cover the new behaviour in the repo's existing vitest style; no shared/global location touched outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `atomic-done-move-one-slug-one-folder` — the invariant this lint surfaces is DEFINED there; build the enforcement first so the lint reports against the same canonical notion (and to avoid churn on a moving definition). It is logically independent code-wise but serialized to keep the one-slug-one-folder semantics single-sourced.

## Prompt

> Add a one-slug-one-folder LINT to agent-runner's `status`/`scan` and a `gc`-style SWEEP that REPORTS (never auto-deletes) any slug present in more than one `work/` status folder. This is story 3 of the ledger-integrity PRD (`work/prd-sliced/ledger-integrity.md`, possibly in `work/slicing/` until this slicing lands) — the read-side belt-and-suspenders so a PRE-EXISTING orphan (e.g. the one hand-cleaned in `279b542`, PR #86) is DISCOVERABLE and a drive isn't misled into "recovering" an already-done slice.
>
> FIRST, check this slice against current reality (it is a launch snapshot — WORK-CONTRACT.md "Drift is a needs-attention signal"). Confirm the `atomic-done-move-one-slug-one-folder` slice (its blocker) has landed and DEFINES the one-slug-one-folder invariant; report against that same canonical notion. Read `packages/agent-runner/src/scan.ts`, `packages/agent-runner/src/status.ts`, and `packages/agent-runner/src/gc.ts` for the existing surfaces. If a dependency landed differently, reconcile or route to `needs-attention/`.
>
> DOMAIN: `work/` IS the ledger — STATUS is the FOLDER (`backlog`/`in-progress`/`needs-attention`/`done`/`out-of-scope`); ONE file per item, no index (derive lists on demand by listing folders). Capture buckets (`ideas`/`observations`/`findings`) are NOT status folders — EXCLUDE them. A slug in two status folders is the corruption to surface.
>
> BUILD: (1) `status`/`scan` warn loudly (listing the slug + the folders it appears in) when a slug is in more than one status folder; (2) a `gc`-style sweep reports the duplicate set + the candidate canonical folder on demand and NEVER auto-deletes without confirmation. Do NOT silently fix — surface for a human to confirm.
>
> TEST (TDD, vitest, house style — temp fixture ledgers, real shared dirs untouched): a fixture with a slug in two status folders surfaces it with folders named; a clean fixture reports clean (no false positives, buckets excluded).
>
> "Done" = the lint in `status`/`scan` + the reporting `gc` sweep + tests for both the duplicate and clean cases + the gate green.
