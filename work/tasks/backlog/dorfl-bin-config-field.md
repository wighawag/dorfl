---
title: Add the `dorflBin` config field (the repo-declared dorfl command)
slug: dorfl-bin-config-field
spec: dorfl-self-version-pinning-and-bootstrap-forward
blockedBy: []
covers: [2, 3]
---

## What to build

A new OPTIONAL per-repo config field, `dorflBin`, in `dorfl.json`: a single COMMAND
STRING naming the dorfl executable a repo runs with (e.g. `"node_modules/.bin/dorfl"`,
`"npx dorfl@0.7.0"`, `"./bin/dorfl"`, `"mise exec dorfl@0.7.0 --"`). It is honoured verbatim
— there is NO version parsing, NO `dorflVersion`, NO download/resolution (a version is
expressed by the user writing `npx dorfl@<version>` themselves).

This task adds ONLY the field + its parsing + validation + exposure through the config
resolution, so a later task (`dorfl-bootstrap-self-forward`) can read it. `dorflBin` is
the DELIBERATE exception to the rule that a per-repo `dorfl.json` cannot set executable
knobs (`agentCmd`/`piBin`): it IS settable from the repo `dorfl.json` (that is the whole
point — the repo declares which dorfl it runs), at the same trust level the repo's
committed `verify` command already carries. There is NO trust gate.

## Acceptance criteria

- [ ] `dorfl.json` accepts an optional `dorflBin` string; it is parsed and exposed on the
      resolved repo config (readable by other modules without re-parsing the file).
- [ ] An absent/empty/whitespace-only `dorflBin` resolves to "unset" (no forward — the
      bootstrap runs itself), never an error.
- [ ] A non-string `dorflBin` (number/array/object) is a clear config parse warning/error
      consistent with how the config layer already reports a malformed key — not a crash.
- [ ] The value is carried verbatim (no shell-splitting, no normalisation at this layer —
      the forward task owns exec semantics); trailing/leading whitespace is trimmed.
- [ ] Unlike `agentCmd`/`piBin`, `dorflBin` IS accepted from the per-repo `dorfl.json`
      (the deliberate exception) — a test asserts a repo-set `dorflBin` survives
      resolution while the existing `agentCmd`/`piBin` repo-subset exclusion is unchanged.
- [ ] Tests cover: set/unset/empty/malformed, and the repo-config acceptance.
- [ ] Tests isolate any temp `dorfl.json` fixtures in a scratch dir; no shared location
      is written.

## Blocked by

- None — can start immediately.

## Prompt

> Add an optional `dorflBin` string field to dorfl's config so a repo's `dorfl.json` can
> declare the exact dorfl COMMAND that repo runs with. This is the config half of the
> `dorfl-self-version-pinning-and-bootstrap-forward` spec — read that spec's Solution §1
> and §3.
>
> Look in the config layer (`config.ts` — the `Config` shape + defaults + the per-parse
> warn seam) and the per-repo layer (`repo-config.ts` — `resolveRepoConfigPath`,
> `REPO_CONFIG_FILENAME`, and the deliberate SUBSET a per-repo `dorfl.json` is allowed to
> set). Today that subset EXCLUDES executable knobs (`agentCmd`/`piBin`) so a cloned repo
> cannot dictate what binary runs; `dorflBin` is the deliberate EXCEPTION — it MUST be
> settable from the repo `dorfl.json` (the repo declares which dorfl it runs), with NO
> trust gate (it carries the same trust as the committed `verify` command the repo already
> runs — see the spec's §3 rationale; note it in a JSDoc at the field so the exception is
> not read as an oversight).
>
> This task is JUST the field: parse it, validate it (string; unset/empty ⇒ absent, not an
> error; malformed ⇒ the config layer's existing warn/error path), trim whitespace, carry
> it verbatim (no shell-splitting here — the forward task owns exec). Do NOT implement the
> forwarding, the announce, or the `--no-forward` flag here (that is
> `dorfl-bootstrap-self-forward`). Mirror the existing test style for a config field
> (set/unset/malformed + the repo-subset acceptance). Run `pnpm format && pnpm -r build &&
> pnpm -r test` before finishing, and per CONTEXT/AGENTS add a changeset.
