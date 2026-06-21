---
title: "Three coupled fixes from the incomplete lock+rename migration: backlog/pool vocabulary drift, surface questions on staging (safely), and the apply x promote concurrency hole"
slug: staging-surface-and-apply-promote-safety
needsAnswers: false
---

> Launch snapshot, records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) plus the code; remaining work: `work/tasks/todo/` tasks. Governing context: `work/briefs/tasked/folder-taxonomy-reorg-and-rename.md` (the STEP-B rename, still partly deferred), `work/briefs/ready/ledger-status-per-item-lock-refs.md` (the per-item two-axis lock), `work/briefs/ready/staging-pool-position-gate-and-trust-model.md` (the staging gate + `slicesLandIn`/`prdsLandIn`). Found 2026-06-21 while testing the advance apply step: a sliced brief's `needsAnswers` task never surfaced a question because it sat in staging, which uncovered all three issues below.

## Problem Statement

Three interlocking defects, all symptoms of ONE root cause: the per-item-lock + folder-rename migration was only half-completed. The new folder LAYOUT landed (`tasks/backlog` = staging, `tasks/todo` = the agent pool), but the ledger/lifecycle/config CODE and the position-transition verb (`promote`) were not fully brought across.

**F1: `backlog` means two different things (vocabulary drift).** In the new layout (`work-layout.ts`): `tasks/backlog` = STAGING (untrusted, awaiting promotion), `tasks/todo` = the agent POOL. But the ledger-read / lifecycle-gather / config code still uses `backlog` to mean THE POOL (`ledger-read.ts` "Read `work/backlog/*.md`", `lifecycle-gather.ts` iterates `state.backlog` as the surface/eligible set, `config.ts` `slicesLandIn: 'pre-backlog' | 'backlog'` where `'backlog'` means "the eligible pool"). So one word names both staging and pool across the codebase. This is the deferred STEP-B of `folder-taxonomy-reorg-and-rename`, and it is now causing live confusion (a reader cannot tell which `backlog` is meant).

**F2: surfacing (read-only, safe) is gated like building (trust-gated), so questions do not surface on staging.** A sliced task is born in staging (`tasks/backlog/`) by the trust model (slicer output is untrusted, awaits human promotion). That trust gate is correct for BUILDING (do not auto-build untrusted output). But it is ALSO suppressing question-SURFACING, which is a different polarity: surfacing emits a question, writes nothing to `main`, touches only the item's per-item lock, and cannot collide except with another writer for the SAME item. Surfacing is the cheapest, safest lifecycle action. Worse, the current order is backwards: you must promote BLIND, then get asked. You WANT the questions answered BEFORE promotion, so you promote an already-clarified task. (Observed: PR #188's keystone task carries `needsAnswers:true` in `tasks/backlog/` and no question was ever minted.)

**F3: apply and promote can interleave and corrupt the item (concurrency hole).** `apply` (the advance rung that consumes an answered sidecar, clears `needsAnswers`, rewrites the item) takes the item file path as INPUT and "rewrites THIS file" (`apply-persist.ts` ItemPath doc). It runs under the item's `advancing` per-item lock. `promote` is a TREE-LESS position CAS (`backlog -> todo`) modelled on `requeue`/`claim` that, as built, does NOT appear to take or respect the item's `advancing` lock. So apply and promote lock DIFFERENT things and can interleave on the same item:
- **Stale-path write:** apply captured `tasks/backlog/<slug>.md`; a concurrent promote moved it to `tasks/todo/<slug>.md`; apply commits a rewrite of the now-moved path (ghost file at the old path, or a failed commit).
- **Lost update / split brain:** apply rewrites the item body+frontmatter while promote `git mv`s the folder, racing on `main`.

The sidecar is already IDENTITY-KEYED and folder-agnostic (`apply-persist.ts`: "sidecar path is derived from the identity, NOT from this path"); the ITEM path is not. That asymmetry is the bug.

## Solution

Finish the migration on these three fronts. They are ONE brief because F2's safety DEPENDS on F3 (surfacing-then-applying on staging is only safe once apply and promote cannot corrupt each other), and all three are the same incomplete rename+lock work.

**F1 (correctness): finish the `backlog -> pool` vocabulary so one word means one thing.** Bring the ledger-read / lifecycle-gather / config / scan code onto the new layout's nouns (`tasks/todo` = pool, `tasks/backlog` = staging), so `state.backlog` and the doc-comments stop meaning "the pool" while the layout means "staging". Mirror the same fix into `work/protocol/` if any contract doc carries the old noun. This is the deferred STEP-B; scope it to what these fixes need (do not boil the ocean, but leave no `backlog`-means-pool reader behind in the touched paths).

**F2 (behaviour, with an opt-out): surface questions on staging too, defaulting ON.** Separate the SURFACE polarity from the BUILD polarity in the lifecycle pool: the surface pool should include `needsAnswers` items in STAGING, not only the pool, so questions are minted before promotion. Gate it with a new config key `surfaceStaging` (camelCase, the gate family naming), resolved `flag > env > per-repo > global > default`, DEFAULT TRUE (staging IS inspected for questions). A user who wants the old behaviour (do not inspect staging) sets `surfaceStaging: false`. BUILD/claim eligibility is UNCHANGED (still pool-only, still trust-gated): only surfacing crosses into staging.

**F3 (correctness): make apply folder-agnostic AND mutually exclusive with promote.** Two changes, both needed:
- **Apply resolves the item's CURRENT folder at write-time, not capture-time** (mirror the sidecar's identity-keyed, folder-agnostic resolution): apply looks up `(umbrella, slug) -> current folder` against `main` at the moment it writes, never trusting a path captured earlier. This kills the stale-path write.
- **Promote respects the per-item lock** (the two-axis lock's whole point is mutual exclusion of implement/slice/advance on one item): a promote must not slip under an in-flight `advancing` apply, and an apply must not start while a promote holds the item. Bring the position transition under the same per-item lock so the two serialise by construction. This kills the lost-update race.

Either F3 change alone is incomplete: folder-agnostic apply still lets two writers race on `main`; lock-only still risks a stale path if the lock is released between resolve and write. Both, together, close the hole.

## User Stories

1. As a reader of the code/contract, I want `backlog` to mean exactly ONE thing (and the pool to be `todo`), so I never have to guess whether a given `backlog` reference means staging or the eligible pool.
2. As a maintainer with a sliced-but-unpromoted task that carries open questions, I want those questions SURFACED while the task is still in staging, so I can answer them and then promote an already-clarified task (not promote blind and get asked after).
3. As a maintainer, I want `surfaceStaging` to default TRUE (staging is inspected for questions) but be settable to false, so I can opt out of staging-surfacing if I prefer the pool-only behaviour.
4. As a maintainer, I want BUILD/claim eligibility to stay pool-only and trust-gated even with `surfaceStaging:true`, so opening up surfacing never opens up auto-building untrusted slicer output.
5. As the apply rung, I want to resolve the item's CURRENT folder at write-time (identity-keyed, like the sidecar), so a concurrent promote that moved the item cannot make apply write a stale/ghost path.
6. As the runner, I want promote and apply to be MUTUALLY EXCLUSIVE on the same item via the per-item lock, so a position move and an answer-apply can never interleave and split-brain the item on `main`.
7. As a maintainer testing the advance loop, I want surface -> answer -> apply to work end-to-end on a freshly sliced task without a manual promote first, so the question-answer lifecycle is exercisable as designed.

### Autonomy notes (the two gate axes)

Omit `humanOnly`. Set `needsAnswers: true`: there are real open questions below (F1 rename scope, F3 lock-vs-folder-agnostic ordering, whether promote should TAKE the lock or REFUSE-while-held). Clear once answered. This brief touches concurrency-critical code (the per-item lock, apply, promote), so it wants a careful slicing pass.

## Implementation Decisions

- **F1**: rename the pool noun to `todo` across ledger-read / lifecycle-gather / scan / config doc-comments + the `slicesLandIn`/`prdsLandIn` value space if it still says `'backlog'` for "pool". Keep `tasks/backlog` = staging. Coordinate with the tasked `folder-taxonomy-reorg-and-rename` brief (this may BE its STEP-B, or a scoped slice of it). Mirror into `work/protocol/` if a contract doc carries the old noun.
- **F2**: new `surfaceStaging` config (default true), resolved like the gate family. In `lifecycle-gather.ts` / `buildLifecyclePools`, the SURFACE candidate set draws from staging + pool (gated by `surfaceStaging`); APPLY stays always-on; BUILD/claim eligibility unchanged. The `scan --json` `lifecycle.surface[]` pool reflects it so the CI matrix enumerates staging surface legs.
- **F3a**: apply resolves the item file by identity at write-time (a `git mv`-aware `(umbrella, slug) -> current path` lookup against the arbiter `main`), not from a captured `ItemPath`. Mirror the sidecar's folder-agnostic resolution.
- **F3b**: promote acquires/respects the item's per-item lock (the `advancing` axis), so promote and apply serialise. Decide the exact discipline (promote TAKES the lock for its CAS window, or promote REFUSES while an `advance` lock is held) in slicing (open question).
- Tests use throwaway git repos (the existing claim-cas / slicing-lock test pattern).

## Testing Decisions

- F1: a test asserting no touched reader treats `backlog` as the pool (the pool is `todo`); the scan/lifecycle pools read the correct folders.
- F2: with `surfaceStaging:true` (default), a `needsAnswers` task in `tasks/backlog/` appears in `scan`'s `lifecycle.surface[]` and a surface tick mints its sidecar; with `surfaceStaging:false` it does not. BUILD eligibility unaffected in both.
- F3a: an apply whose captured path is stale (item moved `backlog -> todo` after capture) writes the CURRENT path, not the stale one (throwaway-repo test simulating the concurrent move).
- F3b: a promote and an apply on the SAME item cannot both commit (the lock serialises them); the loser exits clean, no split-brain on `main`.
- End-to-end: a freshly sliced `needsAnswers` task surfaces -> is answered -> applies, with NO manual promote (the F2+F3 happy path).
- Do NOT regress existing claim-cas / slicing-lock / advance apply tests.

## Out of Scope

- The broader `folder-taxonomy-reorg-and-rename` STEP-B beyond the readers these fixes touch (coordinate, do not expand into a full-tree rename here unless slicing decides this IS that step).
- Changing the trust model itself (untrusted slicer output still births in staging; `slicesLandIn` still governs that). F2 only opens SURFACING into staging, not building.
- The slicing-PR empty-body observation (separate: `work/notes/observations/slicing-pr-has-empty-body-no-summary-comment.md`).

## Open questions (clear `needsAnswers` when resolved)

1. **F1 scope.** Is this brief's F1 the whole STEP-B rename, or a scoped slice of `folder-taxonomy-reorg-and-rename` limited to the readers F2/F3 touch? (Bias: scope to what F2/F3 need; reference the tasked brief so the rest of STEP-B is not orphaned.)
2. **F3b lock discipline.** Should promote TAKE the per-item lock for its CAS window (briefly held), or REFUSE while an `advance` lock is held (and tell the human to retry)? Take-the-lock serialises silently; refuse-while-held is louder but simpler. Decide which.
3. **F3 ordering vs F2.** Confirm F3 lands BEFORE or WITH F2 in the slice order (surfacing on staging is only safe once apply x promote is fixed), so no slice ships staging-surfacing on top of the unfixed concurrency hole.
4. **Does `prdsLandIn` / brief staging have the SAME F2/F3 issues?** Briefs also stage (`briefs/proposed` -> `briefs/ready`) and also carry `needsAnswers`. Confirm whether the surface-on-staging + apply-vs-promote fixes must cover briefs symmetrically, or briefs are out of scope for this pass.

## Applied answers 2026-06-21

### q1: F1 scope: is this brief's F1 the WHOLE STEP-B rename of `folder-taxonomy-reorg-and-rename`, or a scoped slice limited to the readers F2/F3 actually touch (ledger-read, lifecycle-gather, scan, config doc-comments, `slicesLandIn`/`prdsLandIn` value space)?

Scoped slice. F1 here fixes ONLY the `backlog`-means-pool readers that F2/F3 actually touch (ledger-read, lifecycle-gather, scan, the `config.ts` doc-comments + the `slicesLandIn`/`prdsLandIn` value space where `'backlog'` still means "pool"), renaming the pool noun to `todo` and keeping `tasks/backlog` = staging. Do NOT pull the whole STEP-B mechanical rename in here. Reference the tasked brief `folder-taxonomy-reorg-and-rename` so the remainder is not orphaned, AND update that brief to record that this brief consumed its surface-pool-reader slice, so the two cannot silently overlap or re-do each other's work.

### q2: F3b lock discipline: should `promote` TAKE the per-item `advancing` lock for its CAS window (briefly held, serialises silently with apply), or REFUSE while an `advance` lock is held (louder, simpler, human retries)?

Promote TAKES the per-item `advancing` lock for its CAS window. The decisive reason is architectural, not UX: the per-item two-axis lock (`ledger-status-per-item-lock-refs`) exists precisely so that implement/slice/advance on one item are mutually exclusive BY CONSTRUCTION, atomic, not advisory. "Refuse while an advance lock is held" is a check-then-act against the lock, which reintroduces exactly the check-then-act race the lock was built to eliminate, and makes promote advisory where every other transition is atomic. So take-the-lock is the only option consistent with WHY the lock exists. Promote acquires the item lock (action axis: a position/promote transition, or reuse `advance` if a distinct action value is over-engineering), does its tree-less position CAS, releases. An apply already holding the lock makes promote lose cleanly, and vice versa.

### q3: Slice ordering: must F3 (apply folder-agnostic + promote-respects-lock) land STRICTLY BEFORE F2 (surface on staging), or can they land TOGETHER in one slice — and is shipping F2 before F3 ruled out entirely?

F3 STRICTLY BEFORE F2, as a SEPARATE slice (not the earlier half of one combined slice). Reason: F3 is a correctness fix that is valuable on its own and fixes a concurrency hole that exists TODAY, independent of F2; it should ship and be verified as its own demoable tracer-bullet slice. F2 is a behaviour change that only becomes SAFE once F3 has landed, so F2's slice declares `blockedBy: [<F3 slice>]` and its tests assert the F3 invariants are green as a precondition. Shipping F2 before F3 is ruled out entirely. Combining them into one slice is rejected because the behaviour change (F2) could mask an F3 regression, and because two independently-verifiable correctness/behaviour concerns deserve two slices. (F1 the vocabulary fix is a prefactor that lands first or alongside F3, since both touch the same readers.)

### q4: Do briefs (`briefs/proposed` -> `briefs/ready`, with `needsAnswers`) need the SAME surface-on-staging + apply-vs-promote fixes symmetrically in this brief, or are briefs explicitly out of scope for this pass?

Do NOT blanket-defer briefs; SPLIT by concern, because we have DIRECT evidence briefs share at least F2 (this very `needsAnswers` brief is being surfaced via the brief surface pool right now, and `prdsLandIn` mirrors `slicesLandIn` exactly).

- **F1 (vocabulary):** covers briefs inherently (the pool-noun fix touches the shared readers). In scope.
- **F2 (surface on staging):** IN SCOPE for briefs symmetrically. The surface pool already enumerates `namespace: 'brief'` legs, so `surfaceStaging` must cover the brief staging folder (`briefs/proposed/`) too, not only `tasks/backlog/`. A `needsAnswers` brief in staging should surface its questions before promotion, exactly like a task.
- **F3 (apply x promote):** the PROMOTE-respects-the-lock half covers briefs too (briefs are promoted `proposed -> ready` via the same position-CAS verb, so the lock fix must apply to the brief promote path). The APPLY-folder-agnostic half is task/brief-symmetric where briefs carry `needsAnswers` and get an apply, so include it for briefs as well; only any genuinely task-only apply specifics (if found during slicing) are scoped out, and the slicer should call them out explicitly rather than blanket-excluding briefs.

Net: briefs are in scope across F1/F2/F3; the slicer only carves out a brief-specific case if it finds one, and names it.
