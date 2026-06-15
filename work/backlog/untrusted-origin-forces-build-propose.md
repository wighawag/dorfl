---
title: a PRD/slice born from an UNTRUSTED issue carries an origin-trust STAMP, and the build transition resolves to `propose` for untrusted-origin work even when `integration.build` is `merge` — moving the human checkpoint onto the becomes-code build. An explicit --merge still wins (the operator is present).
slug: untrusted-origin-forces-build-propose
blockedBy: [per-transition-integration-mode-slicing-vs-build]
covers: []
---

## What to build

Close the trust-laundering gap at the PRD→slice→build boundary. Today an issue from an UNTRUSTED author is gated at intake by forcing `--propose` on the EMITTED artifact (the author-trust policy in `intake.ts` / the generated `intake.yml`, landed by `install-ci-intake-trigger-and-review-surface`, #132). But once that artifact lands on `main` (e.g. a human merges the proposed PRD/slice PR), its UNTRUSTED ORIGIN is INVISIBLE: nothing on the artifact records how it was born. So a later `advance`/CI tick that auto-slices that PRD (or auto-builds that slice) treats it as trusted in-boundary work — the author-trust signal was LAUNDERED at the merge boundary.

The principle (the maintainer's framing): **a PRD or slice FILE is inert — the risk is the BUILD (it becomes code). So an untrusted origin should NOT block the file from landing/slicing; it should force the BUILD transition to `propose`, so a human reviews the code before it merges.** This composes with `per-transition-integration-mode-slicing-vs-build`: untrusted-origin work can still `slicing: merge` (slice files land on main, harmless), but its `build` resolves to `propose` regardless of `integration.build`.

### Two parts

#### Part 1 — persist origin-trust PROVENANCE on the artifact (the missing foundation)

There is NO origin/provenance field on a PRD/slice today (verified — `## Provenance` sections in some `done/` files are freeform prose, not a machine-read frontmatter field). Add a frontmatter stamp, e.g.:

```yaml
origin: issue          # how it was born: human (default/unset) | issue
originTrust: untrusted  # the author-trust at birth: trusted | untrusted (only meaningful when origin: issue)
```

- **intake STAMPS it** at emit time — the ONLY moment author-trust is known (`author_association`). intake already RESOLVES trusted-vs-untrusted (`deriveIntakeFlags` / the `intake.yml` policy: OWNER/MEMBER/COLLABORATOR ⇒ trusted, else untrusted); this part WRITES that resolved verdict onto the emitted PRD/slice frontmatter, rather than only using it for the emit-time flag.
- **human-authored artifacts** have no stamp (unset ⇒ `origin: human`, trusted) — UNCHANGED behaviour, no friction for the normal path.

#### Part 2 — the slicer PROPAGATES provenance, and the build transition reads it

- When the slicer (`slicing.ts`) slices a PRD carrying `origin: issue` + `originTrust: untrusted`, it PROPAGATES that stamp onto every emitted backlog slice. (A slice's risk is its build; the stamp must reach the slice so the build transition can see it.)
- The BUILD transition resolution (from `per-transition-integration-mode-slicing-vs-build`) gains one input: **untrusted-origin ⇒ resolves to `propose`**, slotted into the precedence chain ABOVE config, BELOW the explicit flag:

```
explicit --merge / --propose          ← ALWAYS wins (operator is present; --merge clears the clamp)
  > untrusted-origin ⇒ propose         ← this slice (build transition only)
  > integration.build (config)
  > default
```

- This touches the **build transition ONLY**. `slicing` is unaffected (slice files landing on main is harmless). intake's own per-emit resolver is unaffected (it already handles the emit-time decision).

### Why an explicit `--merge` still wins (decided — do not relitigate)

The operator typing `--merge` is PRESENT and deliberate — that IS the authorization to override the provenance default (the maintainer's rule: CLI always wins). So untrusted-origin is a strong DEFAULT, not an un-overridable clamp; no special "force" key is needed (a plain `--merge` is the override). The autonomous/CI path passes no such flag, so there untrusted-origin reliably forces `propose`.

## Acceptance criteria

- [ ] A PRD/slice gains optional `origin` (`human`|`issue`) + `originTrust` (`trusted`|`untrusted`) frontmatter; unset ⇒ `human`/trusted (the normal path, no behaviour change). A test pins the schema + the unset default.
- [ ] intake STAMPS `origin: issue` + the resolved `originTrust` onto every PRD/slice it emits, using the SAME trusted-vs-untrusted resolution it already computes for the emit-time flag (OWNER/MEMBER/COLLABORATOR ⇒ trusted, else untrusted). A test asserts an untrusted-author intake emits an artifact stamped `originTrust: untrusted`, a trusted-author one `trusted`.
- [ ] The slicer PROPAGATES `origin`/`originTrust` from a PRD onto every emitted backlog slice. A test asserts slicing an `untrusted`-origin PRD yields slices each stamped `untrusted`.
- [ ] The BUILD transition resolves to `propose` for an `originTrust: untrusted` slice even when `integration.build` is `merge`. A test pins: untrusted slice + `build:"merge"` config + no flag ⇒ a PR (not a merge to main).
- [ ] An explicit `--merge` OVERRIDES the untrusted-origin default (the operator is present). A test pins: untrusted slice + `--merge` ⇒ lands on main.
- [ ] The autonomous/CI build path (no explicit flag) reliably forces `propose` for untrusted-origin slices. A test asserts a bare `advance`/`do` auto-pick of an untrusted slice proposes, never merges.
- [ ] `slicing` and intake's own `{slice, prd}` emit-resolver are UNAFFECTED (this touches the BUILD transition only). A test/read confirms slice files still land per `integration.slicing`, and intake's emit decision is unchanged.
- [ ] `CONTEXT.md` glossary pins `origin`/`originTrust` (provenance that survives the merge boundary so the becomes-code checkpoint is not laundered). `docs/adr/` records the decision (untrusted origin forces build-propose; explicit `--merge` overrides) IF the maintainer supplies the why at build time — otherwise leave the ADR out (no inferred ADR).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `per-transition-integration-mode-slicing-vs-build` — this slice ADDS an input (`untrusted ⇒ propose`) to the BUILD transition's resolution, which that slice introduces. Build it first. (The intake author-trust machinery this depends on — the trusted/untrusted resolver — ALREADY landed in `work/done/install-ci-intake-trigger-and-review-surface.md` / `intake.ts`, so it is NOT a blocker; this slice only WRITES the already-computed verdict onto the artifact.)

## Prompt

> FIRST, drift-check: confirm (a) `per-transition-integration-mode-slicing-vs-build` has LANDED (the BUILD transition resolves from `integration.build`) — if not, STOP, this is `blockedBy` it; (b) intake STILL computes a trusted-vs-untrusted verdict from `author_association` (OWNER/MEMBER/COLLABORATOR ⇒ trusted) in `intake.ts` / the generated `intake.yml` (landed by `install-ci-intake-trigger-and-review-surface`); (c) there is STILL no machine-read `origin`/`originTrust` frontmatter field on PRDs/slices (the `## Provenance` prose sections in `done/` are NOT it). If a provenance field already exists, adapt to it.
>
> GOAL: stop the author-trust signal being LAUNDERED at the PRD/slice merge boundary. A PRD/slice born from an UNTRUSTED issue carries an `origin: issue` + `originTrust: untrusted` STAMP (written by intake at emit time); the slicer PROPAGATES it onto emitted slices; and the BUILD transition resolves to `propose` for untrusted-origin work even when `integration.build` is `merge` — moving the human checkpoint onto the becomes-code build, NOT the inert file. An explicit `--merge` overrides (the operator is present; CLI always wins).
>
> HARD INVARIANTS: (1) untrusted-origin affects the BUILD transition ONLY — `slicing` and intake's own emit-resolver are untouched (a file landing on main is inert/harmless). (2) explicit `--merge` overrides the untrusted-origin default; no special force-key (a plain `--merge` is the override). (3) unset provenance ⇒ `human`/trusted ⇒ the normal path, ZERO behaviour change. (4) the autonomous/CI path (no flag) reliably forces `propose` for untrusted-origin slices. (5) NO inferred ADR — record the decision ONLY if the maintainer supplies the why at build time.
>
> SEAMS TO TEST AT: the frontmatter schema (origin/originTrust + unset default); intake emit (untrusted author ⇒ stamped untrusted); the slicer (propagates the stamp to emitted slices); the BUILD transition resolution (untrusted + `build:"merge"` + no flag ⇒ propose; untrusted + `--merge` ⇒ merge; trusted/unset ⇒ config as-is). Reuse the intake / slicing / do / integration-core test harnesses; no network.
>
> DONE: untrusted-origin work is stamped, propagated PRD→slice, and forced to build-propose (overridable by an explicit --merge), the laundering gap is closed with a regression test, the normal human path is unchanged, glossary pinned, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions — the runner/human owns those.
