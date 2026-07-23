---
title: 'Add the `dorflCmd` config field (the repo-declared dorfl command)'
slug: dorfl-cmd-config-field
spec: dorfl-self-version-pinning-and-bootstrap-forward
blockedBy: []
covers: [2]
---

## What to build

A new OPTIONAL per-repo config field, `dorflCmd`, in `dorfl.json`: a single COMMAND
STRING naming the dorfl executable a repo runs with (e.g. `"node_modules/.bin/dorfl"`,
`"npx dorfl@0.7.0"`, `"./bin/dorfl"`, `"mise exec dorfl@0.7.0 --"`). It is honoured verbatim
— there is NO version parsing, NO `dorflVersion`, NO download/resolution (a version is
expressed by the user writing `npx dorfl@<version>` themselves).

This task adds ONLY the field + its parsing + validation + exposure through the config
resolution, so a later task (`dorfl-bootstrap-self-forward`) can read it.

**`dorflCmd` is a DELIBERATE, ADR-RECORDED exception to an EXISTING host-only
principle.** Today `repo-config.ts` keeps a `REPO_REJECTED_KEYS` list that REJECTS
"machine PATH/command" keys from a per-repo `dorfl.json` — `agentCmd`, `piBin`,
`sessionsDir` — with the stated rationale (ADR §13) that *a committed repo file must NOT
redirect where the host runs/writes*. `dorflCmd` is definitionally in that same class (it
names which executable runs), so making it repo-settable REVERSES that principle for this
one key. That reversal is hard-to-reverse + surprising-without-context + a real
trade-off — the ADR bar — so it MUST be recorded as an ADR, not buried in a JSDoc. The
justification to record: `dorflCmd`'s PURPOSE is repo-declared reproducibility (the repo
SHOULD decide which dorfl it runs); it carries no more trust than the committed `verify`
command the repo already runs (which IS in `REPO_ALLOWED_KEYS`); and unlike a silent
`piBin`, the forward is ANNOUNCED on stderr (see `dorfl-bootstrap-self-forward`). There is
NO trust gate.

## Acceptance criteria

- [ ] `dorfl.json` accepts an optional `dorflCmd` string; it is parsed and exposed on the
      resolved repo config (readable by other modules without re-parsing the file).
- [ ] An absent/empty/whitespace-only `dorflCmd` resolves to "unset" (no forward — the
      bootstrap runs itself), never an error.
- [ ] A non-string `dorflCmd` (number/array/object) is a clear config parse warning/error
      consistent with how the config layer already reports a malformed key — not a crash.
- [ ] The value is carried verbatim (no shell-splitting, no normalisation at this layer —
      the forward task owns exec semantics); trailing/leading whitespace is trimmed.
- [ ] Unlike the `REPO_REJECTED_KEYS` machine-command keys (`agentCmd`/`piBin`/
      `sessionsDir`), `dorflCmd` IS accepted from a per-repo `dorfl.json` — it is added to
      `REPO_ALLOWED_KEYS` (where `verify`/`prepare` already live), NOT `REPO_REJECTED_KEYS`.
      A test asserts a repo-set `dorflCmd` survives resolution while the existing
      `agentCmd`/`piBin`/`sessionsDir` rejections are UNCHANGED (no regression to the
      host-only reject list).
- [ ] **An ADR is written** in `docs/adr/` recording why `dorflCmd` is repo-settable
      despite being a machine-command key that ADR §13 otherwise keeps host-only — the
      reproducibility purpose, the `verify`-trust parity, and the announced-not-silent
      mitigation. Cross-reference it from the JSDoc at the field and (if present) from the
      §13 reasoning, so a future reader sees a decision, not an oversight.
- [ ] Tests cover: set/unset/empty/malformed, and the repo-config acceptance.
- [ ] Tests isolate any temp `dorfl.json` fixtures in a scratch dir; no shared location
      is written.

## Blocked by

- None — can start immediately.

## Prompt

> Add an optional `dorflCmd` string field to dorfl's config so a repo's `dorfl.json` can
> declare the exact dorfl COMMAND that repo runs with. This is the config half of the
> `dorfl-self-version-pinning-and-bootstrap-forward` spec — read that spec's Solution §1
> and §3.
>
> Look in the config layer (`config.ts` — the `Config` shape + defaults + the per-parse
> warn seam) and the per-repo layer (`repo-config.ts` — `resolveRepoConfigPath`,
> `REPO_CONFIG_FILENAME`, and the two lists `REPO_ALLOWED_KEYS` / `REPO_REJECTED_KEYS`
> that decide which keys a per-repo `dorfl.json` may set). Today the REJECTED list holds
> the machine-command keys `agentCmd`/`piBin`/`sessionsDir` (ADR §13: a committed repo
> file must not redirect where the host runs). `dorflCmd` is the deliberate EXCEPTION —
> ADD it to `REPO_ALLOWED_KEYS` (where `verify`/`prepare` already live), NOT to the
> rejected list, so the repo declares which dorfl it runs. Because this REVERSES the §13
> host-only rule for one key, WRITE AN ADR (`docs/adr/`) recording the why (repo-declared
> reproducibility; same trust as the committed `verify`; the forward is ANNOUNCED, unlike
> a silent `piBin`), and cross-reference it from a JSDoc at the field. There is NO trust
> gate.
>
> This task is JUST the field: parse it, validate it (string; unset/empty ⇒ absent, not an
> error; malformed ⇒ the config layer's existing warn/error path), trim whitespace, carry
> it verbatim (no shell-splitting here — the forward task owns exec). Do NOT implement the
> forwarding, the announce, or the `--no-forward` flag here (that is
> `dorfl-bootstrap-self-forward`). Mirror the existing test style for a config field
> (set/unset/malformed + the repo-subset acceptance). Run `pnpm format && pnpm -r build &&
> pnpm -r test` before finishing, and per CONTEXT/AGENTS add a changeset.
