---
title: setup/install-ci — a RECIPE LIBRARY for project-setup provisioning (the ADR's deferred "presets"; the CI twin of A3b prepare-detection)
type: idea
status: incubating
created: 2026-07-21
supersedes: setup-install-ci-prompt-for-project-setup-hook
---

## The idea

Give `setup` / `install-ci` a small library of **environment RECIPES** — ready-made,
native-syntax CI provisioning snippets for common stacks (Node+pnpm, Node+npm,
Go+goreleaser, Rust+cargo, …). When onboarding, dorfl OFFERS the matching recipe;
the human picks/confirms it; dorfl splices the chosen native snippet VERBATIM as the
project-setup hook. dorfl stays agnostic (it never invents a portable DSL, never
force-injects), but is MORE HELPFUL when it recognises a common environment.

> "Keep the system agnostic, but let it be more helpful when it can." A recipe is a
> curated native snippet, NOT a translation layer — the human chooses it, and it is
> emitted as the SAME opaque passthrough the raw hook already uses.

## Why this is the RIGHT shape (already ADR-blessed)

- **The ADR explicitly DEFERS (not rejects) this.** `install-ci-project-provisioning-native-passthrough`
  lists: *"Presets (deferred, not rejected): a curated pnpm/node/rust snippet library is
  later sugar over the same hook; each preset carries a version axis + an opinion +
  maintenance, so the first cut ships the raw escape hatch only."* Recipes ARE those
  presets. The raw escape hatch (the project-setup hook) now exists; recipes are the
  sanctioned next layer.
- **Recipes are NOT the rejected portable DSL.** The ADR rejects a *normalized cross-provider
  step schema* (translate `uses: dtolnay/rust-toolchain` → GitLab `before_script`) because
  it "gets stuck on the second provider." A recipe library sidesteps that: each recipe is
  PER-PROVIDER native syntax the human selects (a GitHub recipe is Actions YAML; a future
  GitLab recipe is GitLab YAML). No translation, no core parsing — just a menu of verbatim
  snippets. Agnostic core preserved.
- **It is the CI TWIN of setup's EXISTING A3b `prepare` detection.** setup already DETECTS
  the env-prep from lockfiles (A3b): `pnpm-lock.yaml ⇒ pnpm install`, `Cargo.lock`, `go.sum`,
  etc. But `prepare` runs only in the runner's FRESH-WORKTREE lifecycle, NOT in the
  standalone GitHub `verify` job — which is exactly why rocketh's `verify` check died at
  `pnpm: command not found` (the detected `prepare` never provisioned pnpm CI-side). A recipe
  is the CI-side snippet that MIRRORS the detected `prepare`: same stack knowledge setup
  already has (A3b), applied to the `dorfl-setup` provisioning block.

## What a recipe encodes (per the pitfalls we hit)

A Node+pnpm GitHub recipe, for example, would carry the native steps that make a
pnpm-based `verify` gate CI-safe (see `docs/ci/README.md` → "Writing a CI-safe verify gate"):

```yaml
- uses: pnpm/action-setup@v4
  with: { version: <detected-from-packageManager-field> }
- uses: actions/setup-node@v5
  with: { node-version: <detected>, cache: pnpm }
- run: pnpm install --frozen-lockfile
# + the local-main fixup when the gate uses `changeset status --since=main`
```

Each recipe carries the ADR's named cost axes: a VERSION axis (pin the tool version, ideally
read from the repo — `packageManager` field, `.tool-versions`, `go.mod`), an OPINION (which
actions/commands), and MAINTENANCE (recipes age with the ecosystem). Ship 2–3 high-value
recipes first (Node+pnpm, Go, Rust); the raw hook remains for everything else.

## Boundaries (stay honest, per A3 + the ADR)

- **OFFER, never silently inject.** dorfl may DETECT a likely stack (a lockfile — the same
  signal A3b already reads) and PROPOSE the matching recipe, but the human confirms; dorfl
  never writes a stack snippet unasked (the A3 "don't smuggle ecosystem favouritism" rule
  reads as "don't inject", not "don't offer when asked").
- **Per-provider, native.** A recipe is one provider's native syntax; no cross-provider
  translation. Non-GitHub providers get their own recipes (or the raw hook) — never a
  mistranslated GitHub snippet.
- **Version from the repo where possible** (packageManager / .tool-versions / go.mod), so the
  recipe pins reproducibly rather than hardcoding a stale version.
- **The `verify`/`prepare` split stays** (A3/A3b): recipes provision the CI JOB so the GitHub
  `verify` check has what it needs; they do not change what `dorfl verify` runs, nor bake
  install into `verify`.

## Rung ladder (smallest first)

1. **DONE:** document the pitfalls + the raw project-setup-hook remedy (`docs/ci/README.md`).
2. **This idea:** a recipe LIBRARY setup/install-ci offers (2–3 stacks first). Needs the
   `install-ci` CLI (`runner-in-ci`) to host the prompt + the emitter.
3. Optional later: a light onboarding WARNING when `verify` mentions a package manager but no
   project-setup hook/recipe is configured (heuristic hint, human-owned — not detection-driving-injection).

## Refs

- ADR `docs/adr/install-ci-project-provisioning-native-passthrough.md` (the deferred "Presets" line).
- `skills/setup/SKILL.md` A3b (existing lockfile→prepare detection — the same knowledge recipes reuse, CI-side).
- `docs/ci/README.md` → "Writing a CI-safe verify gate" (the pitfalls a recipe would pre-solve).
- Live motivation: rocketh observations `verify-ci-fails-pnpm-not-found-...` / `verify-gate-changeset-status-fails-on-the-version-pr-...`.
