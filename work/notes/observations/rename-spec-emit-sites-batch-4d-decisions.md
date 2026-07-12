---
title: spec→spec batch 4d (rename-spec-namespace-emit-sites-and-local-unions) — build decisions worth ratifying
date: 2026-07-10
needsAnswers: true
---

Durable record of the judgement calls made while flipping the PRODUCER side of the `spec` namespace onto `spec` (task `rename-spec-namespace-emit-sites-and-local-unions`). Recorded here (append-only capture bucket) so the reviewer + human can ratify or reverse; linked from the done record. None are load-bearing/hard-to-reverse enough to STOP on, but each would surprise a later task/reviewer if buried in code.

## 1. Sidecar FILE-path fallback: new pure `sidecarPathCandidates(identity)` (option a, centralized)

The task offered (a) reader reads `spec-<slug>.md` then falls back to `prd-<slug>.md`, or (b) alias `typeForNamespace`'s `spec` case to also probe the spec file. I chose (a) but centralized: a new PURE `sidecarPathCandidates(identity)` in `sidecar.ts` returns `[canonical, ...legacyFallbacks]` (`spec` type → `[spec-<slug>.md, prd-<slug>.md]`, every other type → single canonical path). The two lifecycle-gather readers (`readSidecarInPlace` sync-fs, `readSidecarMirror` async-git-show) iterate the candidates and take the FIRST that exists. Why not (b): `typeForNamespace`/`sidecarPathFor` are PURE (no fs); baking a probe into them would push fs into a pure resolver or silently return a wrong-but-existing path. A candidate LIST keeps the resolver pure and works for BOTH the fs reader and the git-show reader. Exported from the index next to `sidecarPathFor`. Touches: `sidecar.ts` (new fn + export), `index.ts`, `lifecycle-gather.ts` (both readers). This is the DATA-territory alias the migration command removes (it renames `prd-<slug>.md → spec-<slug>.md` on disk); NOT the `SidecarType` `'spec'` type member.

Note: only the lifecycle-gather readers were switched to the candidate list, because that is the CRITICAL green-in-isolation path the task calls out (a `spec:`-emitted needsAnswers item whose sidecar is still `prd-<slug>.md`). The other `sidecarPathFor` readers (apply-decide, apply-persist, sidecar-apply, advance, drop-source, merge-question-surfacer, mint-adr) act on items whose identity is already resolved from the on-disk item and are not fed a freshly `spec:`-emitted identity in this batch; leaving them on `sidecarPathFor` keeps the change minimal. If a later batch routes a `spec:` identity into those readers before the migration converts data, they will need the same candidate list.

## 2. `needs-attention.ts:938` promote lock identity flipped `spec:${slug}` → `spec:${slug}` (NOT enumerated by the observation, but REQUIRED for correctness)

`promoteFromPrePrd` acquires a per-item lock under `spec:${slug}` for the apply×promote mutual-exclusion invariant. Batch 3/4 already moved the tasking/apply path (`tasking.ts`) to lock under `spec:${slug}`. A `spec:${slug}` lock and a `spec:${slug}` lock key DIFFERENT refs (`prd-<slug>` vs `spec-<slug>` via `lockEntryFor`), so leaving promote on `prd:` would SILENTLY break the guarantee (promote and apply on the same spec would no longer be mutually exclusive). This is a `spec:${slug}` identity EMIT, so it is in this batch's class-3 spirit even though the diagnosis note did not list line 938. Flipped it (+ updated the coupled `promote-takes-per-item-advancing-lock.test.ts` competing-hold + release-check identities to `spec:`). Touches: promote path × tasking/apply path lock identity.

## 3. `promote` CLI verb (`cli.ts:3509-3525`): accept BOTH `spec:` and legacy `prd:` INPUT, PRODUCE `'spec'`

The `promote <item>` handler mapped `parsed.explicit === 'spec' ? 'spec' : 'task'`. The task says leave the `prd:` CLI-INPUT acceptance (contract task removes it) but flip the produced VALUE. So `parsed.explicit === 'spec' || === 'spec'` now both map to the internal `'spec'` value (dispatch + user-facing messages speak `spec`); bare/`task:` stays `task`. This ADDS `spec:` input acceptance beside the still-accepted legacy `prd:` input. Touches: the `promote` verb's input surface + its console messages (user-visible: "Promoted spec '<slug>'" and the no-arg list prints `spec:<slug>`).

## 4. `DecisionOutcome` `'spec'` → `'spec'` REPLACED (not additive), incl. the apply-decider PROMPT token

`decision-engine.ts` `DecisionOutcome`, its `parseDecisionVerdict` validator, `apply-decide.ts` `APPLY_ALLOWED_OUTCOMES` + the agent PROMPT's outcome token, `advance.ts:1211` dispatch check, and `triage-persist.ts` `artifact` union + `=== 'spec'` branches form ONE producer chain (agent verdict → mint route). I REPLACED `'spec'` with `'spec'` (not additive) because the verdict is a FRESH per-call LLM emission — nothing `'spec'`-valued is persisted on disk — so no on-disk alias is needed, and a lingering `'spec'` union member would be a leak the contract task flags. KEPT the verdict CONTENT field names `prdSlug`/`prdTitle`/`prdBody` (analogous to the out-of-scope `prd:` frontmatter FIELD; renaming them would ripple into every `verdict.prdBody` read in advance.ts for no in-scope reason). So the prompt now reads `{"outcome":"spec","prdSlug":"…"}` — the outcome VALUE is `spec`, the content channel keys stay `spec*`.

## 5. LEFT UNTOUCHED (out of the three enumerated classes)

- `advance-classify.ts` `ANALYSE_RUNG_FOR_TYPE` `prd: 'task-spec'`: the `spec` KEY is a `SidecarType` type-member key (untouched member); the `'task-spec'` VALUE is a `TickRungKind` (a rung-name enum), NOT a namespace value / CLI token / local union. The inline comment already defers "renames the rung" to a migrate batch, but renaming a `TickRungKind` ripples into every rung consumer/dispatch/template/test and is a SEPARATE concept from this task's three classes; the diagnosis note did not list it. Left for the rung-rename / contract owner.
- `advance.ts:444-445` `sidecarTypeFor` `namespace === 'spec' ? 'spec'`: a CONSUMER mapping a `SlugNamespace` input to its `SidecarType` (both members untouched); keeps a legacy `prd:` INPUT arg resolving. Not an emit.
- `sidecar.ts:202` `typeForNamespace` `explicit === 'spec' → 'spec'`, and the `slug-namespace.ts` `prd:` resolver branches + error-message `spec:${slug}` disambiguation hints: all CONSUMER/INPUT-acceptance of the still-accepted `prd:` prefix (contract task removes). The `spec:${slug}` in those error strings is an input-suggestion, not a producer emit.
- intake.ts: NOT in this task's file list; batch 3 already made intake's canonical produced outcome `'spec'` with `'spec'` as an accepted alias. Left as-is.

## Applied answers 2026-07-12

### q1: Should the sidecarPathCandidates fallback (spec-<slug>.md → prd-<slug>.md) be extended to the other readers still on sidecarPathFor (apply-decide, apply-persist, sidecar-apply, advance, drop-source, merge-question-surfacer, mint-adr), or does the plan rely on the prd-to-spec migration command converting data before any spec: identity reaches them?

Leave as-is. Rely on the prd-to-spec migration command converting data before any spec: identity fans out to the other seven readers (apply-decide, apply-persist, sidecar-apply, advance, drop-source, merge-question-surfacer, mint-adr). Extend the sidecarPathCandidates fallback to them only if a concrete break appears; adding it pre-emptively would spread the transitional fallback wider than needed.

### q2: Is the TickRungKind rung-name 'task-spec' (advance-classify.ts) intentionally kept, or does it need its own rung-rename task before the rename-spec contract closes?

Keep 'task-spec' as-is. It is an internal TickRungKind enum value (advance-classify.ts and consumers), not a namespace or CLI token, so it does not leak the retired vocabulary to users or on-disk identity. Do not rename it in this rename-spec arc; a rung-rename would ripple into every rung consumer/dispatch/template/test for no external benefit.
