---
'dorfl': minor
---

Point the build agent at the repo's conventions doc so gate-enforced per-change rules (e.g. changesets) aren't silently skipped.

The `CLAIM-PROTOCOL.md` work-agent wrapper (the in-band prompt every build agent receives) told the agent to satisfy the task's acceptance criteria and make `verify` green, but never to READ the repo's STANDING per-change conventions — the rules EVERY change must follow regardless of the task (add a changeset, a CHANGELOG entry, regenerate a manifest, …). `setup` already elicits these and records them under `## Conventions` in `CONTEXT.md`, but the build agent was never steered to read them, so a convention the `verify` gate enforces (classically: a package changed with no changeset) would pass the agent's own build yet BOUNCE the item at LAND time — an opaque failure the agent could not see coming.

The wrapper now instructs the agent, right before it stops, to read the repo's conventions doc (`CONTEXT.md`'s `## Conventions`, and `AGENTS.md` if present) and satisfy any standing rule that applies, noting that several are gate-enforced and skipping one bounces the item at land time even when the task's own code is correct. This is generic (any convention, any repo), not changeset-specific — dorfl points at the doc; the repo's `CONTEXT.md` owns the specifics. Mirrored byte-identically into `skills/setup/protocol/` (source of truth) and `work/protocol/` (this repo's copy), and re-vendored into the published CLI.
