---
title: 'GitHub Actions: a job output cannot carry a secret to a matrix leg, but a workflow run is a real artifact boundary'
slug: github-actions-job-output-key-and-per-run-artifact-isolation
source: 'measured by docs/spikes/ci-handoff-key-delivery/ (workflows + evaluate.sh) against GitHub-hosted ubuntu-latest runners in the public throwaway repository wighawag/dorfl-spike-handoff-key @ 316d3ba, runs 36304966476 to 36305462049 on 2026-09-27; concurrency queue semantics from docs.github.com "Control the concurrency of workflows and jobs", retrieved 2026-09-27'
---

# A job output is not a private channel; a workflow run is an artifact boundary

This finding is LOAD-BEARING for spec `ci-agent-job-without-write-token` decision 1: it is why dorfl's CI runs one workflow run per item instead of binding a matrix leg's handoff artifact with a per-leg key.

## What holds (measured)

- **A value a job receives through `env:` is printed in its log.** Both a step-level and a job-level `env:` value appear verbatim in the step's log header ("Run ..." group). The no-`${{ }}`-in-`run:` rule forces every value through `env:`, so a dorfl job has no unprinted way to receive a job output.
- **A masked value cannot travel as a job output.** If a value was registered with `::add-mask::`, the output is dropped with `Skip output '<name>' since it may contain secret.` and dependent jobs receive an empty string. An unmasked output arrives intact.
- **Public repository logs are readable by any authenticated account** (anonymous REST access returns 403). The REST job-logs endpoint serves a job's log only once that job completes; the web UI's live log stream was not measured.
- **Consequence:** a per-leg key delivered through `needs.<job>.outputs` is visible in the logs of every job that consumes it. Its secrecy would rest on timing races, not on structure, so it cannot bind an artifact to a matrix leg.
- **`ACTIONS_RUNTIME_TOKEN` is not in a `run:` step's environment, but a shell step can recover it.** `sudo` plus a read of `/proc/<Runner.Worker pid>/mem` returned the same JWT a JavaScript action receives. An agent with a shell on a GitHub-hosted runner therefore holds the artifact service credential of its own job.
- **That token is scoped per run and per job** (the claim is measured; that the artifact service enforces it is inferred, see Not measured). Its `scp` claim is `Actions.Results:<run uuid>:<job uuid> Actions.Runner:<run>:<job> Actions.UploadArtifacts:<run>:<job> Actions.GenericRead:<...>`, and the run uuid differs between runs. Two runs can each upload an artifact with the same name without colliding.
- **`GITHUB_TOKEN` with `actions: write` can dispatch `workflow_dispatch` runs** (`gh workflow run`); the dispatched runs start.
- **`concurrency.queue: max` queues instead of cancelling.** Three runs dispatched 3 seconds apart into one group with `queue: max` all completed, strictly one at a time (the second and third waited 26 and 48 seconds after their dispatch before starting). The documented default (`queue: single`) keeps at most one pending run and cancels the one it replaces.

## What this implies for dorfl

- Within one workflow run, every leg of a matrix shares one artifact namespace, and each leg's agent can reach a token that writes to it. Nothing a leg receives can be kept secret from the other legs' agents through GitHub's own channels.
- Across workflow runs, the artifact namespace and the runtime token's scope are separate. Running each item in its own workflow run makes "this artifact came from this item's agent job" a property GitHub enforces, with no key.
- A parallelism cap across per-item runs can be built from N concurrency groups with `queue: max` (up to 100 pending runs per group), since a group runs one at a time.

## Not measured

- Whether a non-collaborator can watch a running job's log live in the web UI (needs a second account). It does not change the conclusion.
- Whether a `with:` input to an action is printed in the step log like an `env:` value (GitHub's step header suggests so; dorfl does not rely on it, because its jobs receive values through `env:`).
- Whether the artifact service rejects an upload or delete that names another run's ids with this run's token. The token's `scp` claim is scoped to this run's ids, which is the documented design, but no forged request was sent.
