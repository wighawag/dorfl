---
title: Untrusted origin forces the becomes-code checkpoint — fail-loud at the CLI front door, fail-safe when reading a file, and the rule follows the build wherever it retries
status: accepted
created: 2026-06-15
decided: 2026-06-15
supersedes:
superseded_by:
---

# ADR: Untrusted-origin build-propose rule — its two surprising edges

## Context

The task `untrusted-origin-forces-build-propose` closes a trust-laundering gap:
an issue from an untrusted author is gated at the CI front door (forced
`--propose` on the emitted prd/task), but once that artifact lands on `main`,
its untrusted origin used to be invisible — a later autonomous tick treated it as
trusted in-boundary work. The task persists origin-trust provenance
(`origin`/`originTrust` frontmatter), propagates it prd → task, and makes the
**build** transition resolve to `propose` for untrusted-origin work even when the
configured mode is `merge` (an explicit `--merge` overrides — the operator is
present).

That core decision was specified by the task. Two edges were NOT specified and
were decided at build time; both are easy to "fix" in the wrong direction by a
future reader who does not know why, so they are recorded here.

## Decision

### 1. The two trust layers fail in OPPOSITE directions, on purpose

- **`--origin-trust` at the CLI fails LOUD.** A malformed value (anything other
  than `trusted`/`untrusted`) prints an error and exits non-zero rather than
  coercing to a default. This flag is produced by the **CI shell** (a machine
  deriving it from `author_association`), so a bad value is a bug in our own
  policy code — and silently defaulting it would launder the very trust signal
  this task exists to preserve. A CI typo must surface as a red run, never as a
  quietly-trusted untrusted author.

- **The `originTrust` frontmatter field reads FAIL-SAFE.** An unknown/absent
  stamped value parses to `undefined ⇒ trusted` (the normal, no-friction path);
  the build-propose rule only tightens on an explicit `originTrust: untrusted`.
  This field is read from a file a human may have hand-edited, so it degrades to
  the safe, non-blocking reading.

Strict at the machine front door, lenient at the human-editable file: each layer
fails in the direction that does not compromise trust. The asymmetry is
deliberate, not an oversight.

### 2. The build-propose rule follows the build wherever it integrates from — including `needs-attention/`

The rule reads `originTrust` from whichever source folder the build actually
integrates from (`work/in-progress/` OR `work/needs-attention/`), not only
`in-progress/`. An untrusted task's risk is intrinsic to its origin and does not
decrease on a retry; if the rule only fired from `in-progress/`, a task that
bounced to `needs-attention/` and was re-driven would silently lose its human
checkpoint on the retry — exactly when the work has already shown it needs
attention. Attaching the checkpoint to the work for its whole lifecycle is the
conservative choice: it can only force MORE human review, never less.

## Consequences

- A CI policy bug that emits a bad `--origin-trust` value fails visibly instead of
  defaulting; this is intended and should not be "softened" to a fallback.
- Re-driving an untrusted-origin task from `needs-attention/` under a `merge`
  config still proposes (a PR), never auto-merges, unless the operator passes an
  explicit `--merge`. This is the same rule as the first attempt, applied
  consistently.
- The normal human path (unset provenance ⇒ trusted) is unaffected by both edges.
