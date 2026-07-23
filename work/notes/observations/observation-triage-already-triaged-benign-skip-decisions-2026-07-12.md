---
title: 'Decisions + family cross-reference for the observation-triage already-triaged benign-skip fix'
type: observation
status: spotted
spotted: 2026-07-12
needsAnswers: false
triaged: resolve
---

## What this records

Durable `## Decisions` + sibling cross-reference for the task `observation-triage-already-triaged-benign-skip-2026-06-22` (implemented 2026-07-12). This note is the linkable home for the load-bearing choices that task made, since the runner owns the done-move and there is no separate done record to carry a `## Decisions` block. Link this from the completion.

## Decisions

- **Provable-link mechanism = an explicit `promotedFrom: <observation-identity>` frontmatter back-reference stamped on the minted task/spec, NOT slug derivation.** `promoteObservation` (`triage-persist.ts`) stamps `promotedFrom: observation:<slug>` into every minted body; the create-CAS lost-race disambiguator (`advancing-lock.ts`) reads it back and treats a path-exists as terminal `already-exists-from-source` ONLY when that field equals the current `sourceItem`. Matching on the explicit field (not the slug) is what makes the check robust to an unrelated task sharing the slug or a slug PREFIX: a different `promotedFrom` (or none) stays the loud `lost` (exit 2). Alternative considered: slug-equality alone, rejected because an unrelated same-slug task would false-positive into a benign skip. What it touches: a NEW frontmatter field `promotedFrom` (distinct from `origin:` = how-born human/issue, `reviewOf:` = the review-nits back-pointer, and `spec:` = the parent-spec pointer); coherence-checked against CONTEXT.md + ADRs, no existing term is re-meant.

- **Case A vs case B is separated by a PRE-LOOP existence check, not a post-loop one.** The `already-triaged` benign skip (exit 0) fires ONLY when the target task already exists on `<arbiter>/main` with a matching `promotedFrom` BEFORE the contention loop begins (a prior run). A LIVE concurrent-create race (case B) has the winner's file appear DURING the loop, so its loser is absent at the pre-check and still funnels through the loop to the loud `lost` (exit 2). This deterministically preserves the existing same-NEW-task race semantics (the `createItemThroughCas` race tests: exactly one winner, one `lost` exit 2) while adding the terminal-by-existence skip. Alternative considered: disambiguating at the post-loop `lost` return, rejected because a same-observation concurrent-race loser would then read the winner's matching `promotedFrom` and silently flip to exit 0, re-meaning the documented CAS race contract and breaking the CAS-nonce serialisation tests. What it touches: the `createItemThroughCas` race contract shared by ALL new-item creators (task/spec/adr promotion), so it was deliberately kept behaviour-neutral for the no-`sourceItem` and live-race paths (zero behaviour change unless a caller opts in with `sourceItem`).

- **Exit-code / outcome shape = exit 0 + a distinct greppable outcome (`already-exists-from-source` at the CAS, `already-triaged` at the advance rung), matching the observation-identity slice's `vanished` benign-skip shape (exit 0), NOT a new tolerated non-zero code.** The advance-lifecycle matrix leg runs `dorfl advance ... --propose` directly (no `|| true` mask), so exit 0 is required for a green leg; `vanished` already established exit-0 benign skips for this exact CI-noise family, so this lands consistent with it. (The sibling stale-snapshot observation leaned toward a distinct tolerated NON-zero code; that lean predates the `vanished` exit-0 precedent the observation-identity slice actually shipped, which this task's scope point 3 explicitly says to reuse.)

## Sequencing vs discharge-by-deletion (honoured)

`observation-discharge-by-deletion-self-contained-promotion-and-prd-route` has landed. Once an observation is promoted it is `git rm`-ed in the SAME create commit, so a freshly-triaged observation is GONE and cannot re-fire. This fix therefore does NOT duplicate discharge-by-deletion's guarantee for the fresh path; it is the BACKSTOP for the residual cases discharge-by-deletion does not cover: (1) LEGACY / pre-discharge observations still resting in the inbox whose task was minted before discharge-by-deletion landed, and (2) the observation surviving intact after a promote whose task already exists (idempotent re-tick). The belt-and-braces gather-time exclusion was deliberately NOT added: discharge-by-deletion already drains the fresh path, so a pool-exclusion would only touch the same legacy residue the CAS-site check already handles, at the cost of an extra per-observation arbiter read in `buildLifecyclePools`.

## Family cross-reference

Same CI-noise family (a benign, by-design lifecycle-leg condition rendered as red CI) as:
- `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` (stale-snapshot leg; promoted to `task:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21`).
- `observation-identity-is-its-filename-not-a-foreign-slug` (the `vanished` benign-skip outcome shape this fix reuses).

## Provenance / refs

- `packages/dorfl/src/advancing-lock.ts` — `sourceItem` option + the pre-loop `alreadyMintedFromSource` case-A check + the `already-exists-from-source` outcome.
- `packages/dorfl/src/triage-persist.ts` — `promoteObservation` stamps `promotedFrom:` + maps `already-triaged`.
- `packages/dorfl/src/frontmatter.ts` — `readFrontmatterField` (generic scalar reader).
- `packages/dorfl/src/advance.ts` — the `already-triaged` `AdvanceOutcome` mapping.
</content>
</invoke>
