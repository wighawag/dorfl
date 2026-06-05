---
title: agent-interactive-launch — --agent on start/work-on launches the harness INTERACTIVELY
slug: agent-interactive-launch
prd: command-surface-phase-2
needsAnswers: true
blockedBy: [human-face-verbs]
covers: [14]
---

## What to build

`--agent` on `start` and `work-on`: after onboarding (claim/switch, or worktree +
cd), launch the configured harness **INTERACTIVELY** — a foreground session the
human starts chatting with (the agent waits for the human's first message). This is
the human-facing counterpart to the autonomous launch in `run`/`do`: here there is
**no prepared prompt fed on stdin** and **no unattended gate** — it just starts the
harness in the human's onboarded working tree so they can drive it.

This is split out of `human-face-verbs` (which ships `resume` + `work-on` cd) and
gated `needsAnswers: true` because it requires a **new harness-seam capability that
does not exist yet**, and the exact shape of that capability is an open question
(below). Do NOT build until the questions are answered and the flag cleared.

### Why this is not a trivial flag

The existing harness seam does NOT support interactive launch — verified in code.
Both adapters use `spawnSync` + non-interactive: `NullHarness.launch`
(`src/harness.ts`) runs the command **synchronously via `spawnSync`**, **pipes a
prepared prompt on stdin**, and **captures output**; the **pi adapter**
(`src/pi-harness.ts`) explicitly runs pi **non-interactively** (`pi --print`,
prompt on stdin, output captured — see its own "running non-interactively"
comment). Both are purpose-built for the autonomous path. An interactive launch is
the opposite: **inherit the human's stdio** (`stdio: 'inherit'`), run in the
**foreground**, feed **no prepared prompt** (no `--print` for pi — a real
interactive session), and return control when the human exits. So `--agent` is NOT
`harness.launch(...)` with a flag — shoehorning it into the captured `launch`
produces a launch that looks wired but is wrong (captured stdio, instant return,
no human interaction).

## Update (2026-06-05) — sharpenings from building `do-watch`

While building `do --watch` (option (a): tail the pi session log, launch untouched
beyond `spawnSync`→`spawn`), several things about `--agent` got concrete — fold
these in when resolving the open questions below:

- **`--agent` is option (b) in the `do-watch` lineage.** `do-watch` proved you can
  go async (`spawnSync`→`spawn`) WITHOUT touching the agent's stdio contract
  (prompt still fed on stdin, output still captured). `--agent` is precisely the
  slice that DOES change the stdio contract — inherit/pipe stdio, no prepared
  prompt, foreground. See `do-watch`'s "Lineage" section: (a) observe vs (b)
  interact. `--agent` owns the streaming/interactive seam `--watch` deliberately
  did not open.
- **Partial answer to Q2 (pi adapter):** the pi adapter's interactive form is
  `pi` **WITHOUT `--print`** — a real foreground session the human types into
  (the current non-interactive launch is `pi --print --session-dir <dir>`, prompt
  on stdin, captured; see `src/pi-harness.ts`). So interactive = drop `--print`,
  inherit stdio, no piped prompt. (Still open: exact flags, and whether the
  `--session-dir` pointer still applies.)
- **Partial answer to Q2 (null adapter):** likely `--agent` is **pi-only with a
  clear error** on the null adapter (its `agentCmd` is shaped for the captured
  autonomous path; "interactive" has no clean meaning there) — mirror `do-watch`'s
  fail-on-null-harness decision.
- **Plumbing reuse:** if `--agent` lands AFTER `do-watch`, it can share the
  async-`spawn` launch plumbing `do-watch` introduces (both need a non-blocking
  launch; `--agent` additionally inherits stdio). Check whether `do-watch`'s launch
  refactor already exposes the seam to build on.

## Open questions (resolve before building — clear `needsAnswers` when done)

1. **Seam shape.** Is interactive launch a new method on the `Harness` interface
   (e.g. `launchInteractive(input)`), or a separate code path / a mode flag on the
   existing seam? The ADR §5 discipline (one declared intent, adapter-specific
   realisation) should guide it, but the concrete signature is undecided.
2. **Adapter realisation.** How does each adapter realise it? `pi` (invoke the pi
   CLI as a foreground interactive session in the working tree — which pi invocation
   exactly?); `null`/shell (run `agentCmd` with inherited stdio — but `agentCmd` is
   shaped for the captured autonomous path; does interactive even make sense for the
   null adapter, or is `--agent` pi-only with a clear error otherwise?).
3. **Liveness / return semantics.** The autonomous seam records a PID for liveness;
   an interactive foreground session blocks the CLI until the human exits. What does
   the command return/record, and does it interact with the job-record/liveness
   model at all (probably not — it is a human session, not a tracked job)?
4. **Model routing.** Does the resolved `model` (ADR §13) flow into the interactive
   launch the same way it does for the autonomous path, or is the model the human's
   choice inside the interactive session?

## Acceptance criteria

> Provisional — finalise when the open questions are resolved.

- [ ] `--agent` on `start` and `work-on` launches the configured harness
      INTERACTIVELY in the onboarded working tree (foreground, inherited stdio,
      awaiting the human, NO prepared prompt) — NOT the autonomous captured launch.
- [ ] The interactive-launch capability is added to the harness seam per the
      resolved seam shape (Q1/Q2), consistent with ADR §5; the captured `launch`
      path is unchanged.
- [ ] Tests assert an INTERACTIVE launch (inherited stdio / foreground, no prepared
      prompt) with the right cwd, via the resolved interactive seam (NOT the
      captured-`launch` stub used for the autonomous path).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `human-face-verbs` — adds the `--agent` flag onto the same `start`/`work-on`
  commands this slice touches; serialise after it to avoid a cli.ts/start/work-on
  conflict (and so the verbs exist as a stable base).

## Prompt

> NOTE: this slice is `needsAnswers: true` — do NOT build it until the open questions
> in its body (the interactive-launch seam shape + adapter realisation + return/
> liveness semantics + model routing) are answered and the flag is cleared. If you
> are reading this with the flag still set, route to needs-attention / surface the
> questions rather than guessing a seam design.
>
> Once unblocked: add `--agent` to `start` and `work-on` to launch the configured
> harness INTERACTIVELY (foreground, inherited stdio, no prepared prompt — the human
> drives it), per `docs/adr/command-surface-and-journeys.md` §4. CRITICAL: the
> existing `Harness.launch` (`src/harness.ts`) is `spawnSync` + prompt-on-stdin +
> output-captured (the AUTONOMOUS path) — interactive launch is a NEW seam
> capability, NOT a flag on `launch`; design it per the resolved open questions and
> the ADR §5 seam discipline.
>
> READ FIRST: ADR `command-surface-and-journeys` §4 (the interactive-vs-autonomous
> launch distinction) + §5 (seam discipline) + §13 (model routing, for Q4),
> `src/harness.ts` + `src/pi-harness.ts` (the seam — note `launch` is
> `spawnSync`+captured), `src/start.ts` + `src/work-on.ts` (where `--agent` attaches,
> after the `human-face-verbs` slice landed the verbs), and the `human-face-verbs`
> done file.
>
> TDD with vitest, house style: assert an INTERACTIVE launch (inherited stdio /
> foreground, no prepared prompt) with the right cwd via the resolved interactive
> seam — NOT the captured-`launch` stub. "Done" = acceptance criteria met and the
> gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim agent-interactive-launch --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/agent-interactive-launch <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/agent-interactive-launch.md work/done/agent-interactive-launch.md
```
