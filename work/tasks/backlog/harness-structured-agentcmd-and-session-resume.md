---
title: Structured null/shell agentCmd + a session capture/resume seam (parity with pi's continueSession)
slug: harness-structured-agentcmd-and-session-resume
originTrust: trusted
---

## Problem (the null harness cannot express the operations pi has)

The null/shell harness config is a SINGLE opaque command template: `agentCmd: string` (e.g. `"my-agent {model}"`), with `{model}` substituted and the prompt fed on stdin. But the pi harness has MULTIPLE distinct operations — `launch` (fresh), `launchAsync`, `launchInteractive`, and (incoming, `deadline-checkpoint-writes-handoff-note`) `continueSession` (`pi --print --continue --session <path>`). For pi the adapter hardcodes each invocation; for the null harness there is NO WAY to express "and to RESUME a session, run THIS instead." So any non-pi agent that DOES support resume (Claude Code `--resume`/`--continue`, Codex sessions, …) gets a forced no-op — the whole deadline-handoff feature is pi-only.

Worse, the session model is one-directional: dorfl GENERATES a session path (`generateSessionPath`) and INJECTS it into pi (`--session <path>`), then records it (`PiHarnessRecord.session`). The null adapter IGNORES `session` entirely and its `HarnessRecord` records only `{pid, command}` — no session. So for a shell agent dorfl has no idea WHAT session (if any) the launch created, hence nothing to pass back as `{session}` on a resume. The seam is missing the CAPTURE direction: learn the session id/path a launch used, so a later resume can reuse it.

## Goal

Give the null/shell harness (a) a STRUCTURED `agentCmd` shape that can express `run` / `continue` / `interactive` with a placeholder vocabulary, and (b) a SESSION CAPTURE mechanism so dorfl records the session id/path a shell launch used and can pass it back as `{session}` on `continueSession` — reaching PARITY with pi's session-resume. Fully backward-compatible: today's bare-string `agentCmd` keeps working unchanged.

## Design (grounded — verify at build, STOP if a premise is false)

### 1. Structured `agentCmd` (additive superset of the string form)

`agentCmd` accepts EITHER:

- a **string** (today's behaviour, unchanged): the `run` command; `continue`/`interactive` fall back (continue ⇒ no-op handoff; interactive ⇒ run-fresh where applicable), OR
- an **object**: `{ run: string, continue?: string, interactive?: string, sessionFrom?: <capture spec> }`. Each command is a template with the placeholder vocabulary below. Missing `continue` ⇒ the null `continueSession` is a clean no-op (degrade, never error).

Placeholder vocabulary (extend the current `{model}`-only set): `{model}` (as today), `{session}` (the captured/injected session id or path — see §2), and keep the prompt on STDIN (not a placeholder) to match today. Reuse `substituteModel`'s discipline (fail loud on `{model}` present + model unset), generalised to a `substitutePlaceholders` that also handles `{session}` (fail loud if `{session}` is present in `continue` but no session was captured).

### 2. Session CAPTURE for the null harness (the missing direction), two strategies in preference order

`HarnessRecord.session` ALREADY exists (harness.ts: "Adapter-specific session pointer"); the null adapter just never populates it. Populate it via one of:

- **(preferred) INJECT-A-KNOWN-ID** — mirror pi's `--session-id <id>` ("use exact session id, creating if missing"). If the agent accepts a caller-supplied id, dorfl GENERATES an id, injects it as `{session}` into BOTH `run` and `continue`, and thus ALREADY KNOWS it — no parsing. `HarnessRecord.session` = the generated id. This is the clean model (dorfl controls the id, exactly like the pi path today).
- **(fallback) EXTRACT** — for an agent that mints its OWN id, `sessionFrom` declares how to capture it: e.g. `{ stdout: "<regex with one capture group>" }` (parse the launch's stdout/stderr) or `{ file: "<path the agent writes>" }`. The null adapter runs the extraction after launch and records the result in `HarnessRecord.session`.

If neither is configured, `HarnessRecord.session` stays unset ⇒ `continueSession` no-ops for that harness (WIP saved without a handoff — the documented degrade).

### 3. The `continueSession` seam (shared with the handoff task)

Add `Harness.continueSession({session, prompt, dir, model, env, deadlineMs})`. pi: `pi --print --continue --session <session>` (its native form). null: substitute `{session}`+`{model}` into the configured `continue` template + prompt on stdin, reusing the deadline-race + capture discipline. A harness with no `continue` / no captured session ⇒ clean no-op. (This method may be introduced by `deadline-checkpoint-writes-handoff-note` for pi first; this task extends it to the null harness — coordinate the ownership so it is defined ONCE.)

## Non-goals

- Do NOT break the bare-string `agentCmd` (the common, dead-simple case). Structured is opt-in.
- Do NOT build the handoff-note routing here (owned by `deadline-checkpoint-writes-handoff-note`). This task provides the CAPABILITY (structured cmd + session capture/resume); the handoff task USES it. Sequence: this is the foundation; the handoff task depends on it for null-harness parity (or the handoff ships pi-only first and this lights up shell agents — the maintainer picks the order).
- Do NOT add per-agent presets (a "claude" / "codex" built-in). Config expresses it generically; presets are a later convenience.

## Open questions (ratify)

- **Ordering vs the handoff-note task:** build this FIRST (handoff works for pi + shell from day one) OR ship handoff pi-only first and light up shell agents here later? (Either works; affects only which task no-ops the null path in the interim.)
- **`sessionFrom` shape:** stdout-regex + file are proposed. Is a stdout regex enough for the real target agents, or is an env/JSON-field extractor also needed? Keep minimal; add on demand.
- **`{session}` semantics:** an opaque STRING dorfl round-trips (id OR path — the adapter decides what it means). Confirm dorfl treats it opaquely (it does for pi: a path; for a shell agent: whatever the agent's `--resume` wants).

## Acceptance criteria

- [ ] Bare-string `agentCmd` is byte-for-byte unchanged (a control test): `run` only, `{model}` substitution, prompt on stdin, no session capture, `continueSession` no-ops.
- [ ] Structured `agentCmd` `{run, continue, interactive?, sessionFrom?}` parses + validates (fail loud on a bad shape / `{session}` in `continue` with no capture strategy).
- [ ] INJECT-A-KNOWN-ID: with a `{session}` placeholder in `run`+`continue`, dorfl generates an id, injects it, records it in `HarnessRecord.session`, and `continueSession` reuses it (test with a stub agent script that echoes its args).
- [ ] EXTRACT (`sessionFrom`): a stub agent that PRINTS a self-minted session id has it captured into `HarnessRecord.session` and reused on `continueSession` (test).
- [ ] `continueSession` on the null harness runs the `continue` template with `{session}`/`{model}` + prompt on stdin; a harness with no `continue`/no session is a clean no-op (both tested).
- [ ] pi's existing launch/continueSession is unchanged (dorfl still generates+injects+records the pi session path).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Prompt

> Goal: give the null/shell harness a STRUCTURED `agentCmd` shape (`{run, continue?, interactive?, sessionFrom?}`, additive over today's bare string) with a `{model}`+`{session}` placeholder vocabulary, AND a SESSION CAPTURE direction so dorfl records the session id/path a shell launch used (via inject-a-known-id like pi's `--session-id`, or a `sessionFrom` extractor) and passes it back as `{session}` on `continueSession` — reaching parity with pi's session resume so the deadline-handoff feature is NOT pi-only.
>
> DRIFT-CHECK FIRST (STOP with the obstruction if false): today `agentCmd: string`, `{model}` is the only placeholder (`substituteModel`), the null adapter IGNORES `LaunchInput.session` and records only `{pid, command}` in `HarnessRecord` (never populates `HarnessRecord.session`), and dorfl GENERATES + INJECTS + RECORDS the pi session path. Confirm `HarnessRecord.session` exists (it does) and pi supports `--session-id`/`--continue` (verified in `pi --help`).
>
> Build: (1) parse `agentCmd` as string OR `{run, continue?, interactive?, sessionFrom?}` (backward-compatible; the string IS `run`); (2) generalise `substituteModel` to substitute `{model}` + `{session}`, fail loud on a present-but-unresolved placeholder; (3) session capture in the null adapter — INJECT a dorfl-generated id via `{session}` when the run template carries it (record it in `HarnessRecord.session`), ELSE run `sessionFrom` extraction (stdout regex / file) after launch, ELSE leave session unset; (4) `Harness.continueSession` for the null harness runs the `continue` template with `{session}`+`{model}` + prompt on stdin, no-op when there is no `continue`/no captured session; (5) keep pi + the bare-string path byte-for-byte unchanged.
>
> Do NOT break the bare-string `agentCmd`. Do NOT build the handoff-note ROUTING (that is `deadline-checkpoint-writes-handoff-note`; this is the CAPABILITY it consumes). Coordinate `continueSession` ownership so it is defined once.
>
> Done = structured agentCmd + session capture/resume for the null harness, bare-string + pi unchanged, all shapes tested, gate green. RECORD the resolved open questions (sessionFrom shape, {session} semantics, ordering vs the handoff task) durably; the harness-seam extension likely meets the ADR gate.
