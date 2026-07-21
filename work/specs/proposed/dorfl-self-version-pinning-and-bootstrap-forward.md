---
title: Repo-declared dorfl version pinning — bare `dorfl` self-forwards to the pinned build (project-independent)
slug: dorfl-self-version-pinning-and-bootstrap-forward
humanOnly: true
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/tasks/ready/` tasks.

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
-->

## Open questions

1. **`dorflBin` (arbitrary command) vs `dorflVersion` (version only) vs BOTH?** The
   safe-but-rigid form is a VERSION the bootstrap resolves itself (`"dorflVersion":
   "0.7.0"` → the bootstrap runs its own cached/`npx` fetch). The flexible-but-risky
   form is an arbitrary COMMAND string exec'd verbatim (`"dorflBin": "npx dorfl@0.7.0"`
   / `"./bin/dorfl"` / `"mise exec dorfl@0.7.0 --"`). Proposed answer: SUPPORT BOTH,
   with `dorflBin` (explicit command) winning over `dorflVersion` (shorthand), and the
   bare shorthand `"dorflBin": "0.7.0"` (a value with no spaces that parses as a
   semver) treated as `dorflVersion`. CONFIRM this precedence + the shorthand-detection
   rule.
2. **Trust boundary — may a per-repo `dorfl.json` name an executable COMMAND at all?**
   Today the "which executable" knobs (`agentCmd`, `piBin`) are resolved from the
   GLOBAL config chain ONLY; the per-repo `dorfl.json` is a deliberate SUBSET of Config
   that CANNOT set them (so a cloned repo cannot dictate what binary runs on your
   machine). A `dorflBin` COMMAND in a committed `dorfl.json` reintroduces exactly that
   surface — and dorfl runs untrusted issue-authored content (the whole `originTrust`
   model). Proposed answer: a plain `dorflVersion` (a version, resolved by the trusted
   bootstrap — no arbitrary command) is honored from the repo unconditionally; an
   arbitrary `dorflBin` COMMAND is honored only when the repo/checkout is TRUSTED
   (interactive/local, or an explicit `--trust-dorfl-bin` / `DORFL_TRUST_BIN=1`), and is
   IGNORED-with-a-warning on an untrusted-origin path. CONFIRM the trust gate.
3. **Silent forward or announced?** Proposed: the bootstrap prints ONE stderr line when
   it forwards (`dorfl: using pinned 0.7.0 from ./dorfl.json (running global is 0.8.0)`),
   suppressible with `DORFL_NO_FORWARD=1` (which also DISABLES the forward, running the
   global as-is). CONFIRM the env-var name(s) + that the notice goes to stderr (never
   stdout — it must not corrupt `--json` output).
4. **Fetch-and-cache for the `dorflVersion` form?** For a NON-JS repo with no
   `node_modules`, `dorflVersion` must be obtainable without a JS toolchain assumption.
   Proposed: the bootstrap resolves it via `npx dorfl@<v>` (npx caches) when `npx` is
   present, else a dorfl-owned cache (`~/.dorfl/versions/<v>/`) — but the cache is the
   heavier path (it re-implements package-manager caching, the thing this spec
   otherwise AVOIDS). CONFIRM whether v1 ships ONLY the `npx`-delegating resolution
   (simplest; a repo with a truly JS-free environment declares an explicit `dorflBin`
   path instead) and defers the dorfl-owned cache.

<!-- /open-questions -->

## Problem Statement

Agents (and humans) are taught to invoke bare **`dorfl`**, deliberately: the workflow
must be **project-independent** — a Rust / Go / Python repo has no `pnpm`, no
`node_modules/.bin/dorfl`, so `pnpm dorfl` / `npx dorfl` in the taught commands would
leak a JS-ecosystem assumption into the protocol. Bare `dorfl` keeps the contract
language-agnostic.

But bare `dorfl` runs **whatever version is globally installed**, which **drifts**: a
laptop with `dorfl@0.8` and a repo built/reasoned-about under `dorfl@0.7` silently mix
behaviours, and CI (which does `npm install -g dorfl`) floats to whatever is latest that
day. There is no way for a repo to say "build/advance/intake ME with THIS dorfl version"
in a way that bare `dorfl` honours.

Partial mechanisms exist but do not close it:
- **CI resolver shim** (`install-ci`'s `dorfl-setup`): a `$PATH` shim that prefers
  `node_modules/.bin/dorfl` (the repo's JS devDep) over the global bootstrap. This IS
  the right SHAPE — bare `dorfl` on `$PATH` resolving to a pin — but it is (a) CI-only,
  (b) JS-specific (hardcodes `node_modules/.bin`), and (c) not reflected on the laptop.
- **`dorfl sync`** pins the `work/protocol/` DOCS to the installed dorfl, but not the
  dorfl EXECUTABLE version itself — the docs can match while the running CLI drifts.
- **`pnpm dorfl`** resolves a JS devDep pin but is NOT project-independent (rejected).

The gap in one line: **a repo cannot declare the dorfl VERSION that bare `dorfl` should
run, project-independently and reproducibly.**

## Solution

Make the globally-installed **`dorfl` a thin BOOTSTRAP that self-forwards** to a
repo-declared pin, so bare `dorfl` stays the taught, project-independent command while
the VERSION becomes reproducible + repo-owned.

1. **A repo declares its pin in `dorfl.json`** — the shorthand target is
   `"dorflBin": "0.7.0"` (a bare version). The field accepts either a VERSION
   (`dorflVersion` semantics — the trusted bootstrap resolves it, e.g. via `npx
   dorfl@<v>`) or an explicit COMMAND / path (`npx dorfl@0.7.0`, `./bin/dorfl`,
   `node_modules/.bin/dorfl`, `mise exec dorfl@0.7.0 --`), with the version/command
   distinction + precedence resolved per Open Question 1.

2. **The bootstrap self-forwards.** On startup, before doing any work, the running
   `dorfl` reads the nearest repo `dorfl.json`; if it declares a pin that resolves to a
   DIFFERENT dorfl than the one running, it `exec`s the pinned one (inheriting argv +
   env), after a one-line stderr notice (Open Question 3). When NO pin is declared (the
   onboarding case — `setup`/`install-ci` run in a repo with no pin yet), the bootstrap
   runs ITSELF, so onboarding is never chicken-and-egg. A pin that cannot be resolved
   (missing binary / unfetchable version) is a CLEAR error naming the pin + how to fix,
   never a silent fall-through to a skewed global.

3. **Trust-gated command execution** (Open Question 2): a plain VERSION is honoured from
   the repo unconditionally (the trusted bootstrap owns the fetch); an arbitrary COMMAND
   is honoured only on a TRUSTED/interactive path, ignored-with-a-warning on an
   untrusted-origin path — mirroring the existing rule that per-repo `dorfl.json` cannot
   set `agentCmd`/`piBin`.

4. **`setup` nudges the pin at onboarding.** During adoption, `setup` OFFERS to pin the
   dorfl version (defaulting to the dorfl running the setup) into `dorfl.json`, so
   reproducibility is the DEFAULT a repo is born with — not a thing a user must
   retrofit. Language-agnostic, like setup's existing per-change-convention nudge:
   ASK once, record if accepted, leave a documented stub if skipped.

5. **The CI resolver shim CONVERGES onto this.** Once bare `dorfl` self-forwards from
   `dorfl.json`, `install-ci`'s bespoke `node_modules/.bin` shim becomes redundant (or a
   thin fallback): CI's `npm install -g dorfl` bootstrap forwards to the repo's declared
   pin by the SAME generic mechanism the laptop uses — one code path, JS and non-JS
   alike. (The exact convergence — delete the shim vs keep it as a JS fast-path — is a
   task-level decision, recorded when built.)

6. **Docs + the drift story.** Document the model: dorfl is a TOOL (like `prettier`/
   `tsc`), the global is a bootstrap, the repo declares the pin, bare `dorfl` honours it.
   Note the upgrade ritual (bump the pin → `dorfl sync` → re-run `install-ci` only if the
   workflow TEMPLATES changed) so the pinned CLI, the `work/protocol/` docs, and the CI
   workflow YAML stay aligned.

## User Stories

1. As an agent author, I want the taught command to stay bare **`dorfl`** (never `pnpm
   dorfl`/`npx dorfl`), so the workflow is project-independent across JS and non-JS
   repos.
2. As a maintainer, I want to declare the dorfl VERSION a repo runs with in `dorfl.json`
   (shorthand `"dorflBin": "0.7.0"`), so builds/advances/intakes are REPRODUCIBLE and do
   not float with whatever global dorfl a machine happens to have.
3. As a maintainer of a NON-JS repo, I want the pin to work WITHOUT a `node_modules`
   (e.g. `npx dorfl@0.7.0`, a vendored `./bin/dorfl`, or a version the bootstrap
   fetches), so pinning is not a JS-ecosystem privilege.
4. As a CI operator, I want CI's bare `dorfl` to run the repo's declared pin by the SAME
   mechanism the laptop uses, so CI and local behaviour cannot diverge and the bespoke
   `install-ci` shim is no longer the only pinning path.
5. As a user, I want the forward ANNOUNCED (a one-line stderr notice) and OPT-OUTABLE
   (`DORFL_NO_FORWARD=1`), and a broken pin to FAIL CLEARLY, so a version swap is never
   silent skew.
6. As a security-conscious maintainer, I want a per-repo `dorfl.json` to NOT be able to
   run an ARBITRARY command on my machine from an untrusted checkout — a plain VERSION is
   safe (the trusted bootstrap resolves it); an arbitrary COMMAND is honoured only when
   the repo/checkout is trusted.
7. As someone onboarding a repo, I want `setup` to OFFER to pin the dorfl version, so a
   fresh repo is reproducible by default rather than retrofitted.

## Out of Scope

- **A full dorfl-owned version MANAGER / cache** (`~/.dorfl/versions/<v>/` with its own
  download+integrity+offline story) — v1 delegates version resolution to `npx`/an
  explicit path (Open Question 4). Building a mini package-manager is explicitly avoided
  (it re-implements what npm/pnpm/npx already do); revisit only if the `npx`-delegating
  path proves insufficient.
- **Pinning the AGENT HARNESS version** (`pi`) — this spec pins DORFL itself; the harness
  is a separate axis (its own config `piBin`/`agentCmd`) and a separate future concern.
- **`work/protocol/` doc sync** — `dorfl sync` already owns the DOCS; this spec pins the
  EXECUTABLE. The two are complementary and the upgrade ritual documents their alignment,
  but sync is not re-implemented here.
- **Auto-UPGRADING a repo's pin** — the pin is a deliberate, human-bumped, reviewable
  value (like any dependency version); nothing here auto-advances it.

## Further Notes (provenance)

- Born from a live investigation (2026-07-20): rocketh's CI floated the dorfl version
  because it declared no pin, so `npm install -g dorfl` ran latest. The existing
  `install-ci` resolver shim (task `install-ci-prefer-project-local-dorfl`) already
  implements the CI half JS-specifically; this spec generalises it (any project type) AND
  extends it to the laptop's bare `dorfl`.
- Precedent for "config names an executable": `agentCmd`/`piBin`/`harness` — but those are
  GLOBAL-config-only (a per-repo `dorfl.json` is a deliberate subset that cannot set
  them), which is the exact trust precedent Open Question 2 must honour for a repo-set
  `dorflBin` command.
- Complementary command: `dorfl sync` (pins the `work/protocol/` docs). The pin here +
  sync together keep CLI, docs, and CI workflow YAML aligned.
