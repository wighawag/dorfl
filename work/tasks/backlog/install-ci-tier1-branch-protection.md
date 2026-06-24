---
title: `install-ci` auto-configures Tier-1 GitHub branch protection when admin token present, else prints fallback
slug: install-ci-tier1-branch-protection
prd: land-time-reverify-and-parallel-merge-ceiling
blockedBy: []
covers: [11]
---

## What to build

Teach `install-ci` (already a verb in the runner) to auto-configure the
Tier-1 GitHub ceiling when run with an admin-scoped credential, and to
fall back to printing the exact ready-to-run command + manual
instructions when only the ambient `GITHUB_TOKEN` is available.
Behaviour fixed at launch (Applied Answer / Implementation Decision in
the prd; the verified finding `install-ci-can-set-branch-protection-
via-api-but-needs-admin-token-not-ambient-github-token`).

The API call to make (one of):

- `PUT /repos/{owner}/{repo}/branches/{branch}/protection` with
  `required_status_checks: { strict: true, checks: [{ context: "verify" }] }`
  — `strict: true` IS verbatim "require branches up to date before
  merging".
- The equivalent ruleset (`POST .../rulesets`), which also leaves a
  forward seam for the Tier-2 `merge_queue` rule (deferred per Applied
  Answer q3).

Required behaviour:

- AUTO-CONFIGURE when an admin-scoped credential is available; generate
  the `context` value to MATCH the workflow `install-ci` itself emits
  (no mismatched required check).
- ORDER the operation so a never-run required check cannot deadlock all
  merges — either run the check once before requiring it, or use a
  ruleset `do_not_enforce_on_create` toggle. Pick one and justify.
- When only the ambient `GITHUB_TOKEN` is present (never admin), DO
  NOT attempt the call; PRINT the exact `gh api` command that would
  have run plus a one-liner pointing to the manual UI fallback.
- The wizard / credential provisioning itself is OUT OF SCOPE (owned by
  `runner-in-ci`); this task implements WHAT is provisioned + the
  ordering guard.
- Leave the ruleset shape extensible so the Tier-2 `merge_queue` rule
  can be added by a follow-on prd without re-architecture.

## Acceptance criteria

- [ ] `install-ci` detects the credential's scope; with admin scope it
      makes the API call(s); without, it prints the exact `gh api`
      command and the manual fallback instructions.
- [ ] The required check `context` always matches the emitted
      workflow's job name (verified by a test that diffs the two).
- [ ] The deadlock-on-never-run-check is guarded against by the chosen
      ordering mechanism; the choice is recorded (ADR-worthy if it has
      a real trade-off).
- [ ] Tests isolate global locations per task-template's shared-
      location rule (no real GitHub API calls; mock the HTTP layer or
      use a recorded fixture).
- [ ] Acceptance gate green.

## Blocked by

- None — orthogonal file surface from the engine slices.

## Prompt

> Read Story 11, Implementation Decisions (the install-ci paragraph), and
> the finding `work/notes/findings/install-ci-can-set-branch-protection
> -via-api-but-needs-admin-token-not-ambient-github-token-2026-06-21.md`.
> Locate the existing `install-ci` verb (`advance-install-ci.md` in
> `tasks/done/` will point to it) and add the branch-protection /
> ruleset step. Detect scope by attempting a low-cost admin endpoint or
> by reading the token's documented metadata; pick the cheaper of the
> two and record the choice. Tests must not hit real GitHub. Run the
> AGENTS.md acceptance gate.
