---
title: prd→spec identity layer (frontmatter field + SlugNamespace + config key + intake type) needs EXPAND-FIRST, not per-batch hard-swap — the original chain violated its own §3a
date: 2026-07-09
---

## What happened

The `do` agent building `rename-spec-frontmatter-field-and-slug-namespace` (batch 2 of the prd→spec cutover) STOPPED and routed to needs-attention with a correct diagnosis: a HARD in-place swap of `Frontmatter.prd → Frontmatter.spec` and `SlugNamespace 'prd' → 'spec'` cannot pass the gate IN ISOLATION, because those identifiers are NON-INDIRECTED and read directly at ~28 downstream call sites (`fm.prd` in prompt.ts/tasking.ts/do.ts/run.ts/prd-complete.ts; the `'prd'` namespace literal across ~18 modules) owned by the DOWNSTREAM batches 3/4. Renaming the field/literal breaks `pnpm -r build` immediately (`TS2339: Property 'prd' does not exist`).

## Why it matters (the tasking lesson)

The original batch chain was a LINEAR sequence of hard-swap `rename-*` batches each demanding an individually-green gate. That violates the very discipline the parent spec backported into `TASKING-PROTOCOL.md` §3a: a pervasive NON-indirected identifier rename is a wide refactor that stays green per-batch ONLY via expand→migrate→contract (add the new form beside the old FIRST) or a shared-integration fan-in. **Batch 1 (`work-layout.ts`) survived only by ACCIDENT** — folder identity is indirected behind KEYS, so renaming the key doesn't break call sites. The frontmatter field, the `SlugNamespace` literal, the `prdsLandIn` config key, and the `IntakeArtifactType` are NOT indirected, so the same trick doesn't save batches 2/3/4.

Notably: the `review` skill was RUN on this task set and did NOT catch it. The review checked graph coherence, claim-vs-reality, and destination coverage, but not "can each hard-swap batch actually COMPILE in isolation". That is a review-lens gap worth remembering: for a wide-refactor task chain, add a lens — "is each batch's rename indirected (safe alone) or non-indirected (needs expand-first)?"

## The fix (decided with the human: Option 1, expand-first)

Inserted `expand-spec-frontmatter-and-namespace-aliases` before batch 2: it ADDS `spec` beside `prd` across the whole non-indirected identity surface (frontmatter key read-both, `SlugNamespace` gains `'spec'`, `specsLandIn` config alias, `'spec'` intake type) so nothing breaks. Batches 2/3/4 became ADDITIVE-MIGRATE (move their own call sites onto `spec`, keep the `prd` alias). The existing `contract-spec-hard-cutover-rejection-and-leak-scan` now also REMOVES every `prd` alias (the contract of expand→migrate→contract) before running the bi-word rejection + leak scan.

Chain now: preisolate → work-layout → **expand** → frontmatter/namespace-migrate → config/intake-migrate → remaining-src-migrate → protocol/skill → contract(remove-aliases+reject+scan) → build-command → run-on-dorfl.

## Provenance

The agent's STOP diagnosis (empirically disproven premise, with the exact TS errors + the ~28 call sites enumerated), verified against the live tree @ commit ca6230e5 (grep of `fm.prd`/`task.prd` reads + `'prd'` namespace literal across modules).
