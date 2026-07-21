---
title: setup / install-ci could PROMPT for the project-setup hook (package-manager provisioning) — like the changeset nudge
type: idea
status: incubating
created: 2026-07-21
---

## The idea

When onboarding a repo (`setup`) or wiring CI (`install-ci`), dorfl could ASK once
whether the repo needs a project-setup hook — i.e. steps to provision its OWN
package manager + install deps + any history fixup — so the emitted `dorfl-setup`
CI action is self-sufficient for the repo's `verify` gate. This mirrors setup's
existing language-agnostic **per-change-convention nudge** (changesets) and the
**dorflCmd pin nudge**: ASK, record, never auto-detect.

## Why (the pain it removes)

Live on rocketh (2026-07-21): its `verify` gate is all `pnpm ...`, but `dorfl-setup`
provisions only Node+dorfl+pi (the documented toolchain boundary). So the GitHub
`verify` check died at `pnpm: command not found`, then at `changeset status
--since=main` (no local `main` on a detached PR checkout). Both are the
"documented, not detected" boundary biting a real repo. The remedy exists (the
project-setup hook, `projectSetup.<provider>`) but nothing PROMPTS the user to set
it, so it is discovered only by a red CI check. See `docs/ci/README.md` \u2192 "Writing
a CI-safe verify gate" (the pitfalls are now documented) and the rocketh
observations `verify-ci-fails-pnpm-not-found-...` / `verify-gate-changeset-status-fails-on-the-version-pr-...`.

## Shape (respecting the ADR)

Must stay within ADR `install-ci-project-provisioning-native-passthrough`
("documented, not detected; opaque native-syntax pass-through; no portable DSL"):

- **ASK, do not auto-detect the stack.** e.g. "Does your `verify` gate need a
  package manager / dependency install / codegen that dorfl-setup won't provide?
  Paste the native CI steps and I'll splice them in as the project-setup hook."
  (Could OFFER a common template on request \u2014 "a pnpm setup?" \u2014 but only as a
  suggestion the human confirms, never keyed off a lockfile, per the A3 rule.)
- Record the answer as `projectSetup.<provider>` in the install-ci config so a
  re-run preserves it; the adapter already splices it verbatim FIRST.
- Optionally, a light **check** at onboarding: if `dorfl.json` `verify` mentions a
  package manager (`pnpm`/`npm`/`yarn`/`bun`) AND no project-setup hook is
  configured, WARN (not error) with a pointer to the CI doc. This is a heuristic
  hint, not detection-driving-injection \u2014 it only surfaces a likely gap for the
  human to decide, keeping the boundary human-owned.

## Not this (rejected)

- Making `dorfl verify` run `prepare` \u2014 rejected by the verify-only design
  (env-ready is a separate concern; the standalone gate stays pure).
- Auto-detecting the package manager and injecting an install step \u2014 violates the
  ADR's documented-not-detected principle.

## Status

Pitfalls now DOCUMENTED (`docs/ci/README.md`). This idea is the next rung: turn
the documentation into a PROMPT so the gap is caught at onboarding, not by a red
CI check. Pre-spec; needs the `runner-in-ci` / `install-ci` CLI to exist to host
the prompt.
