---
title: Deadline checkpoint writes a HANDOFF NOTE by resuming the paused pi session (pi --continue)
slug: deadline-checkpoint-writes-handoff-note
spec: graceful-pre-timeout-wip-checkpoint
originTrust: trusted
---

## Problem (the resume-context gap the checkpoint feature left open)

The graceful-checkpoint feature (`graceful-pre-timeout-wip-checkpoint`, merged #366) saves a paused leg's WIP to the branch and auto-continues across ticks. But it saves the BYTES, not the CONTEXT: the next tick's continue-agent is a FRESH pi session with NO memory of what the prior session did or intended. On a large task (validated live: PR-2b `bounce-migrate-stuck-assertions-and-flip-exit-codes` checkpointed with a 33-file / +775-line half-done migration on the branch) the resume-agent must reverse-engineer the diff to figure out "what did a previous me already do, and what's left." That is expensive and error-prone: it can thrash, re-run a migration over already-migrated files, or drive the half-done tree in a different direction than the first session started. The checkpoint proved it can PRESERVE work; it does not yet make that work RESUMABLE COHERENTLY.

The original checkpoint task explicitly deferred a "continue-token / resumable-task protocol" as out of scope. This task builds the minimal, high-value version of it: a HANDOFF NOTE authored by the session that actually did the work, while it still has full context.

## Key enabling fact (verified against `pi --help`)

pi natively supports SESSION CONTINUATION: `--continue` / `--session <path>` with `--print`. The harness ALREADY records the session file (`PiHarnessRecord.session`, `pi-harness.ts`). So at the deadline we can RESUME THE ACTUAL PAUSED SESSION (with its full conversation context) and give it ONE more turn: "write your handoff note." The agent that just did the work writes the handoff, because its whole context is still in the resumed session. This is strictly better than a fresh agent reverse-engineering the diff, AND better than a static prompt preamble.

## Goal

When a leg hits the dorfl-internal deadline, BEFORE finalizing the checkpoint, resume its pi session for a SHORT bounded turn that writes a concise HANDOFF NOTE (what's done / what's left / current tree state / exact next step), commit it alongside the WIP, and have the next-tick continue-agent read it. The handoff makes cross-tick resume coherent for genuinely-over-cap tasks.

## Design (grounded — verify at build, STOP if a premise is false)

The seam is `routeDeadlineCheckpoint` (`do.ts`, and its `run.ts` mirror) — the existing hook that fires when `agent.timedOut`. Today it saves WIP + decides auto-continue/surface. INSERT the handoff step between "agent timed out" and "save WIP":

1. **Thread the SESSION PATH to the checkpoint routing.** `runDoAgent` currently returns `{ok, detail, output, timedOut}` but NOT the session file. Surface `LaunchResult.record.session` (pi adapter) so `routeDeadlineCheckpoint` knows which session to resume. (Non-pi harnesses have no session ⇒ the handoff step is a clean no-op; the checkpoint save is unchanged.)

2. **Add a harness capability to RESUME a session for one more turn.** A new `Harness` method (e.g. `continueSession({session, prompt, dir, model, env, deadlineMs})`) that runs `pi --print --continue --session <path>` with the handoff prompt on stdin. It REUSES the deadline-race machinery already in `launchAsync` (SIGTERM+grace+SIGKILL) with a SHORT own budget (e.g. `handoffDeadlineMinutes`, default 5) so the handoff turn itself can never wedge the leg. Null/shell harness: no-op HERE (returns cleanly) — null-harness PARITY (structured `agentCmd` with a `continue` template + session capture so shell agents get handoffs too) is the SEPARATE foundational task `harness-structured-agentcmd-and-session-resume`. Coordinate ownership so `continueSession` is DEFINED ONCE: either this task defines it pi-first (null no-op) and the foundational task extends it, or the foundational task lands first and this task uses it for both. The maintainer picks the order (see the open question).

3. **The handoff prompt (bounded + focused).** Fed to the resumed session: "You have hit the pause deadline and are being checkpointed. Write a SHORT handoff note to `work/notes/handoffs/<slug>.md` for the agent who will resume this branch next tick: (a) what you COMPLETED this session, (b) what REMAINS, (c) the current tree state (does build/test/format pass? if red, WHY + which files), (d) the EXACT next step. Be concise and concrete. Commit ONLY that note. Do NOT continue the main task — you are out of time." Cap the turn hard (the handoff sub-deadline + a small tool budget) so it writes the note and stops.

4. **Fold the handoff into the checkpoint save.** After the handoff turn, the existing `saveDeadlineCheckpoint` commits the tree (which now includes `work/notes/handoffs/<slug>.md`) + the `chore(deadline-checkpoint)` marker + pushes. The handoff rides the SAME commit/push — no extra push. If the handoff turn FAILS (harness error, timeout, no session) it is a clean degrade: save the WIP anyway WITHOUT a handoff (today's behaviour) — the handoff is a best-effort ENRICHMENT, never a gate on preserving work.

5. **The resume side reads the handoff.** A continue-agent's prompt (the task `## Prompt`, or a resumption preamble the engine prepends when a `chore(deadline-checkpoint)` marker + a handoff note are present) points it at `work/notes/handoffs/<slug>.md` FIRST. Prefer the ENGINE prepending it generically (so every resumed task benefits) over per-task prompt edits. The handoff note is superseded/rewritten each checkpoint (latest wins) and discarded on integration/`--reset` with the branch.

## Open questions (ratify before / during build)

- **Handoff location:** `work/notes/handoffs/<slug>.md` (a new notes sub-bucket) vs on the item body vs a branch-only file (not on the ledger). Proposed: `work/notes/handoffs/` (durable, visible, discarded with the branch on integration). Confirm the bucket.
- **Resume-prompt wiring:** engine-prepends-generically (preferred) vs per-task prompt preamble (the interim `bounce-migrate` preamble is the latter). Confirm which.
- **`continueSession` scope:** a full new `Harness` method vs a flag on the existing launch. A method is cleaner (distinct semantics: resume vs fresh) but adds surface. Confirm.

## Acceptance criteria

- [ ] On a deadline stop with a pi session, the checkpoint resumes that session (`pi --print --continue --session <path>`) for a bounded turn that writes `work/notes/handoffs/<slug>.md`, and the note lands in the SAME checkpoint commit that pushes the WIP (test end-to-end with an injected deadline + a stub harness whose `continueSession` writes a canned note).
- [ ] The handoff turn is HARD-bounded (its own short sub-deadline) and can never wedge the leg; a failed/absent handoff DEGRADES cleanly to today's WIP-only save (test both the success and the degrade path).
- [ ] A non-pi harness (no session) is a clean no-op: WIP saved exactly as today, no handoff, no error.
- [ ] The next-tick resume path surfaces the handoff to the continue-agent (engine-prepended or documented prompt hook), verified by the presence + content of the note on a resumed branch.
- [ ] Auto-continue / surface / ceiling behaviour from the base checkpoint feature is UNCHANGED (the handoff is additive; it does not alter the routing decision).
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Prompt

> Goal: enrich the deadline checkpoint (`graceful-pre-timeout-wip-checkpoint`, #366) so it writes a HANDOFF NOTE by RESUMING the paused pi session (`pi --print --continue --session <path>`) for one bounded turn before finalizing the save — so a cross-tick resume reads an authoritative "what's done / what's left / next step" note instead of reverse-engineering a half-done diff. pi natively supports `--continue`/`--session` (verified in `pi --help`); the harness already records the session (`PiHarnessRecord.session`).
>
> DRIFT-CHECK FIRST (STOP with the specific obstruction if false): the deadline hook is `routeDeadlineCheckpoint` (`do.ts` + its `run.ts` mirror), fired on `agent.timedOut`; `saveDeadlineCheckpoint` commits+pushes the WIP; `PiHarness` records the session file; `runDoAgent` returns `{ok,detail,output,timedOut}` and does NOT currently surface the session path (thread it through). Confirm pi's `--continue --session` resumes an existing session with a new stdin turn.
>
> Build: (1) surface the pi session path from the launch to `routeDeadlineCheckpoint`; (2) add a `Harness.continueSession({session,prompt,dir,model,env,deadlineMs})` that runs `pi --print --continue --session <path>` reusing the SIGTERM/grace/SIGKILL race with a SHORT own sub-deadline (default ~5m); null/shell harness is a no-op; (3) in `routeDeadlineCheckpoint`, BEFORE the WIP save, run the handoff turn with the focused prompt (write `work/notes/handoffs/<slug>.md`: done/remaining/tree-state/next-step, commit only that, do NOT continue the task); (4) let the existing `saveDeadlineCheckpoint` fold the note into the same commit+push; a failed/absent handoff DEGRADES to WIP-only (never gate work preservation on it); (5) surface the handoff to the next-tick continue-agent (PREFER engine-prepending a "read work/notes/handoffs/<slug>.md first" line generically when a resumed checkpoint branch carries one).
>
> Do NOT alter the base checkpoint's auto-continue/surface/ceiling routing — the handoff is ADDITIVE. Do NOT let the handoff turn wedge the leg (hard sub-deadline + small tool budget). Do NOT gate WIP preservation on the handoff succeeding.
>
> Done = deadline checkpoint writes + commits a handoff note by resuming the session, degrades cleanly on failure/no-session, the resume side reads it, base routing unchanged, gate green. RECORD the resolved open questions (handoff bucket, resume-prompt wiring, continueSession shape) durably; the harness-session-resume capability likely meets the ADR gate.
