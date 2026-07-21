---
title: `dorflCmd` is repo-settable — the deliberate exception to the host-only machine-command rule (ADR §13)
status: accepted
created: 2026-07-21
decided: 2026-07-21
supersedes:
superseded_by:
---

# ADR: `dorflCmd` is repo-settable (the deliberate exception to host-only)

## Context

Bare **`dorfl`** is the taught, project-independent command (a Rust/Go/Python
repo has no `node_modules/.bin/dorfl`, so `pnpm dorfl`/`npx dorfl` in the
protocol's taught commands would leak a JS assumption). But bare `dorfl` runs
**whatever version is globally installed**, which drifts: a laptop on one version,
CI floating to latest via `npm install -g dorfl`, a repo reasoned-about under a
third. The spec `dorfl-self-version-pinning-and-bootstrap-forward` closes this by
making the global `dorfl` a thin BOOTSTRAP that self-forwards to a repo-declared
command. Its config half is a single new field: **`dorflCmd`** — the exact command
string bare `dorfl` forwards to (`"node_modules/.bin/dorfl"`, `"npx dorfl@0.7.0"`,
`"./bin/dorfl"`, `"mise exec dorfl@0.7.0 --"`, …), honoured verbatim (no version
resolution, no download, no shell-splitting at the config layer).

The tension this ADR resolves: **`dorflCmd` names which executable runs**, which is
definitionally the same *class* of key as the machine-command keys the per-repo
config layer already **rejects**. Today `repo-config.ts` keeps
`agentCmd`/`piBin`/`sessionsDir` in `REPO_REJECTED_KEYS` under the sharpened
host-only principle (`execution-substrate-decisions.md` §13):

> a host-only key must come from a **per-machine** source — a CLI flag, an
> `DORFL_*` env var, or the global config file — **never** the committed repo
> file, because a committed repo file must not redirect where the host runs/writes.

By that rule, a key that names an executable-to-run belongs on the reject list.
Making `dorflCmd` **repo-settable** (adding it to `REPO_ALLOWED_KEYS`, where
`verify`/`prepare` live) therefore REVERSES the host-only rule for this one key.
That reversal is hard-to-reverse, surprising-without-context, and a genuine
trade-off — the ADR bar — so it is recorded here rather than buried in a JSDoc.

## Decision

**`dorflCmd` is in `REPO_ALLOWED_KEYS`, not `REPO_REJECTED_KEYS`** — a per-repo
committed `dorfl.json` MAY declare it, and it is honoured (subject only to the
same layered precedence every allowed key uses: flag > env `DORFL_DORFL_CMD` >
per-repo > global > default unset). The machine-command keys
`agentCmd`/`piBin`/`sessionsDir` stay REJECTED — this exception is scoped to the
single key `dorflCmd` and does not loosen the host-only rule for anything else.

### Why the exception is justified (the three reasons)

1. **Purpose is repo-declared REPRODUCIBILITY.** Unlike `piBin`/`agentCmd`
   (which redirect where THIS HOST runs its harness — a per-machine concern),
   `dorflCmd`'s entire point is that the REPO decides which dorfl it is
   built/advanced/intaked with, so all collaborators + CI + the laptop converge
   on one version. That is exactly the "agreed by all collaborators, travels with
   the repo" property that defines an allowed per-repo key — the SAME reason
   `verify`, `integration`, and `model` are repo-settable.

2. **No new trust.** `dorflCmd` is honoured verbatim from the committed
   `dorfl.json` at the SAME trust level dorfl already grants the committed
   `verify` command — itself an arbitrary shell command run from `dorfl.json`.
   Running `dorfl` in a repo already means trusting that repo's `dorfl.json`;
   `dorflCmd` introduces no new trust class. There is deliberately **NO trust
   gate** (no `--trust-dorfl-cmd`, no untrusted-origin special-casing) — see the
   spec's Out of Scope.

3. **Announced, not silent.** The forward prints a one-line **stderr** notice
   (e.g. `dorfl: forwarding to \`npx dorfl@0.7.0\` (from ./dorfl.json)`) and is
   opt-outable (`DORFL_NO_FORWARD=1` / `--no-forward`) — the mitigation a silent
   `piBin` redirect lacks. A user can always see the forward happen and reach the
   bootstrap dorfl directly. (The announce + opt-out land in the FORWARD task
   `dorfl-bootstrap-self-forward`, not here — this ADR + task add only the field.)

## Scope of this ADR / task

This ADR governs the CONFIG decision only: that `dorflCmd` is a parsed, validated,
repo-settable field. It does NOT decide the forwarding behaviour, the stderr
announce, the fail-loud-on-broken-`dorflCmd` policy, or the `--no-forward`
bypass — those are the FORWARD task's (`dorfl-bootstrap-self-forward`) to specify
and are recorded when built.

Validation at this layer (`validateDorflCmdConfig`, called at the same resolution
final points as `validateDeadlineConfig`): a non-string value FAILS LOUD with a
clear message (the config layer's existing fail-loud path); a string is TRIMMED
and carried verbatim; empty/whitespace-only resolves to UNSET (never an error, so
the bootstrap runs itself and onboarding is never chicken-and-egg).

## Considered options

- **Put `dorflCmd` in `REPO_REJECTED_KEYS` (host-only, like `piBin`).** Rejected:
  it would defeat the entire spec — a repo could not declare which dorfl it runs,
  which is the whole point. The host-only rule exists to stop a committed file
  redirecting the host's harness/paths silently; `dorflCmd`'s redirect is the
  DESIRED, announced, reproducibility-serving behaviour, not a silent hijack.
- **Add a trust gate for `dorflCmd`.** Rejected (spec §3 / Out of Scope): it
  carries no more trust than the already-trusted `verify`; a gate would be
  inconsistent and add friction with no security gain.
- **A version field (`dorflVersion`) + dorfl resolving/downloading it.** Rejected
  (spec Out of Scope): dorfl never re-implements a package manager; a version is
  expressed by the user writing `npx dorfl@<version>` in `dorflCmd` themselves.

## Consequences

- `REPO_ALLOWED_KEYS` gains exactly one machine-command key (`dorflCmd`); the
  allow/reject split's host-only invariant is otherwise intact and the disjoint-set
  test still holds.
- ADR §13 (`execution-substrate-decisions.md`) carries a back-reference to this
  ADR at its host-only bullet, so a future reader sees a DECISION, not an oversight.
- The `Config.dorflCmd` field JSDoc cross-references this ADR at the choice site.
- Cross-refs: `dorfl-self-version-pinning-and-bootstrap-forward` (the spec, §1/§3),
  `execution-substrate-decisions.md` §13 (the host-only rule this excepts),
  `config.ts` (`Config.dorflCmd` + `validateDorflCmdConfig`),
  `repo-config.ts` (`REPO_ALLOWED_KEYS`), `env-config.ts` (`DORFL_DORFL_CMD`),
  and the future FORWARD task `dorfl-bootstrap-self-forward` (exec + announce).
