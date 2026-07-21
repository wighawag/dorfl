---
title: Project-setup RECIPES — a curated library of native CI-provisioning snippets setup/install-ci offers (agnostic core, helpful when it recognises a stack)
slug: setup-install-ci-project-setup-recipes
humanOnly: true
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks.

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
-->

## Open questions

1. **Which recipes ship in the first cut?** Proposed: the two we have concrete, proven
   demand for — **Node+pnpm** (the rocketh case: `pnpm/action-setup` + `setup-node` cache +
   `pnpm install --frozen-lockfile` + the local-`main` fixup) and **Node+npm** (`npm ci`).
   Then one non-JS to prove the shape generalises — **Go** (`actions/setup-go`) and/or
   **Rust** (`dtolnay/rust-toolchain`). CONFIRM the starting set (the ADR says "2-3 first;
   each preset carries a version axis + an opinion + maintenance").
2. **Where does a recipe read its VERSION from (to pin reproducibly, not hardcode a stale
   version)?** Proposed: read the repo where an unambiguous source exists —
   `packageManager` field / `.tool-versions` / `engines.node` (Node), `go.mod` (Go),
   `rust-toolchain.toml` (Rust) — and fall back to a recipe default only when absent.
   CONFIRM the per-recipe version-source precedence + the fallback-default policy.
3. **How does the human SELECT a recipe — a menu at `install-ci` time, a `setup` A3b-linked
   offer, or both?** Proposed: `setup` A3b already DETECTS the stack from a lockfile to
   propose `prepare`; extend that same detection to also OFFER the matching CI recipe
   (recorded as `projectSetup.<provider>` for a later `install-ci`), AND expose a recipe
   picker in the `install-ci` wizard. CONFIRM whether v1 does the setup-offer, the
   install-ci-picker, or both.
4. **Where do the recipe snippets LIVE + how are they kept fresh?** Proposed: a
   provider-namespaced recipe asset set inside the package (each recipe = the provider's
   native snippet + a small version-source descriptor), owned like the protocol docs.
   CONFIRM the storage shape (data files vs code) and that a stale recipe is a
   documentation-grade maintenance item, not a correctness gate.
5. **Detection→offer boundary (the A3 line):** dorfl may DETECT a likely stack and OFFER
   the recipe, but must the human always CONFIRM before it is written, or may an explicit
   `--recipe node-pnpm` flag write it unprompted? Proposed: OFFER-and-confirm by default
   (never silent inject, per A3 + the ADR); an explicit flag is an opt-in that IS the
   confirmation. CONFIRM.

<!-- /open-questions -->

## Problem Statement

`dorfl-setup` provisions only what dorfl needs (Node + dorfl + harness); it deliberately
does NOT provision the PROJECT's toolchain — the **documented-not-detected** boundary
(ADR `install-ci-project-provisioning-native-passthrough`). The escape hatch exists: the
**project-setup hook** (`projectSetup.<provider>`, an opaque native-syntax passthrough the
`install-ci` GitHub adapter already splices FIRST into `dorfl-setup`). But NOTHING guides a
user to it — so a real repo discovers the gap only via a red CI check.

Lived proof (rocketh, 2026-07-21): a `pnpm`-based `verify` gate died at `pnpm: command not
found` (no package manager provisioned), then at `changeset status --since=main` (no local
`main` on a detached PR checkout). Both are the toolchain boundary biting a common,
well-known stack — the kind of thing dorfl COULD help with without abandoning agnosticism.
The pitfalls are now documented (`docs/ci/README.md` → "Writing a CI-safe verify gate"),
but documentation is the floor, not the ceiling.

The opportunity, in one line: **keep the core stack-agnostic, but be MORE helpful when the
repo is a stack dorfl recognises** — by offering a ready-made, native provisioning snippet
instead of leaving the user to hand-write it (or hit a red check first).

## Solution

A **RECIPE LIBRARY**: a curated set of per-provider, native-syntax CI-provisioning
snippets for common stacks (Node+pnpm, Node+npm, Go, Rust, …). `setup` / `install-ci`
OFFERS the matching recipe; the human confirms; dorfl emits the chosen snippet VERBATIM as
the SAME `projectSetup.<provider>` opaque passthrough that already exists. The core never
gains a portable step-DSL and never force-injects — it just stops making the user write
boilerplate for a stack it already recognises.

Why this is the RIGHT shape (both already established):

- **The ADR DEFERS (not rejects) exactly this.** `install-ci-project-provisioning-native-passthrough`
  names it: *"Presets (deferred, not rejected): a curated pnpm/node/rust snippet library is
  later sugar over the same hook."* Recipes ARE those presets; the raw hook now exists, so
  this is the sanctioned next layer.
- **A recipe is NOT the rejected portable DSL.** The ADR rejects a normalized cross-provider
  step SCHEMA (translate one provider's steps to another). A recipe is per-provider native
  syntax the human SELECTS — no translation, no core parsing, emitted verbatim. Agnostic
  core preserved; a future non-GitHub adapter carries its OWN recipes.
- **It is the CI TWIN of setup's EXISTING A3b `prepare` detection.** setup already detects
  the env-prep from a lockfile (`pnpm-lock.yaml ⇒ pnpm install`, `Cargo.lock`, `go.sum`),
  but `prepare` runs only in the runner's FRESH-WORKTREE lifecycle, NOT the standalone
  GitHub `verify` job — which is exactly why rocketh's verify died. A recipe is the CI-side
  snippet MIRRORING that detected `prepare`: the same stack knowledge setup already has,
  applied to the `dorfl-setup` provisioning block.

Each recipe carries the ADR's named cost axes: a VERSION axis (pinned, read from the repo
where possible), an OPINION (which actions/commands), and MAINTENANCE (recipes age with the
ecosystem — a documentation-grade concern, never a correctness gate). A Node+pnpm GitHub
recipe, for example, emits the steps that make a pnpm `verify` gate CI-safe (the three
pitfalls documented in `docs/ci/README.md`): `pnpm/action-setup` + `setup-node(cache:pnpm)`
+ `pnpm install --frozen-lockfile` + the local-`main` fixup when the gate uses `changeset
status --since=main`.

The mechanism it plugs into ALREADY EXISTS (this is additive sugar, not new infrastructure):
the `install-ci` CLI, the `projectSetup.<provider>` config key, and the GitHub adapter's
`renderProjectSetup` splice-FIRST emitter are all built. The recipe layer adds: the curated
snippet library, the offer/selection UX (setup A3b-linked and/or the install-ci picker), and
the version-from-repo resolution.

## User Stories

1. As someone onboarding a common-stack repo, I want `setup`/`install-ci` to OFFER a
   ready-made CI provisioning recipe for my stack (Node+pnpm, Go, Rust, …), so my `verify`
   gate is CI-safe from the start instead of red until I hand-write the hook.
2. As a maintainer, I want the offered recipe to PIN tool versions read from my repo
   (`packageManager`/`.tool-versions`/`go.mod`/…) where possible, so CI is reproducible and
   not a hardcoded stale version.
3. As a maintainer of an UNusual stack, I want the raw `projectSetup.<provider>` hook to
   still be there unchanged, so a stack with no recipe is never blocked — recipes are sugar
   over the escape hatch, not a replacement.
4. As a dorfl maintainer, I want recipes to stay PER-PROVIDER native syntax (no portable
   DSL, no cross-provider translation), so the agnostic core and the ADR hold and a future
   non-GitHub adapter carries its own recipes.
5. As a user, I want dorfl to OFFER (detect-and-propose) but never SILENTLY INJECT a stack
   snippet, so the boundary stays human-owned (the A3 "don't smuggle ecosystem favouritism"
   rule reads as don't-inject, not don't-offer).
6. As a maintainer, I want a recipe to encode the KNOWN CI pitfalls for its stack (the
   pnpm-not-found / detached-main / Version-PR traps documented in `docs/ci/README.md`), so
   adopting the recipe pre-solves them rather than re-discovering each via a red check.

## Out of Scope

- **A portable cross-provider step-DSL / normalized schema** — rejected by the ADR; recipes
  are per-provider native snippets, never a translation layer.
- **Auto-DETECTING a stack and INJECTING its snippet unprompted** — violates the ADR's
  documented-not-detected / human-owned boundary. dorfl OFFERS; the human confirms.
- **Changing `dorfl verify` to run `prepare`** — the standalone gate stays pure (env-ready is
  a separate concern); recipes provision the CI JOB, they do not change verify semantics.
- **Re-architecting the project-setup hook / the `install-ci` emitter** — those exist and are
  reused verbatim; this spec adds the recipe library + offer UX on top.
- **A complete recipe for every ecosystem in the first cut** — ship 2-3 high-value stacks
  (Open Question 1); the raw hook covers the rest; more recipes are additive later.
- **Runner-in-ci / a new CI capability** — `install-ci` and the `projectSetup` hook already
  exist; no dependency on unbuilt CI infrastructure.

## Further Notes (provenance + reuse)

- **Reuse, don't reinvent:** the `projectSetup.<provider>` hook + `renderProjectSetup`
  splice-FIRST emitter (`install-ci-github.ts`, `install-ci-core.ts`); setup's A3b
  lockfile→`prepare` detection (`skills/setup/SKILL.md`) — the same stack knowledge, applied
  CI-side; the pitfalls + the copy-pasteable GitHub pnpm example already in
  `docs/ci/README.md`.
- **Blessed by:** ADR `install-ci-project-provisioning-native-passthrough` (the deferred
  "Presets" line is this spec).
- **Born from** the rocketh CI investigation (observations
  `verify-ci-fails-pnpm-not-found-no-project-setup-hook`,
  `verify-gate-changeset-status-fails-on-the-version-pr`) and the idea
  `setup-install-ci-project-setup-recipes`.
- **`humanOnly`:** touches the `setup` onboarding conversation + the generated CI
  provisioning shape (near auth/secrets scaffolding) + a per-ecosystem opinion/maintenance
  commitment — a human should drive the tasking + the recipe curation. (Per-task gates are
  decided per task by the tasker, not inherited.)
