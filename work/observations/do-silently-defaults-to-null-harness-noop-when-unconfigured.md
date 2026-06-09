---
title: With no harness configured, `do` silently falls back to the `null` adapter (a no-op shell-out to an unset agentCmd) instead of warning/refusing — and drive-backlog (the one agent-runner-aware skill) does not tell the operator to pass --harness; a fresh context runs do and nothing real happens
date: 2026-06-08
status: open
---

## The signal

A fresh `drive-backlog` context tried to build slices in this repo and the agent never actually ran — because `do` was invoked WITHOUT `--harness pi` and the repo has NO agent-runner config (neither global `~/.config/agent-runner/config.json` nor per-repo `.agent-runner.json`). So `harness` fell back to its hardcoded default `null` (ADR §5; `src/config.ts` "defaults to `null`"), and the `null` adapter shells out to `agentCmd` — which is ALSO unset — so the "build" did nothing useful.

The operator's symptom was "drive-backlog doesn't know how to run pi-harness." The real cause: nothing TOLD it to, and nothing WARNED that the silent fallback was a no-op.

## Two compounding gaps

1. **`do` silently no-ops on the `null`-default + unset-`agentCmd` combination.** The `null` harness is a legitimate adapter (it shells out to `agentCmd`), but when BOTH `harness` is unset (→ `null`) AND `agentCmd` is unset, there is no real agent to run and `do` proceeds anyway. A silent no-op build is the worst outcome (the gate can pass vacuously on an empty diff; cf. `noop-backstop-counts-branch-commits`). It should WARN loudly or REFUSE: "no harness configured and no agentCmd set — pass `--harness pi` (or set `harness`/`agentCmd` in config)."

2. **`drive-backlog` (the ONE agent-runner-aware skill) does not mention `--harness`.** Every other skill is protocol-native and harness-agnostic, but `drive-backlog` drives the `do` CLI directly, so it is the right (and only) skill home to say: confirm the repo's harness is configured, or pass `--harness` explicitly on each `do`. Without that, a fresh context omits the flag and hits gap #1.

## Fix directions (not done here — captured for triage)

- **Code (preferred for the root cause):** in `do`'s harness resolution, when it resolves to `null` AND no `agentCmd` is configured, do NOT silently run \u2014 emit a clear warning and/or refuse with the "pass `--harness` / set config" guidance. (A configured `null` + real `agentCmd` stays valid \u2014 only the no-harness-AND-no-agentCmd combination is the footgun.)
- **Skill (cheap, in-scope now):** add a line to `drive-backlog`'s pre-flight \u2014 "confirm the repo's harness is configured (`do` defaults to the `null` adapter); if not, pass `--harness <pi|\u2026>` on every `do`." This is appropriate precisely because `drive-backlog` is the one skill that leans on the agent-runner CLI.
- The two are complementary: the code fix stops the silent no-op for ALL callers; the skill note stops the conductor from omitting the flag in the first place.

## Related

- `noop-backstop-counts-branch-commits` (`work/done/`) \u2014 the empty-diff no-op backstop; a silent `null`-harness no-op is exactly the empty-diff case that backstop now catches, but catching it at harness-resolution time (warn/refuse) is earlier + clearer than letting it run and routing the empty result.
- `drive-backlog` SKILL \u2014 "It is the ONE skill that leans on the runner CLI directly; that is its job" \u2014 so the `--harness` note belongs there, not in the harness-agnostic skills.
