# Spike: can a per-leg key bind a CI handoff artifact to its matrix leg?

Evidence for decision 1 of spec `ci-agent-job-without-write-token`. The knowledge (what we concluded and why) lives in `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`; this folder holds the probe and its raw results.

## What was run

A throwaway public repository, `wighawag/dorfl-spike-handoff-key` (final commit `316d3ba`), on GitHub-hosted `ubuntu-latest` runners, on 2026-09-27. The workflow files in `workflows/` are copied verbatim from that repository:

- `matrix.yml` calls `leg.yml` for a two-leg matrix (`a`, `b`). In each leg, `lock` mints two keys (`SPIKEKEY-PLAIN-<leg>-<32 hex>` set as a plain output, `SPIKEKEY-MASKED-<leg>-<32 hex>` registered with `::add-mask::` first), `agent` receives the plain key through a job-level `env:` and a step-level `env:` and then plays the attacker (an `actions: read` token polling the sibling leg's job logs through the REST API every 10 seconds), and `apply` receives both keys through a step `env:`.
- `dispatcher.yml` (`actions: write`) runs `gh workflow run single.yml` twice with `GITHUB_TOKEN`.
- `single.yml` uploads an artifact named `handoff`, decodes the runtime token's `scp` claim inside a JavaScript action, and scans `Runner.Worker` memory from a plain shell step with `sudo` for a JWT carrying an `scp` claim (it prints only the claim).
- `slot.yml` is a workflow-level `concurrency` group with `queue: max`, dispatched three times into the same slot.

`evaluate.sh <owner/repo> <run-id>` downloads a run's log archive and reports which keys appear in which log files, with the random part redacted.

## Results

| question | run | result |
| --- | --- | --- |
| Is a value delivered through a step `env:` printed in the receiving step's log? | 36304966476 | Yes. `STEP_KEY: SPIKEKEY-PLAIN-a-<32hex>` appears in the agent step header, and `KEY: ...` in the apply step header, for both legs. |
| Is a job-level `env:` value printed? | 36304966476 | Yes. `JOB_LEVEL_KEY: SPIKEKEY-PLAIN-<leg>-<32hex>` appears in every step header of the job. |
| Is a masked output passed to dependent jobs? | 36304966476 | No. Warning `Skip output 'key_masked' since it may contain secret.`; both consumers received an empty value (length 0). |
| Is an unmasked output passed? | 36304966476 | Yes, full length in both agent and apply. |
| Does the REST jobs listing expose outputs? | 36304966476 | No. The only `SPIKEKEY` text in the jobs JSON is the step NAME derived from the lock script (`Run k=SPIKEKEY-PLAIN-${LEG}-$(openssl rand -hex 16)`), not a value. |
| Can a sibling read the key through the REST job-logs endpoint while the receiving job runs? | 36305149632 | Not while it is in progress (8 polls, 0 hits); the endpoint serves a job's log once the job completes, and then the key is in it. The web UI's live log stream was not tested (it needs a second, non-collaborator account). |
| Are job logs readable anonymously? | (after the runs) | No: `GET /repos/.../actions/jobs/<id>/logs` without a token returned 403. Any authenticated account can read a public repository's logs. |
| Can `GITHUB_TOKEN` trigger `workflow_dispatch` runs? | dispatcher 36304968238, 36305281238, 36305374956 | Yes, each dispatch created a run. |
| Do two runs uploading the same artifact name collide? | single 36305287659, 36305285996 | No, both succeeded; each artifact belongs to its own run. |
| Is `ACTIONS_RUNTIME_TOKEN` in a `run:` step's environment? | single 36305287659 | No. |
| Can a plain shell step recover the runtime token anyway? | single 36305349616 | Yes: `sudo` plus a read of `/proc/<Runner.Worker pid>/mem` recovered one JWT whose `scp` equals the one the JavaScript action saw. |
| What does that token's scope look like? | single 36305349616 | `Actions.Results:<uuid>:<uuid> Actions.Runner:<uuid>:<uuid> Actions.UploadArtifacts:<uuid>:<uuid> Actions.GenericRead:<uuid>` |
| Is the first uuid per run? (the claim only; enforcement by the artifact service was not tested with a forged request) | single 36305382234 vs 36305380440 | Yes, both the first (run) and second (job) uuids differ between the two runs. |
| Does `queue: max` keep every run in a single-slot group, one at a time? | slot 36305456511, 36305459344, 36305462049 | Yes: dispatched (run `created_at`) at 08:12:11, 08:12:14 and 08:12:17, so all three overlapped; all succeeded, strictly serialised (i1 ran 08:12:15 to 08:12:35, i2 08:12:40 to 08:13:00, i3 08:13:05 to 08:13:25). |
