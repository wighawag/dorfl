---
title: a PRD/slice born from an UNTRUSTED issue carries an origin-trust STAMP, and the build transition resolves to `propose` for untrusted-origin work even when the build `integration` is `merge` — moving the human checkpoint onto the becomes-code build. An explicit --merge still wins (the operator is present).
slug: untrusted-origin-forces-build-propose
blockedBy: [per-transition-integration-mode-slicing-vs-build]
covers: []
---

## What to build

Close the trust-laundering gap at the PRD→slice→build boundary. Today an issue from an UNTRUSTED author is gated at intake by forcing `--propose` on the EMITTED artifact (the author-trust policy in `intake.ts` / the generated `intake.yml`, landed by `install-ci-intake-trigger-and-review-surface`, #132). But once that artifact lands on `main` (e.g. a human merges the proposed PRD/slice PR), its UNTRUSTED ORIGIN is INVISIBLE: nothing on the artifact records how it was born. So a later `advance`/CI tick that auto-slices that PRD (or auto-builds that slice) treats it as trusted in-boundary work — the author-trust signal was LAUNDERED at the merge boundary.

The principle (the maintainer's framing): **a PRD or slice FILE is inert — the risk is the BUILD (it becomes code). So an untrusted origin should NOT block the file from landing/slicing; it should force the BUILD transition to `propose`, so a human reviews the code before it merges.** This composes with `per-transition-integration-mode-slicing-vs-build`: untrusted-origin work can still slice with `slicingIntegration: merge` (slice files land on main, harmless), but its BUILD transition resolves to `propose` regardless of the build `integration` mode.

### Two parts

#### Part 1 — persist origin-trust PROVENANCE on the artifact (the missing foundation)

There is NO origin/provenance field on a PRD/slice today (verified — `## Provenance` sections in some `done/` files are freeform prose, not a machine-read frontmatter field). Add a frontmatter stamp, e.g.:

```yaml
origin: issue          # how it was born: human (default/unset) | issue
originTrust: untrusted  # the author-trust at birth: trusted | untrusted (only meaningful when origin: issue)
```

**WHERE the trust verdict lives — verified, and it is NOT where an earlier draft assumed.** `intake.ts` (the engine command) DELIBERATELY does NOT know author-trust: it states (`intake.ts` ~L296) that author-trust "is CI's POLICY, authored in `runner-in-ci` — NOT here." The trust RESOLUTION (`author_association` → trusted/untrusted) lives in TWO places, both OUTSIDE `intake.ts`:
- the pure fn `deriveIntakeFlags` + `TRUSTED_AUTHOR_ASSOCIATIONS` (`intake-trigger-template.ts`), which takes `authorTrusted: boolean` — it does NOT read the payload; and
- the generated `intake.yml` BASH SHELL, which reads `author_association` off the event and collapses it to the per-outcome FLAGS (`--propose-slice` etc.) BEFORE calling `agent-runner intake`.

So by the time `agent-runner intake <N>` runs, the raw trust signal is GONE — `intake.ts` receives only the resolved integration modes, never `author_association`. **Therefore intake.ts CANNOT stamp originTrust from a verdict it does not have.** The stamp must be threaded IN as an explicit input:

- **The CI `intake.yml` shell** (which DOES know `author_association`) passes a NEW explicit flag, e.g. `--origin-trust <trusted|untrusted>`, to `agent-runner intake <N>`, derived from the SAME `author_association` case it already computes for the integration flags (extend `deriveIntakeFlags` / the shell to ALSO emit this, so the flag and the integration mode cannot desync).
- **`intake.ts`** takes that flag as an option and WRITES `origin: issue` + `originTrust: <value>` onto the emitted PRD/slice frontmatter. It does NOT itself resolve trust (preserving the `intake.ts` ~L296 boundary: trust is CI's policy, passed IN).
- **The LOCAL `intake` path** (a human running `agent-runner intake <N>` directly, no CI shell) has NO `author_association` and passes no `--origin-trust`. Such artifacts are UNSTAMPED ⇒ treated as `human`/trusted. This is correct: a human running intake locally IS the trust checkpoint (gate-free, the explicit invocation is its own authorization, exactly as `do`). So origin-trust provenance ORIGINATES ONLY from the CI front-door shell.
- **human-authored artifacts** have no stamp (unset ⇒ `origin: human`, trusted) — UNCHANGED behaviour, no friction for the normal path.

#### Part 2 — the slicer PROPAGATES provenance, and the build transition reads it

- When the slicer (`slicing.ts`) slices a PRD carrying `origin: issue` + `originTrust: untrusted`, it PROPAGATES that stamp onto every emitted backlog slice. (A slice's risk is its build; the stamp must reach the slice so the build transition can see it.)
- The BUILD transition resolution (from `per-transition-integration-mode-slicing-vs-build`) gains one input: **untrusted-origin ⇒ resolves to `propose`**, slotted into the precedence chain ABOVE config, BELOW the explicit flag:

```
explicit --merge / --propose          ← ALWAYS wins (operator is present; --merge clears the clamp)
  > untrusted-origin ⇒ propose         ← this slice (build transition only)
  > integration (the build-transition config mode)
  > default
```

- This touches the **build transition ONLY**. `slicing` is unaffected (slice files landing on main is harmless). intake's own per-emit resolver is unaffected (it already handles the emit-time decision).

### Why an explicit `--merge` still wins (decided — do not relitigate)

The operator typing `--merge` is PRESENT and deliberate — that IS the authorization to override the provenance default (the maintainer's rule: CLI always wins). So untrusted-origin is a strong DEFAULT, not an un-overridable clamp; no special "force" key is needed (a plain `--merge` is the override). The autonomous/CI path passes no such flag, so there untrusted-origin reliably forces `propose`.

## Acceptance criteria

- [ ] A PRD/slice gains optional `origin` (`human`|`issue`) + `originTrust` (`trusted`|`untrusted`) frontmatter; unset ⇒ `human`/trusted (the normal path, no behaviour change). A test pins the schema + the unset default.
- [ ] The trust verdict is passed INTO `intake.ts` as an explicit input (a NEW `--origin-trust <trusted|untrusted>` flag / option), NOT resolved inside `intake.ts` (which deliberately does not know author-trust, `intake.ts` ~L296). The generated `intake.yml` shell derives it from the SAME `author_association` case it already computes for the integration flags (extend `deriveIntakeFlags` / the shell so flag + mode cannot desync); a test asserts the shell emits `--origin-trust untrusted` for a non-OWNER/MEMBER/COLLABORATOR author, `trusted` otherwise.
- [ ] `intake.ts` STAMPS `origin: issue` + the passed-in `originTrust` onto every PRD/slice it emits. A test asserts `intake --origin-trust untrusted` emits an artifact stamped `originTrust: untrusted`, `--origin-trust trusted` ⇒ `trusted`.
- [ ] The LOCAL intake path (no `--origin-trust`, e.g. a human running `agent-runner intake` directly) emits an UNSTAMPED artifact (⇒ `human`/trusted): a human running intake IS the checkpoint. A test pins that a no-flag intake does not stamp `originTrust`.
- [ ] The slicer PROPAGATES `origin`/`originTrust` from a PRD onto every emitted backlog slice. A test asserts slicing an `untrusted`-origin PRD yields slices each stamped `untrusted`.
- [ ] The BUILD transition resolves to `propose` for an `originTrust: untrusted` slice even when the build `integration` is `merge`. A test pins: untrusted slice + `integration:"merge"` config + no flag ⇒ a PR (not a merge to main).
- [ ] An explicit `--merge` OVERRIDES the untrusted-origin default (the operator is present). A test pins: untrusted slice + `--merge` ⇒ lands on main.
- [ ] The autonomous/CI build path (no explicit flag) reliably forces `propose` for untrusted-origin slices. A test asserts a bare `advance`/`do` auto-pick of an untrusted slice proposes, never merges.
- [ ] The slicing transition and intake's own `{slice, prd}` emit-resolver are UNAFFECTED (this touches the BUILD transition only). A test/read confirms slice files still land per `slicingIntegration ?? integration`, and intake's emit decision is unchanged.
- [ ] `CONTEXT.md` glossary pins `origin`/`originTrust` (provenance that survives the merge boundary so the becomes-code checkpoint is not laundered). `docs/adr/` records the decision (untrusted origin forces build-propose; explicit `--merge` overrides) IF the maintainer supplies the why at build time — otherwise leave the ADR out (no inferred ADR).
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `per-transition-integration-mode-slicing-vs-build` — this slice ADDS an input (`untrusted ⇒ propose`) to the BUILD transition's resolution, which that slice introduces. Build it first. (The intake author-trust machinery this depends on — the trusted/untrusted resolver — ALREADY landed in `work/done/install-ci-intake-trigger-and-review-surface.md` / `intake.ts`, so it is NOT a blocker; this slice only WRITES the already-computed verdict onto the artifact.)

## Prompt

> FIRST, drift-check: confirm (a) `per-transition-integration-mode-slicing-vs-build` has LANDED (the build transition resolves from `integration`, the slicing transition from `slicingIntegration ?? integration`) — if not, STOP, this is `blockedBy` it; (b) `intake.ts` STILL does NOT resolve author-trust itself (it states trust "is CI's POLICY … NOT here", ~L296); the resolution lives in `deriveIntakeFlags`/`TRUSTED_AUTHOR_ASSOCIATIONS` (`intake-trigger-template.ts`) + the generated `intake.yml` bash shell, which collapses `author_association` to integration FLAGS before calling `agent-runner intake` — so the raw trust signal does NOT reach `intake.ts` today; (c) there is STILL no machine-read `origin`/`originTrust` frontmatter field (the `## Provenance` prose in `done/` is NOT it). If a provenance field already exists, adapt to it.
>
> GOAL: stop the author-trust signal being LAUNDERED at the PRD/slice merge boundary. The CI `intake.yml` shell (which knows `author_association`) passes a NEW `--origin-trust <trusted|untrusted>` flag to `agent-runner intake` (derived from the SAME author_association case as the integration flags, so they cannot desync); `intake.ts` STAMPS `origin: issue` + that `originTrust` onto the emitted PRD/slice (it does NOT resolve trust itself — preserving the ~L296 boundary); the slicer PROPAGATES the stamp onto emitted slices; and the BUILD transition resolves to `propose` for untrusted-origin work even when the build mode is `merge`. An explicit `--merge` overrides (CLI always wins). A LOCAL intake (no `--origin-trust`) emits UNSTAMPED (human/trusted) — the local human IS the checkpoint.
>
> HARD INVARIANTS: (1) `intake.ts` does NOT resolve author-trust — it is passed IN via `--origin-trust` (the ~L296 boundary holds). (2) untrusted-origin affects the BUILD transition ONLY — slicing + intake's own emit-resolver are untouched (a file on main is inert). (3) explicit `--merge` overrides the untrusted-origin default; no special force-key. (4) unset provenance ⇒ `human`/trusted ⇒ ZERO behaviour change; a LOCAL no-flag intake is unstamped. (5) the autonomous/CI build path (no flag) reliably forces `propose` for untrusted-origin slices. (6) NO inferred ADR — record the decision ONLY if the maintainer supplies the why at build time.
>
> SEAMS TO TEST AT: the frontmatter schema (origin/originTrust + unset default); intake emit (untrusted author ⇒ stamped untrusted); the slicer (propagates the stamp to emitted slices); the BUILD transition resolution (untrusted + `build:"merge"` + no flag ⇒ propose; untrusted + `--merge` ⇒ merge; trusted/unset ⇒ config as-is). Reuse the intake / slicing / do / integration-core test harnesses; no network.
>
> DONE: untrusted-origin work is stamped, propagated PRD→slice, and forced to build-propose (overridable by an explicit --merge), the laundering gap is closed with a regression test, the normal human path is unchanged, glossary pinned, and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions — the runner/human owns those.
