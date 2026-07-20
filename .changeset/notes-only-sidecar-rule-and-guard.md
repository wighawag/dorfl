---
'dorfl': minor
---

Scope the `<slug>/` asset-sidecar rule to `notes/*` ONLY, and ENFORCE it at land.

WORK-CONTRACT.md rule 8 previously allowed a co-located `<slug>/` asset sidecar for ANY bucket (`notes/`, `tasks/`, `specs/`). That is unsafe for the FLOWING regimes: a task moves `tasks/ready → tasks/done` and a spec moves `specs/ready → specs/tasked`, and a co-located sidecar (which shares the item's lifecycle) must be `git mv`'d in lockstep on every transition — in practice it gets STRANDED, splitting one item across two status folders (a one-slug-one-folder violation). Rule 8 now reads: a `<slug>/` sidecar is for `notes/*` only (they leave by deletion, so the sidecar never moves); `tasks/*` and `specs/*` keep durable companion artifacts (a patch, a build/measurement script, a diagram) in the STABLE, non-flowing `docs/spikes/<slug>/` home and REFERENCE them by path. Carve-outs are stated explicitly: transient BUILD scratch belongs OUTSIDE the repo, and the `work/questions/<type>-<slug>.md` needs-attention file is a status-mechanism file, not an item sidecar.

The build-agent prompt wrapper (CLAIM-PROTOCOL.md `## Prompt`) now instructs agents to write durable/reusable artifacts to `docs/spikes/<slug>/` and never to create a `work/tasks/<slug>/` / `work/specs/<slug>/` sidecar.

A new GUARD (`sidecar-guard.ts`) detects a `<slug>/` directory co-located with a flowing `tasks/*` / `specs/*` item and HARD-BLOCKS it at LAND (in `performIntegration`, before the durable `git mv`), routing the item to needs-attention with an actionable "relocate to `docs/spikes/<slug>/` and reference by path (WORK-CONTRACT rule 8)" message — surfaced via the same seam a red gate uses (`sidecar-violation` outcome across `complete`/`run`/`do spec:`). A `notes/*` sidecar, the `work/questions/*` file, and any `docs/spikes/<slug>/` outside `work/` all pass with no false positive.
