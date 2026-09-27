---
title: 'GitHub Actions reports a timed-out job as cancelled; only its check-run annotation tells a timeout from a manual cancel'
slug: github-actions-job-timeout-reported-as-cancelled
source: 'measured by docs/spikes/ci-agent-job-timeout-result/probe.yml against GitHub-hosted ubuntu-latest runners in the private throwaway repository wighawag/dorfl-spike-job-timeout-result @ 1636bc5, runs 36308136019 to 36308330127 on 2026-09-27'
---

# A timed-out job is `cancelled`; the annotation says why

This finding is LOAD-BEARING for decision 5 of ADR `ci-agent-job-holds-no-write-token` (task `ci-split-agent-result-and-reruns`): it is why the apply job reads the agent job's check-run annotations instead of trusting `needs.agent.result` alone.

## What holds (measured)

- A job that exceeds its `timeout-minutes` ends with `needs.<job>.result == 'cancelled'`, exactly like a job whose run a human cancelled. The jobs API shows `conclusion: cancelled` for the job and its step in both cases, and the run's conclusion is `cancelled` in both. A job that exits non-zero is `failure`.
- The job's check-run annotations differ: a timeout carries `The job has exceeded the maximum execution time of <duration>`; a manual cancel carries `The run was canceled by @<user>.` Both also carry `The operation was canceled.`
- A dependent job can read those annotations with `GITHUB_TOKEN` when it holds `actions: read` (to find the agent job's id for this run attempt, `GET /repos/{o}/{r}/actions/runs/{run}/attempts/{attempt}/jobs`) and `checks: read` (`GET /repos/{o}/{r}/check-runs/{job id}/annotations`).

## What this implies for dorfl

- The apply job must not map `cancelled` to "release and retry" on its own: a hanging agent that hits the GitHub cap would otherwise be retried every tick forever. It reads the agent job's annotations and treats `cancelled` with a "has exceeded the maximum execution time" annotation as a timeout (surface the item).
- A job can create its own annotations (`::error::...` on stdout), so the agent can forge text. The rule is therefore one-directional: the GitHub-written timeout annotation cannot be removed by the agent, so a real timeout should be detected; that is reasoned, not measured (see Not measured), so dorfl also checks the agent job's duration against its timeout. A forged timeout annotation on a real cancel only surfaces the item to a human, which is the safe side.

## Not measured

- Whether the annotation wording is stable across runner versions (measured on runner 2.337.0).
- Whether GitHub's timeout annotation is still written, and where it lands in the paginated annotations API, when the job has already emitted many annotations of its own (GitHub caps annotations per step and per job). The implementation should match on the stable fragment `exceeded the maximum execution time` and fall back to surfacing when the annotations cannot be read.
