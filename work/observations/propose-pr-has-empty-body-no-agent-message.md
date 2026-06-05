---
title: propose-mode opens a PR with an EMPTY body — no agent summary of what it built / decided
type: observation
status: spotted
spotted: 2026-06-05
---

# `propose` opens a PR with no description — the agent leaves no message

## What was spotted

Running the first real phase-2 slice via `ar-run.sh registry-remote --propose`
opened **PR #1** (`work/registry-remote`). The PR `body` is **empty (`""`)** \u2014 the
only human-facing text is the title (derived from the commit message subject:
`feat(registry-remote): the registry IS the hub-mirror set ...; done`).

The agent built **26 files (+1731 / -559)**, made non-trivial design choices (the
bare-mirror read via `git ls-tree`/`show`, the transport guard on the `org/name`
project-identity tail, reading `origin` via `get-url` because the key is lossy),
and **left no message on the PR** \u2014 no summary, no "what I built", no "decisions I
made", no "what to look at when reviewing".

## Why it matters

`propose` mode exists precisely so a HUMAN reviews before `main` moves (the safe
default, ADR §6/§11). But a reviewer landing on a 26-file PR with an empty body has
to reverse-engineer intent from the diff alone. The integration seam pushes a
branch + opens the request, but does NOT have the agent author a description \u2014 so
the review affordance is weaker than it should be. The information exists (the
agent reasoned about it in its session) but is discarded at PR-open time.

## Direction (NOT yet sliced \u2014 a candidate for the integration seam)

The `propose` path (the GitHub provider's `openRequest`, and the seam generally)
should let the agent supply a PR BODY \u2014 e.g.:

- a short **summary of what was built** (the slice's intent, in the agent's words);
- **key decisions / deviations** worth a reviewer's attention (the kind of thing
  that ended up in this slice's CRITICAL sections);
- a pointer back to the **slice file** (`work/done/<slug>.md`) and the PRD/ADR it
  serves, so the reviewer can check the work against its spec;
- optionally, anything the agent was UNSURE about (a "please check X" flag) \u2014 a
  lightweight, in-PR version of the needs-attention surfacing.

Open questions for whoever slices this:

- **Source of the body:** does the build agent EMIT a structured summary (it does no
  git, so the runner would capture the agent's final message / a designated block
  and pass it to the provider), or does the runner synthesise it from the slice file
  + the diff? The agent-authored summary is richer but needs a clean hand-off
  channel (the agent writes no git, so it must hand the text to the runner).
- **Provider seam shape:** the `none`/`github` providers' `openRequest` would take an
  optional `body`; `gh pr create --body` for GitHub, ignored/printed for `none`.
- **Determinism / safety:** the body is advisory prose (no trust-boundary role), so
  a model-authored body is fine \u2014 unlike the gate, it gates nothing.

## Why an observation, not a work item

Spotted in real use, not yet verified as the best design (agent-emitted vs
runner-synthesised is open). It is a genuine gap in the `propose` UX worth a future
slice against the integration seam. Captured so the empty-PR-body gap is not
forgotten. Delete once a "PR body / agent message" capability lands.
