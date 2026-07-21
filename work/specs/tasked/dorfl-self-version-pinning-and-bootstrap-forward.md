---
title: Repo-declared dorfl version pinning — bare `dorfl` self-forwards to the pinned build (project-independent)
slug: dorfl-self-version-pinning-and-bootstrap-forward
humanOnly: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + the code; remaining work: `work/tasks/ready/` tasks. Technical detail moved into the tasks/ADRs once tasked.

## Problem Statement

Agents (and humans) are taught to invoke bare **`dorfl`**, deliberately: the workflow
must be **project-independent** — a Rust / Go / Python repo has no `pnpm`, no
`node_modules/.bin/dorfl`, so `pnpm dorfl` / `npx dorfl` in the taught commands would
leak a JS-ecosystem assumption into the protocol. Bare `dorfl` keeps the contract
language-agnostic.

But bare `dorfl` runs **whatever version is globally installed**, which **drifts**: a
laptop with `dorfl@0.8` and a repo built/reasoned-about under `dorfl@0.7` silently mix
behaviours, and CI (which does `npm install -g dorfl`) floats to whatever is latest that
day. There is no way for a repo to say "build/advance/intake ME with THIS dorfl" in a way
that bare `dorfl` honours.

Partial mechanisms exist but do not close it:
- **CI resolver shim** (`install-ci`'s `dorfl-setup`): a `$PATH` shim that prefers
  `node_modules/.bin/dorfl` (the repo's JS devDep) over the global bootstrap. This IS
  the right SHAPE — bare `dorfl` on `$PATH` resolving to a pin — but it is (a) CI-only,
  (b) JS-specific (hardcodes `node_modules/.bin`), and (c) not reflected on the laptop.
- **`dorfl sync`** pins the `work/protocol/` DOCS to the installed dorfl, but not the
  dorfl EXECUTABLE — the docs can match while the running CLI drifts.
- **`pnpm dorfl`** resolves a JS devDep pin but is NOT project-independent (rejected).

The gap in one line: **a repo cannot declare the dorfl that bare `dorfl` should run,
project-independently and reproducibly.**

## Solution

Make the globally-installed **`dorfl` a thin BOOTSTRAP that self-forwards** to a
repo-declared executable, so bare `dorfl` stays the taught, project-independent command
while the actual dorfl becomes reproducible + repo-owned.

The design is deliberately **minimal** (the decisions below were made 2026-07-21):

1. **One config field: `dorflCmd` — an explicit COMMAND string** in `dorfl.json`. It is
   the command bare `dorfl` forwards to, verbatim: `"node_modules/.bin/dorfl"` (JS
   devDep), `"npx dorfl@0.7.0"` (any repo with npx), `"./bin/dorfl"` (a vendored binary),
   `"mise exec dorfl@0.7.0 --"`, etc. There is NO version shorthand and NO
   `dorflVersion` — a version is expressed by the user writing `npx dorfl@<version>`
   themselves. dorfl does NOT resolve, download, or cache a version (no
   `~/.dorfl/versions/` — out of scope); the command names whatever is already
   obtainable in the repo's environment.

2. **The bootstrap self-forwards.** On startup, before doing any work, the running
   `dorfl` reads the nearest repo `dorfl.json`; if it declares `dorflCmd` AND that
   command is not THIS running process, it `exec`s the command (inheriting argv + env),
   after a one-line **stderr** notice. When NO `dorflCmd` is declared (the onboarding
   case — `setup`/`install-ci` run in a repo with no pin yet), the bootstrap runs
   ITSELF, so onboarding is never chicken-and-egg. A `dorflCmd` that is DECLARED but whose
   target does not resolve FAILS LOUD (decision 2026-07-21, option B) — a clear error
   naming the value + `dorfl.json` path + the fix (run the dependency install) + the
   `--no-forward`/`DORFL_NO_FORWARD` bypass — NOT a silent degrade to the global, which
   would run the WRONG version and defeat the pin. This is SAFE because the forward is a
   ONCE-AT-STARTUP, checkout-root-only decision, NOT recursive: the gate worktree that
   needs `prepare` is created + prepared by the ALREADY-RUNNING dorfl, which runs the
   repo's `prepare`/`verify` via `spawn('bash', ['-c', cmd])` in the worktree — it never
   launches a new `dorfl`, so a fresh worktree's empty `node_modules` never re-triggers the
   forward. The pin is populated by the REPO's own install (CI `install-ci` project-setup
   hook, or the user's `pnpm install`); dorfl does NOT install its own pin (`prepare` is
   worktree-gate env-prep, not a CLI install). `setup`/`install-ci` are unaffected — they
   run before `dorflCmd` is declared, hitting the run-self branch. A PRESENT-but-exec-FAILS
   `dorflCmd` (a real binary that spawn-errors) is the same clear error. `npx dorfl@<v>` /
   a vendored `./bin/dorfl` avoid the absent case (self-fetching / committed).

3. **NO trust gate.** `dorflCmd` is honoured verbatim from the repo's committed
   `dorfl.json`, at the SAME trust level dorfl already grants the committed `verify`
   command (which is likewise an arbitrary shell command run from `dorfl.json`). Running
   `dorfl` in a repo already means trusting that repo's `dorfl.json`; `dorflCmd`
   introduces no new trust class. This is the deliberate exception to the host-only rule
   that a per-repo `dorfl.json` cannot set machine-command keys (`agentCmd`/`piBin`/
   `sessionsDir` are in `REPO_REJECTED_KEYS` per ADR §13) — `dorflCmd` is about which
   dorfl runs, decided per repo BY DESIGN, and it is announced, not silent. Because it
   REVERSES that host-only principle for one key, the exception is recorded as its own
   ADR (see task `dorfl-cmd-config-field`), not left implicit.

4. **Announced + opt-out.** The forward prints ONE line to **stderr** (never stdout — it
   must not corrupt `--json` output), e.g. `dorfl: forwarding to `npx dorfl@0.7.0` (from
   ./dorfl.json)`. It is suppressed AND DISABLED (run the global as-is) by EITHER the
   env var `DORFL_NO_FORWARD=1` OR a CLI flag `--no-forward` — both are honoured before
   dispatch so a user can always reach the bootstrap dorfl directly.

5. **`setup` nudges the pin** (already landed): the adoption conversation offers to
   declare `dorflCmd`, so a repo is born reproducible.

6. **The CI resolver shim CONVERGES onto this.** Once bare `dorfl` self-forwards from
   `dorfl.json`, `install-ci`'s bespoke `node_modules/.bin` shim becomes redundant (or a
   thin fallback): CI's `npm install -g dorfl` bootstrap forwards to the repo's declared
   `dorflCmd` by the SAME generic mechanism the laptop uses — one code path, JS and
   non-JS alike.

7. **Docs + the drift story.** Document the model (dorfl is a TOOL like `prettier`/`tsc`;
   the global is a bootstrap; the repo declares `dorflCmd`; bare `dorfl` honours it) and
   the upgrade ritual (bump `dorflCmd` → `dorfl sync` → re-run `install-ci` only if the
   workflow TEMPLATES changed) so the pinned CLI, the `work/protocol/` docs, and the CI
   workflow YAML stay aligned.

## User Stories

1. As an agent author, I want the taught command to stay bare **`dorfl`** (never `pnpm
   dorfl`/`npx dorfl`), so the workflow is project-independent across JS and non-JS repos.
2. As a maintainer, I want to declare in `dorfl.json` the exact dorfl COMMAND a repo runs
   with (`dorflCmd`), so builds/advances/intakes are REPRODUCIBLE and do not float with
   whatever global dorfl a machine happens to have.
3. As a maintainer of a NON-JS repo, I want `dorflCmd` to be any command my environment
   resolves (`npx dorfl@0.7.0`, a vendored `./bin/dorfl`, a `mise`/`asdf` shim), so
   pinning is not a JS-ecosystem privilege and dorfl never has to resolve a version
   itself.
4. As a CI operator, I want CI's bare `dorfl` to run the repo's declared `dorflCmd` by the
   SAME mechanism the laptop uses, so CI and local behaviour cannot diverge and the
   bespoke `install-ci` shim is no longer the only pinning path.
5. As a user, I want the forward ANNOUNCED (a one-line stderr notice) and OPT-OUTABLE
   (`DORFL_NO_FORWARD=1` or `--no-forward`), and a broken `dorflCmd` to FAIL CLEARLY, so a
   version swap is never silent skew and I can always reach the bootstrap dorfl.
6. As someone onboarding a repo, I want `setup` to OFFER to declare `dorflCmd`, so a fresh
   repo is reproducible by default rather than retrofitted. (Landed.)

## Out of Scope

- **Any version RESOLUTION / download / cache** (a `dorflVersion` field, a
  `~/.dorfl/versions/<v>/` store, integrity/offline handling). `dorflCmd` is a command
  the repo's environment already resolves; a user who wants a pinned version writes `npx
  dorfl@<version>`. dorfl never re-implements a package manager.
- **A trust gate for `dorflCmd`.** Honoured verbatim, same trust as the existing `verify`
  command (see Solution §3). No `--trust-dorfl-cmd`, no untrusted-origin special-casing.
- **Pinning the AGENT HARNESS version** (`pi`) — this pins DORFL itself; the harness is a
  separate axis (`piBin`/`agentCmd`), a separate future concern.
- **`work/protocol/` doc sync** — `dorfl sync` already owns the DOCS; this pins the
  EXECUTABLE. The upgrade ritual documents their alignment; sync is not re-implemented.
- **Auto-UPGRADING a repo's `dorflCmd`** — a deliberate, human-bumped, reviewable value
  (like any pinned version); nothing here auto-advances it.

## Further Notes (provenance)

- Born from a live investigation (2026-07-20/21): rocketh's CI floated the dorfl version
  because it declared no pin, so `npm install -g dorfl` ran latest. The existing
  `install-ci` resolver shim (task `install-ci-prefer-project-local-dorfl`) already
  implements the CI half JS-specifically; this generalises it (any project type) AND
  extends it to the laptop's bare `dorfl`.
- Precedent for "config names an executable": `agentCmd`/`piBin`/`harness` are
  GLOBAL-config-only (a per-repo `dorfl.json` is a deliberate subset that cannot set
  them). `dorflCmd` is the deliberate exception (Solution §3): it is about WHICH dorfl
  runs, it is announced, and it carries no more trust than the committed `verify` command
  the repo already runs.
- Complementary command: `dorfl sync` (pins the `work/protocol/` docs). `dorflCmd` + sync
  together keep CLI, docs, and CI workflow YAML aligned.
