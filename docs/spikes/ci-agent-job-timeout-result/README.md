# Spike: what does the apply job see when the agent job times out?

Evidence for decision 5 of ADR `ci-agent-job-holds-no-write-token` (failure and timeout surface the item, a cancel only releases it). The knowledge lives in `work/notes/findings/github-actions-job-timeout-reported-as-cancelled.md`; this folder holds the probe and its results.

## What was run

A throwaway private repository, `wighawag/dorfl-spike-job-timeout-result` (final commit `1636bc5`), on GitHub-hosted `ubuntu-latest` runners (runner version 2.337.0, from the job logs), on 2026-09-27. `probe.yml` (copied verbatim) has an `agent` job with `timeout-minutes: 1` that either exits 1 (`fail`), sleeps 150 seconds (`timeout`), or sleeps 40 seconds and is cancelled by hand with `gh run cancel` (`cancel`). An `apply` job with `needs: agent` and `if: always()` prints `needs.agent.result`, the jobs API view of the agent job, and (second round, with `permissions: {actions: read, checks: read}` on `GITHUB_TOKEN`) the check-run annotations of the agent job.

## Results

| case | run | `needs.agent.result` | jobs API: job and step conclusion | check-run annotations (read in-run with `GITHUB_TOKEN`) |
| --- | --- | --- | --- | --- |
| fail | 36308136019 | `failure` | job `failure`, step `failure` | (not read in round 1) |
| timeout | 36308140757, 36308325623 | `cancelled` | job `cancelled`, step `cancelled` | `failure: The job has exceeded the maximum execution time of 1m0s` and `failure: The operation was canceled.` |
| manual cancel | 36308144907, 36308330127 | `cancelled` | job `cancelled`, step `cancelled` | `failure: The run was canceled by @wighawag.` and `failure: The operation was canceled.` |

The run-level conclusion of both the timeout run and the manually cancelled run was `cancelled`. The only difference visible to the apply job is the annotation text.
