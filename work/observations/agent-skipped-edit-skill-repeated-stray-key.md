---
title: Agent repeatedly hit a documented edit-tool pitfall without loading the skill that names it
type: observation
status: spotted
spotted: 2026-06-05
---

# An agent hit the same documented edit-tool error 4x without loading the skill

> **NOTE ON SCOPE:** this is an **agent/harness CONDUCT** signal, NOT an agent-runner domain signal (unlike the other notes in this folder, which are about mirrors/ledger/gc). It is captured here because this is the repo where it happened and there is no better place to keep it from evaporating (maintainer's call: capture > lose). A future reader should NOT mistake it for a code issue in `agent-runner`.

## What was spotted

While doing four review passes over the phase-2 command-surface slices (2026-06-05), the agent (me) **repeatedly emitted `edit` tool calls with a stray extra key inside an `edits[]` object** (e.g. `newText_unused`, `id_unused`, `id_x`, `newText_x`, `newText_z`, `id_skip`, `id_strip`). The `edit` tool rejects this every time with:

```
Validation failed for tool "edit":
  - edits.0: must not have additional properties
```

It happened on AT LEAST these calls (all caught by the tool's validation, so nothing landed wrong \u2014 but each cost a wasted round-trip + a retry):

- pass 2: `registry-remote` edit (`newText_unused`) \u2014 and the botched retry of THAT call is what caused a separate **lost-edit** (two intended edits never applied; only found in pass 3 by re-reading the committed file). So the stray-key habit had a real downstream cost beyond the wasted turn.
- pass 2: `human-face-verbs` edit (`id_unused`).
- pass 3: `flag-cleanup-renames` edit (`newText_z`), `scan-status-fetch-first` edit (`newText_x`).
- pass 4: `do-in-place` edit (`id_skip`).

## The kicker: a skill documents this EXACT error, and it was never loaded

`edit-best-practices` (`/home/wighawag/.pi/agent/skills/edit-best-practices/SKILL.md`, listed in the agent's available skills) names this precisely:

> **"Check for Extra Properties \u2014 `edits[]` objects only allow `oldText` and `newText`."** Error: `Validation failed: edits.0: must not have additional properties` \u2014 "Remove any properties besides `oldText` and `newText` from inside `edits[]`."

It even has a **red-flag rule**: _"Stop and reassess if you see the same validation error twice in a row."_ The agent hit it FOUR times across multiple turns and never loaded the skill (whose description is literally "best practices for using the edit tool... to avoid common pitfalls") until the maintainer asked about it.

## The real failure (and the lesson)

The bug itself is trivial (a typo'd extra key, harmlessly rejected). The SIGNAL is the meta-behaviour:

1. **A documented, named pitfall recurred without the relevant skill being loaded** \u2014 i.e. "same validation error twice" did not trigger "load the skill about this tool." Skill discovery is happening too late / not on repeated-error.
2. **A recurring tool-misuse pattern that the harness silently catches is easy to normalise** ("the retry works, move on") instead of treating it as a red flag. That normalisation is what let it recur four times AND caused the pass-3 lost-edit (a failed batch's partial retry dropped two edits).

Corrective taken: load + follow `edit-best-practices`; treat a SECOND identical tool-validation error as a stop-and-load-the-skill trigger; after any failed edit batch, re-read the file to confirm what actually landed (not what was intended).

## Update (2026-06-05) — sharper ROOT CAUSE; the fix is mine, not pi's

Disabling `edit-best-practices` did NOT stop it (it recurred AFTER the skill was disabled, e.g. `newText_strip`), so the skill was not the cause. Better diagnosis:

- **It is a GENERATION artifact, not a decision.** I never intend the extra key. The stray keys are always near-duplicates of a real key with a throwaway suffix (`newText_strip`, `newText_x`, `newText_2`, `newText_unused`, `id_skip`, `id_unused`) closed with the cheapest value (`""`). After emitting one very long multi-line `newText` string, token generation "wants" another `key: value` pair (objects usually have >1 key) and grabs a plausible-looking filler name. It is a **structural-completion error under the load of a long string value.**
- **It clusters on LARGE, SINGLE-edit calls.** Small edits and multi-edit arrays (where the `},{` rhythm reinforces "object complete") trip far less. The workaround that empirically WORKED this session was switching to small, surgical edits — which is exactly the `edit-best-practices` discipline (minimal `oldText`, split large edits).
- **The fix is BEHAVIOURAL and mine:** keep edits small / split large ones; do not emit filler keys. pi's strict schema rejecting the key is arguably CORRECT — the failure is that I produced malformed input, not that pi refused it. (There IS a secondary, optional pi robustness improvement — its runtime handlers are written to TOLERATE extra keys while its schema rejects them, an intent/enforcement mismatch — but that is defense-in-depth for noisy/weak models, NOT the fix for this. Captured as a separate pi-improvements proposal.)

Net: the original "meta-signal" framing (skill-not-loaded) was only half right; the load-bearing cause is a structural-completion tic on large single edits. Mitigation = small/split edits + no filler keys.

## Why an observation, not a work item

It is not actionable as agent-runner code. It is a conduct/harness signal worth remembering (it cost real turns + caused a lost edit). If a pattern of "documented-skill-not-loaded-on-repeated-error" shows up elsewhere, this is prior art. Delete once it stops being a useful reminder.

## Update (2026-06-06) — recurred again across a second multi-day session

The stray-key edit failure (`newText_strip` / extra keys on an edit) recurred several MORE times in a later long session (session-path + recovery-cluster planning) — caught each time by the tool's validation ("must not have additional properties"), resent clean, no lost work, but it still cost turns. The maintainer's tool-side robustness work (`~/dev/github/wighawag/pi` branch `fix/edit-tolerate-extraneous-keys`) remains the right fix: disabling the edit-best-practices skill + the global AGENTS.md rule did NOT prevent recurrence, confirming this is a tool-tolerance problem, not a prompt problem. Two independent multi-session occurrences = a stable pattern (per this note's own "second instance is a signal" logic). Still not actionable as agent-runner CODE; left as the durable conduct/harness reminder until the tool-side fix lands.
