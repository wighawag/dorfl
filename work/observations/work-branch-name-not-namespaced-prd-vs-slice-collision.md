---
title: the work BRANCH ref is `work/<slug>` un-namespaced on BOTH the slice path and the slicing path — a PRD `<slug>` and a slice `<slug>` sharing a slug collide on the same `work/<slug>` branch on the arbiter (the one identity NOT type-encoded, unlike the sidecar + advancing/ lock)
type: observation
status: spotted
spotted: 2026-06-09
---

## The signal

After `do prd:advance-loop` ran, the work branch the runner created was **`work/advance-loop`** — and the maintainer noticed it could COLLIDE with a SLICE of the same name: "I thought we discussed that branch name also need to be namespaced." A build of a slice named `advance-loop` would ALSO use branch `work/advance-loop`, so a PRD-slicing run and a slice-build run on the same slug would contend on the SAME arbiter branch ref.

## What the code does now (verified)

The work-branch ref is hardcoded `work/${slug}` EVERYWHERE — it is NOT type-encoded:

- **Slicing path:** `src/slicing.ts` `onboardSlicingBranch` → `const branch = `work/${slug}`` (slicing.ts:666; doc-comment slicing.ts:652, 61–63 "the agent's slicing runs on a`work/<slug>` branch").
- **Build path:** `src/do.ts` — in-place onboarding cuts `work/<slug>` (do.ts:58/66/562), the needs-attention RECOVERABLE push uses `params.branch ?? `work/${slug}`` (do.ts:917, do.ts:1024), the continue-detection
  reads `${arbiter}/work/${slug}`(do.ts:626, do.ts:578/618), and`integrator.ts`/`github.ts`/`continue-branch.ts`all speak`work/<slug>`.

So the SLUG alone keys the branch, with NO `prd-`/`slice-` (or `:`-derived) prefix.

## Why it matters

This is the ONE identity in the system that is NOT namespaced — and the inconsistency is now sharp because the rest of advance-loop's design IS:

- The advance **sidecar** is type-encoded `work/questions/<type>-<slug>.md` (slice `advance-sidecar-contract`, US #9) precisely so "same-slug items across namespaces never collide."
- The advance **`advancing/` lock** entries are type-encoded `<type>-<slug>` (slice `advancing-lock-borrow`, US #20) so "a slice, a PRD, and an observation sharing a slug never collide on the CAS ref."
- The existing **`work/slicing/<slug>.md`** lock vs **`work/in-progress/<slug>.md`** build claim ARE distinct because they live in DIFFERENT FOLDERS — but they collapse back onto the SAME `work/<slug>` BRANCH for the actual work. The folder-level identity is namespaced-by-folder; the branch-level identity is not.

Concrete failure modes if a PRD and a slice share a slug:

- Two arbiter `work/<slug>` branch tips racing (a slicing propose-PR branch and a build propose-PR branch) — the second push/PR clobbers or non-fast-forwards the first.
- `requeue`-continue's continue-detection (`${arbiter}/work/${slug}` ahead of main) cannot tell a kept SLICING wip from a kept BUILD wip — it could continue the wrong one.
- Cross-machine recovery points at an ambiguous branch.

It is LATENT today (slug collisions across PRD/slice are rare and nothing forces them), but advance-loop makes same-slug-across-namespaces a first-class, EXPECTED situation (the whole `<type>-<slug>` identity scheme exists for it), so the branch should be brought into the same scheme rather than left as the lone exception.

## Fix direction (shape, not a decision)

Namespace the work branch by item TYPE, consistent with the sidecar + lock identity scheme — e.g. `work/slice/<slug>` and `work/prd/<slug>` (or `work/<type>-<slug>`, matching the lock entry name). This touches every `work/${slug}` branch construction + read above (slicing onboard, do onboard, needs-attention push, continue-detection, integrator, github, continue-branch) and their tests — a cross-cutting rename. Open sub-questions for the eventual slice:

- Spelling: `work/<type>/<slug>` (folder-ish, readable) vs `work/<type>-<slug>` (matches the lock entry + sidecar filename exactly). Prefer matching the existing `<type>-<slug>` identity scheme for one consistent rule.
- Migration: any IN-FLIGHT `work/<slug>` branches on arbiters at rollout — likely none in practice, but the continue-detection must not silently fail to find a pre-rename kept branch. A clean breaking change (precedent: `remove-sliced-marker-step-b`, `rename-reviewpr-to-review`) with a short recognise-old-name window, or just a documented one-time cutover.
- Does this belong INSIDE advance-loop (it shares the `<type>-<slug>` identity decision) or as its own small precursor/standalone slice? It is logically the SAME "namespace the identity" decision the sidecar + lock slices make, so the cleanest home is either (a) a shared identity helper those advance slices already introduce, reused by the branch ref, or (b) a standalone branch-namespacing slice the advance slices then build on. Decide when triaging — do NOT let the branch ref invent a SECOND `<type>-<slug>` derivation separate from the resolver/sidecar one.

## Update (2026-06-10): the latent collision FIRED in practice — intake vs slice on the same checkout

This is NO LONGER only latent. Running `intake 40 --merge` then `do slice:deploy-send-value-to-payable-constructor` in the SAME in-place human checkout hit the collision directly: `intake` (`src/intake.ts:1528` `const branch = `work/${slug}``) left a `work/deploy-send-value-to-payable-constructor` branch behind, and the subsequent `do slice:` onboarding (`src/isolation.ts:204` same `work/${slug}`) found that same-named stale branch and reused it (slice still in `work/backlog/` on it) — the build landed on the wrong base and the done-move errored "nothing to complete". See the sibling observation `do-onboarding-reuses-stale-work-branch-instead-of-claim-commit.md` for the reflog-level trace.

So `intake` is a THIRD producer of the un-namespaced `work/<slug>` branch (alongside the slice-build and PRD-slicing paths) — the collision surface is `intake` × `slice` × `prd`, not just `prd` × `slice`. Verified the ref is STILL `work/${slug}` un-namespaced across 12+ files (intake.ts:1528, isolation.ts:204, do.ts ×6, slicing.ts:705, complete.ts:382, start.ts, work-on.ts, needs-attention.ts, run.ts, integration-core.ts, workspace.ts, gc.ts, prompt.ts) while `slug-namespace.ts` (`resolveSlug`, `SlugNamespace = 'slice' | 'prd'`) already exists but is NOT consulted for the branch ref. The fix below (namespace the branch via the resolver) directly removes this firing collision; the stale-reuse hardening in the sibling observation is the defensive backstop on top.

## Related

- `do-onboarding-reuses-stale-work-branch-instead-of-claim-commit.md` — the downstream symptom (in-place onboarding reusing the stale same-named branch + not branching from the exact claim commit) this collision triggered.
- `work/prd/advance-loop.md` — the `<type>-<slug>` identity scheme; slices `advance-sidecar-contract` (US #9), `advancing-lock-borrow` (US #20) in `work/backlog/`. The branch ref is the missing fourth identity that should follow the same rule (sidecar filename, lock entry, AND branch ref all derive from ONE namespaced-identity source — the `slug-namespace.ts` resolver).
- `src/slug-namespace.ts` (`resolveSlug`) — the single source of truth for the namespaced identity the branch ref should derive from, not re-invent.
