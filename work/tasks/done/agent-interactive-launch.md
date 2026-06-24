---
title: agent-interactive-launch — --agent on start/work-on launches the harness INTERACTIVELY
slug: agent-interactive-launch
prd: command-surface-phase-2
blockedBy: [human-face-verbs]
covers: [14]
---

> **`needsAnswers` CLEARED 2026-06-07** (human decision). The four open seam questions below are RESOLVED (see "Resolved decisions"); the provisional acceptance criteria are finalised accordingly. This slice is now agent-buildable.

## What to build

`--agent` on `start` and `work-on`: after onboarding (claim/switch, or worktree + cd), launch the configured harness **INTERACTIVELY** — a foreground session the human starts chatting with (the agent waits for the human's first message). This is the human-facing counterpart to the autonomous launch in `run`/`do`: here there is **no prepared prompt fed on stdin** and **no unattended gate** — it just starts the harness in the human's onboarded working tree so they can drive it.

This is split out of `human-face-verbs` (which ships `resume` + `work-on` cd) because it requires a **new harness-seam capability that does not exist yet**. The exact shape was an open question; it is now RESOLVED below ("Resolved decisions").

### Why this is not a trivial flag

The existing harness seam does NOT support interactive launch — verified in code. Both adapters use `spawnSync` + non-interactive: `NullHarness.launch` (`src/harness.ts`) runs the command **synchronously via `spawnSync`**, **pipes a prepared prompt on stdin**, and **captures output**; the **pi adapter** (`src/pi-harness.ts`) explicitly runs pi **non-interactively** (`pi --print`, prompt on stdin, output captured — see its own "running non-interactively" comment). Both are purpose-built for the autonomous path. An interactive launch is the opposite: **inherit the human's stdio** (`stdio: 'inherit'`), run in the **foreground**, feed **no prepared prompt** (no `--print` for pi — a real interactive session), and return control when the human exits. So `--agent` is NOT `harness.launch(...)` with a flag — shoehorning it into the captured `launch` produces a launch that looks wired but is wrong (captured stdio, instant return, no human interaction).

## Update (2026-06-05) — sharpenings from building `do-watch`

While building `do --watch` (option (a): tail the pi session log, launch untouched beyond `spawnSync`→`spawn`), several things about `--agent` got concrete — fold these in when resolving the open questions below:

- **`--agent` is option (b) in the `do-watch` lineage.** `do-watch` proved you can go async (`spawnSync`→`spawn`) WITHOUT touching the agent's stdio contract (prompt still fed on stdin, output still captured). `--agent` is precisely the slice that DOES change the stdio contract — inherit/pipe stdio, no prepared prompt, foreground. See `do-watch`'s "Lineage" section: (a) observe vs (b) interact. `--agent` owns the streaming/interactive seam `--watch` deliberately did not open.
- **Partial answer to Q2 (pi adapter):** the pi adapter's interactive form is `pi` **WITHOUT `--print`** — a real foreground session the human types into (the current non-interactive launch is `pi --print --session-dir <dir>`, prompt on stdin, captured; see `src/pi-harness.ts`). So interactive = drop `--print`, inherit stdio, no piped prompt. (Still open: exact flags, and whether the `--session-dir` pointer still applies.)
- **Partial answer to Q2 (null adapter):** likely `--agent` is **pi-only with a clear error** on the null adapter (its `agentCmd` is shaped for the captured autonomous path; "interactive" has no clean meaning there) — mirror `do-watch`'s fail-on-null-harness decision.
- **Plumbing reuse:** if `--agent` lands AFTER `do-watch`, it can share the async-`spawn` launch plumbing `do-watch` introduces (both need a non-blocking launch; `--agent` additionally inherits stdio). Check whether `do-watch`'s launch refactor already exposes the seam to build on.

## Resolved decisions (2026-06-07 — the former open questions)

1. **Seam shape — a NEW method on the `Harness` interface: `launchInteractive(input)`, NOT a mode flag on `launch`.** `launch` is fundamentally spawnSync + prompt-on- stdin + capture-output + a `LaunchResult` (`ok`/`output`); interactive is the opposite shape (inherit stdio, no prompt, foreground-block, nothing capturable). A boolean on `launch` would make its return type lie and force every caller to branch. Two clearly-named intents on the seam satisfy ADR §5 (one declared intent, adapter-specific realisation) and keep the autonomous `launch` path byte-identical. Signature: `launchInteractive(input): void` (or a thin result carrying only an exit code — there is no captured output / PID record; see #3).
2. **Adapter realisation — pi-only, clear error on null.**
   - **pi adapter:** interactive = `pi` **WITHOUT `--print`**, **inherited stdio** (`stdio: 'inherit'`), **no piped prompt**, run in `input.dir`, foreground. KEEP passing `--session <path>` so the human session is still recorded/visible (audit trail + the pi dashboard still apply). (The autonomous form stays `pi --print --session <path>` with the prompt on stdin, captured.)
   - **null/shell adapter:** `--agent` is **pi-only** — `launchInteractive` throws a CLEAR error ("interactive launch requires the pi harness; configure `harness: pi`"), mirroring `do-watch`'s fail-on-null decision. `agentCmd` is shaped for the captured autonomous path; "interactive" has no clean meaning there.
3. **Liveness / return — a human session, NOT a tracked job.** It blocks the CLI in the foreground until the human exits, then returns control. It does NOT write a `.dorfl-job.json` record, does NOT participate in the PID/liveness/`status`/ `gc` model, and does NOT auto-run the gate (no unattended completion). After exit the human is left on the onboarded `work/<slug>` branch and drives `complete`/ `requeue` themselves (the normal human face). `launchInteractive` returns void / an exit code only — nothing to record.
4. **Model routing — the resolved `model` (ADR §13: flag > env > per-repo > global) FLOWS INTO the interactive launch**, the same as the autonomous path, so the human starts pinned to the intended model (otherwise `start --agent --model X` would silently do nothing — a surprising inconsistency with `do`/`run`). The human may still switch models inside the pi session afterward (pi's own affordance); the LAUNCH respects the resolved routing.

## Acceptance criteria

- [ ] `--agent` on `start` and `work-on` launches the configured harness INTERACTIVELY in the onboarded working tree (foreground, inherited stdio, awaiting the human, NO prepared prompt) — NOT the autonomous captured launch.
- [ ] A NEW `launchInteractive(input)` method is added to the `Harness` seam (decision #1); the existing captured `launch` path is UNCHANGED (byte-identical — its tests pass unmodified).
- [ ] pi adapter: `launchInteractive` runs `pi` WITHOUT `--print`, inherited stdio, no piped prompt, in `input.dir`, still passing `--session <path>` (decision #2).
- [ ] null adapter: `launchInteractive` throws a clear pi-only error (decision #2).
- [ ] It is NOT a tracked job: no `.dorfl-job.json`, no PID/liveness record, no gate; it returns control on human exit, leaving them onboarded on `work/<slug>` (decision #3).
- [ ] The resolved `model` (flag > env > per-repo > global) flows into the interactive pi launch (decision #4).
- [ ] Tests assert an INTERACTIVE launch (inherited stdio / foreground, no prepared prompt) with the right cwd via `launchInteractive` (NOT the captured-`launch` stub); the null adapter's pi-only error; and that `--agent` does not write a job record. Use the house harness-stub + temp-dir isolation; assert the real `~/.dorfl/` + `~/.pi/agent/sessions/` are untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `human-face-verbs` — adds the `--agent` flag onto the same `start`/`work-on` commands this slice touches; serialise after it to avoid a cli.ts/start/work-on conflict (and so the verbs exist as a stable base).

## Prompt

> NOTE: the former `needsAnswers` flag is CLEARED — the four seam questions are RESOLVED in this slice's "Resolved decisions" section (new `launchInteractive` seam method; pi-only with a clear null-adapter error; not a tracked job; resolved `model` flows in). BUILD TO THOSE DECISIONS; do not re-litigate them. If the code has drifted such that a decision no longer fits, STOP and surface it (do not guess a different seam design).
>
> Add `--agent` to `start` and `work-on` to launch the configured harness INTERACTIVELY (foreground, inherited stdio, no prepared prompt — the human drives it), per `docs/adr/command-surface-and-journeys.md` §4. CRITICAL: the existing `Harness.launch` (`src/harness.ts`) is `spawnSync` + prompt-on-stdin + output-captured (the AUTONOMOUS path) — interactive launch is a NEW seam capability, NOT a flag on `launch`; design it per the resolved open questions and the ADR §5 seam discipline.
>
> READ FIRST: ADR `command-surface-and-journeys` §4 (the interactive-vs-autonomous launch distinction) + §5 (seam discipline) + §13 (model routing, for Q4), `src/harness.ts` + `src/pi-harness.ts` (the seam — note `launch` is `spawnSync`+captured), `src/start.ts` + `src/work-on.ts` (where `--agent` attaches, after the `human-face-verbs` slice landed the verbs), and the `human-face-verbs` done file.
>
> TDD with vitest, house style: assert an INTERACTIVE launch (inherited stdio / foreground, no prepared prompt) with the right cwd via the resolved interactive seam — NOT the captured-`launch` stub. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim agent-interactive-launch --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/agent-interactive-launch <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/agent-interactive-launch.md work/done/agent-interactive-launch.md
```
