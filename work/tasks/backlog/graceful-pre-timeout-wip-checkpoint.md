---
title: Graceful pre-timeout WIP checkpoint — a dorfl-internal deadline that saves work before the GitHub hard kill
slug: graceful-pre-timeout-wip-checkpoint
originTrust: trusted
---

## Problem (from observation `timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13`)

The per-leg GitHub `timeout-minutes` cap (config `legTimeoutMinutes`, default 120) protects against a wedged leg stranding the run for 6h — but a GitHub `timeout-minutes` is a HARD SIGKILL of the whole runner, so the `do`/`advance` agent never gets to run its work-preserving routing (commit WIP to `work/<slug>` + push). A legitimately-long task (a wide migration, a big refactor) therefore times out, loses EVERYTHING, requeues, and times out again — a permanent trap. Live example: the PR-2b 84-assertion migration (`bounce-migrate-stuck-assertions-and-flip-exit-codes`) ran > 1h10m and risked the hard kill discarding all its work.

## Goal

A dorfl-INTERNAL deadline that fires BEFORE the GitHub hard kill, stops the agent GRACEFULLY, saves the WIP to `work/<slug>`, and — crucially — **AUTO-REQUEUES (continue) WITHOUT a human sidecar when the leg made progress**, so a legitimately-long task drains across ticks fully autonomously. The GitHub `timeout-minutes` stays ONLY as a last-resort backstop. This turns "over-cap task loses all work forever" into "over-cap task makes incremental, autonomous progress across runs".

### A deadline checkpoint is NOT a failure (the core semantic decision)

A hard-kill-avoided checkpoint means "healthy work in progress, ran out of time" — NOT "something went wrong, a human must look". So it MUST NOT surface a `needsAnswers:true` question sidecar the way `saveAgentFailure` does; that would put a human in the loop for every long task, defeating autonomy. Instead the checkpoint AUTO-CONTINUES: save the WIP to the branch, RELEASE the lock (leave the branch), and let the NEXT tick's claim continue from the branch tip. No human, no sidecar — a self-draining loop.

### The anti-loop guard (the safety catch that makes auto-requeue safe)

Unconditional auto-requeue would let a GENUINELY WEDGED agent (making no progress) checkpoint → auto-requeue → wedge → forever, burning CI compute — WORSE than today's "loses work" trap (which at least stops). So auto-continue is GATED on PROGRESS + a CEILING:

- **Made progress ⇒ auto-continue.** The checkpoint's WIP commit must DIFFER from the branch tip the leg started from this session (the agent actually changed something). Reuse the EXISTING "count branch commits / empty-diff backstop" progress notion (`noop-backstop-counts-branch-commits`): a non-empty delta this session ⇒ healthy ⇒ auto-continue.
- **No progress this session ⇒ SURFACE to a human** (the `needsAnswers:true` sidecar, via the normal bounce path). A checkpoint that produced NO new work is indistinguishable from a wedge — a human should look ("this leg made no progress before the deadline; is it stuck or mis-scoped?").
- **Ceiling ⇒ SURFACE to a human.** Track a small auto-continue counter (on the lock entry / branch); after `maxAutoCheckpoints` (default a small N, e.g. 5) consecutive deadline auto-continues, STOP auto-requeuing and surface a `needsAnswers:true` question ("this task has hit the deadline N times — it may be too big for one CI leg; split it or run it locally?"). This bounds even a slowly-progressing-but-never-finishing task and is the signal a task is mis-scoped (exactly PR-2b's situation). The counter RESETS on any non-deadline outcome (a normal completion, a real bounce).

So the routing decision at the deadline is: **progress AND under-ceiling ⇒ auto-continue (release lock, no sidecar); else ⇒ surface a needs-answers question (human decides continue / split / cancel).**

Two-layer deadline model (the maintainer's framing):

- **dorfl-internal deadline (the PRIMARY stop): default 2h (120 min).** The agent session self-stops at this budget; dorfl then runs `saveAgentFailure`'s save path (commit WIP + push branch + mark surfaced/stuck) with the remaining head-room. This is the deadline that should normally fire.
- **GitHub `timeout-minutes` (the BACKSTOP): must be LARGER than the dorfl deadline** to leave room for the leg's PRE-steps (checkout, dorfl-setup, install) and POST-steps (the save/push itself, reap). Render it as `dorfl-deadline + headroom` (e.g. dorfl 120 + a `checkpointHeadroomMinutes` margin, default e.g. 20 ⇒ GitHub 140), so the GitHub kill only fires if the graceful save ITSELF wedges. NEVER let GitHub's cap be ≤ the dorfl deadline (then the backstop pre-empts the graceful path — the bug we are fixing).

## Design (grounded in the code — verify at build, STOP if a premise is false)

The seam is `runDoAgent` (`do.ts`) → `launchWithOptionalWatch` (`agent-launch.ts`) → `PiHarness.launchAsync` (`pi-harness.ts`), which spawns pi via `spawn(...)` and resolves its Promise on the child `exit`. A deadline attaches HERE:

1. **Thread a deadline into the launch.** Add an optional deadline/abort input to `LaunchInput` (e.g. `deadlineMs?: number` or an `AbortSignal` — pick one; a signal composes better and is more testable). Resolve the effective deadline in `do`/`advance` from config (see the config knob below) and pass it through `runDoAgent` → `launchWithOptionalWatch` → the harness.
2. **Race the launch against the deadline in `launchAsync`.** When the deadline fires: send `SIGTERM` to the pi child (a graceful stop; pi flushes its session `.jsonl`), then `SIGKILL` after a short grace (e.g. 10s) if it has not exited. The Promise resolves with a `LaunchResult` that flags the deadline stop (a new field, e.g. `timedOut: true`, distinct from `ok`/`detail`) so the caller can route it as a CHECKPOINT, not a generic failure. Preserve the existing exit/close/error settle-once discipline (do not double-settle the Promise); reuse the same stdout-drain + FD-release the current `exit` handler does.
3. **Route the checkpoint through the EXISTING save path.** In `do.ts` (and `run.ts`'s mirror), when the launch reports the deadline stop, call the SAME `saveAgentFailure` routing (commit WIP to `work/<slug>` → push → mark surfaced/stuck) that an agent-failure already uses — but with a DISTINCT reason/cause so the human sees "checkpointed at the deadline; requeue --continue to resume", NOT "agent failed". This makes `requeue --continue` land on the saved partial work. Do NOT invent a new save mechanism; reuse `applyNeedsAttentionTransition` via `saveAgentFailure` (its docstring already anticipates "the human chooses requeue (continue) …").
4. **Config knobs + install-ci render.** Add resolved config fields, each through the SAME flag > env > per-repo > global > default chain the other knobs use: `agentDeadlineMinutes` (the internal deadline, default 120); `checkpointHeadroomMinutes` (the pre/post-step margin the GitHub backstop adds, default e.g. 20); `maxAutoCheckpoints` (the auto-continue ceiling, default e.g. 5). Then CHANGE the advance-lifecycle template render so GitHub `timeout-minutes` = `agentDeadlineMinutes + checkpointHeadroomMinutes` (backstop-above-deadline), instead of today's `legTimeoutMinutes` directly driving `timeout-minutes`. Decide whether `legTimeoutMinutes` is renamed/re-derived or kept as the GitHub-cap name with the dorfl deadline as a new sibling — RECORD the decision (it is user-visible config vocabulary; likely ADR-worthy).

## Non-goals / boundaries

- Do NOT try to hook GitHub's SIGKILL (there is no graceful-shutdown hook; that is exactly why the internal deadline exists). The GitHub cap stays a dumb backstop.
- Do NOT add a resumable "continue-token" protocol (the observation's option 3) — the branch push IS the durable checkpoint; `requeue --continue` already resumes from a branch tip. Out of scope.
- Do NOT change what a normal (non-deadline) agent run does — a run that finishes before the deadline is byte-for-byte unchanged (the deadline timer is cleared on a normal `exit`).
- The checkpoint saves the tree AS-IS (possibly mid-edit / not green). That is fine and intended — it is recoverable WIP, exactly like the agent-failure save; do not gate the checkpoint on a green tree.

## Acceptance criteria

- [ ] A launch that exceeds the internal deadline is stopped with SIGTERM (then SIGKILL after a grace) and the child's partial WIP is COMMITTED to `work/<slug>` and PUSHED to the arbiter (test end-to-end with an injected fast deadline + a stub/slow agent).
- [ ] AUTO-CONTINUE on progress: a deadline checkpoint whose WIP DIFFERS from the session-start branch tip, under the ceiling, RELEASES the lock (item eligible again), leaves the branch, writes NO `needsAnswers` sidecar, and returns `exitCode: 0`; the next claim continues from the branch tip (test: injected deadline + agent that made a change ⇒ no sidecar, lock released, branch carries the WIP).
- [ ] SURFACE on no-progress: a deadline checkpoint that made NO new work this session surfaces a `needsAnswers:true` question (human decides), NOT an auto-continue — the anti-loop guard (test: injected deadline + agent that changed nothing ⇒ sidecar surfaced).
- [ ] CEILING: after `maxAutoCheckpoints` consecutive deadline auto-continues the checkpoint STOPS auto-requeuing and surfaces a `needsAnswers:true` question ("hit the deadline N times — split or run locally?"); the counter resets on any non-deadline outcome (test: drive the counter to the ceiling ⇒ surface).
- [ ] The checkpoint reason is DISTINCT ("deadline checkpoint (auto-continued N/max)" vs "deadline checkpoint (no progress / ceiling)"), never a generic agent-failed — verified in the recorded reason.
- [ ] A launch that finishes BEFORE the deadline is byte-for-byte unchanged (the timer is cleared; no SIGTERM, same `LaunchResult`) — a control test.
- [ ] The advance-lifecycle template renders GitHub `timeout-minutes` STRICTLY GREATER than the dorfl internal deadline (backstop above the primary stop), with the headroom for pre/post steps; a config test pins `timeout-minutes = agentDeadlineMinutes + checkpointHeadroomMinutes` and that it is never ≤ the deadline.
- [ ] The internal deadline is resolved through the standard flag > env > per-repo > global > default chain; default 120 min; a config test covers the precedence.
- [ ] Both `do` (in-place) and `run` paths honour the deadline + checkpoint (the shared save path already spans both — verify the mirror).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Prompt

> Goal: add a dorfl-INTERNAL agent deadline that GRACEFULLY stops the agent and SAVES its WIP (commit to `work/<slug>` + push) BEFORE the GitHub `timeout-minutes` hard kill, so a legitimately-long autonomous leg makes resumable progress across runs instead of losing everything. The GitHub cap becomes a backstop set ABOVE the internal deadline. Per observation `timeout-minutes-hard-kill-loses-all-wip-no-branch-saved-2026-07-13` (option 2).
>
> DRIFT-CHECK FIRST (verify against the code; STOP with the specific obstruction if a premise is false): the launch seam is `runDoAgent` (`do.ts`) → `launchWithOptionalWatch` (`agent-launch.ts`) → `PiHarness.launchAsync` (`pi-harness.ts`), which `spawn`s pi and resolves on child `exit`; the work-preserving save path is `saveAgentFailure` (`do.ts`) → `applyNeedsAttentionTransition` (commit WIP → push `work/<slug>` → mark stuck); `legTimeoutMinutes` renders GitHub `timeout-minutes` in `advance-lifecycle-template.ts`. Confirm these before editing.
>
> Build: (1) thread an optional deadline (an `AbortSignal` or `deadlineMs`) through `LaunchInput` → `launchWithOptionalWatch` → `launchAsync`; (2) in `launchAsync`, race the child against the deadline — on fire SIGTERM (then SIGKILL after a ~10s grace), resolve the `LaunchResult` with a `timedOut`/checkpoint flag, preserving the settle-once + FD-release discipline; (3) in `do.ts`/`run.ts`, on a deadline stop ALWAYS save WIP (commit + push `work/<slug>`, reusing the save half of `saveAgentFailure`/`applyNeedsAttentionTransition`), THEN decide: made-progress-this-session (WIP differs from the session-start tip, reusing the `noop-backstop-counts-branch-commits` progress notion) AND under `maxAutoCheckpoints` ⇒ AUTO-CONTINUE (release lock, leave branch, NO sidecar, exit 0, increment counter); else ⇒ SURFACE a `needsAnswers:true` question (human decides continue/split/cancel); (4) add resolved config `agentDeadlineMinutes` (default 120), `checkpointHeadroomMinutes` (default e.g. 20), `maxAutoCheckpoints` (default e.g. 5), standard precedence; change the template so GitHub `timeout-minutes = agentDeadlineMinutes + checkpointHeadroomMinutes` (strictly greater).
>
> The anti-loop guard is LOAD-BEARING: unconditional auto-requeue turns a wedged agent into an infinite CI-burning loop (worse than today). Auto-continue ONLY on real progress + under the ceiling; a no-progress or ceiling-hit checkpoint SURFACES to a human. Do NOT auto-continue unconditionally.
>
> Do NOT hook GitHub's SIGKILL (impossible; the internal deadline is the point). Do NOT add a continue-token protocol (the branch push IS the checkpoint; `requeue --continue` resumes). A run finishing before the deadline must be byte-for-byte unchanged (clear the timer on normal exit).
>
> Test: end-to-end deadline-checkpoint (inject a fast deadline + slow/stub agent, assert WIP committed + pushed + requeue-continue resumes); a control run under the deadline unchanged; config precedence + the template `timeout-minutes > deadline` invariant. Done = graceful checkpoint saves + resumes, GitHub cap is a strictly-larger backstop, both do/run honour it, gate green. RECORD the config-vocabulary decision (deadline vs backstop naming; whether `legTimeoutMinutes` is renamed/re-derived) durably; if it meets the ADR gate (a user-visible config-contract change), write an ADR.
