---
title: 'Re-gate a merge-mode land that lost its race, instead of only reporting it'
slug: regate-a-merge-land-that-lost-its-race
type: idea
status: incubating
---

# Re-gate a merge-mode land that lost its race

Captured 2026-09-28. ADR `ci-agent-job-holds-no-write-token` decision 2 says "Re-running the agent phase on a lost race is recorded as a follow-up idea", but the note was never written (observation `regate-on-lost-race-follow-up-idea-never-filed-2026-09-28`). This is it.

## The gap

In merge mode the land's CAS loop re-rebases and retries the push after a lost race, but never re-runs the gate. After the CI split the gate runs in the agent job minutes before the apply job pushes, so with parallel item runs most merge-mode lands are re-rebased after the gate: they land a tree the gate never saw. Today that is made visible (the `Landed-Without-Regate` trailer and the apply job's output line, task `ci-split-landed-vs-gated-report`), not prevented.

## Shapes worth weighing

- **Re-dispatch instead of landing.** When the apply job loses its first race and the re-rebased tree differs from the gated one, do not land: push the re-rebased branch, release, and let the next tick run the item again (a fresh lock, agent and apply at the new tip). Costs a whole item run per lost race; converges only if races are not constant.
- **A gate-only job.** A fourth job with a read token re-runs only `prepare` + `verify` on the re-rebased tip, and the apply job lands only a tree some job gated. Keeps the build agent out of it, but adds a round trip between write and read jobs per retry, and the tip can move again.
- **Serialise merge-mode lands** (one slot for merge mode), so the gated tree is usually the landed tree. Simple, gives up parallelism.
- **Accept and report** (today): propose mode is unaffected, and merge mode trades the guarantee for throughput knowingly.

Worth deciding before anyone relies on merge mode with `maxParallel` above 1.
