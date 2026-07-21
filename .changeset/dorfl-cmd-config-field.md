---
'dorfl': minor
---

Add the optional `dorflCmd` config field — the repo-declared dorfl COMMAND.

A repo's committed `dorfl.json` may now declare `dorflCmd`: the exact dorfl command that repo runs with (e.g. `"node_modules/.bin/dorfl"`, `"npx dorfl@0.7.0"`, `"./bin/dorfl"`, `"mise exec dorfl@0.7.0 --"`). This is the config half of the `dorfl-self-version-pinning-and-bootstrap-forward` spec: a later task makes bare `dorfl` (a thin bootstrap) self-forward to it, so the taught, project-independent `dorfl` command becomes reproducible + repo-owned instead of floating with whatever global dorfl a machine happens to have. This task adds ONLY the field — parse, validate, and expose it through the config-resolution chain; the forwarding/announce/opt-out land in `dorfl-bootstrap-self-forward`.

The field is honoured verbatim (no version parsing, no download/resolution, no shell-splitting — a version is expressed by writing `npx dorfl@<version>` yourself). It is optional with no default: unset/empty/whitespace-only ⇒ absent (the bootstrap runs itself, never an error); leading/trailing whitespace is trimmed; a non-string value fails loud at config load. It resolves per-repo through the standard chain (flag > env `DORFL_DORFL_CMD` > per-repo `dorfl.json` > global > default unset).

Unlike the host-only machine-command keys `agentCmd`/`piBin`/`sessionsDir` (kept in `REPO_REJECTED_KEYS` per `execution-substrate-decisions.md` §13 — a committed repo file must not redirect where the host runs), `dorflCmd` IS repo-settable (added to `REPO_ALLOWED_KEYS`). This deliberate reversal of the host-only rule for one key — because its purpose is repo-declared reproducibility, it carries no more trust than the committed `verify` command the repo already runs, and the forward is announced, not silent — is recorded in a new ADR (`dorfl-cmd-repo-settable-exception-to-host-only.md`), cross-referenced from the field's JSDoc and from ADR §13. There is no trust gate.
