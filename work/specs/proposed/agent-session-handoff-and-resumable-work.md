---
title: Agent session handoff & resumable work (carry resume-CONTEXT across deadline checkpoints, harness-agnostically)
slug: agent-session-handoff-and-resumable-work
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked: they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The shipped graceful pre-timeout checkpoint (task `graceful-pre-timeout-wip-checkpoint`, ADR `graceful-pre-timeout-checkpoint-vocabulary`) gives dorfl an internal agent deadline: when a leg runs long, dorfl SIGTERMs the agent, saves its WIP to `work/<slug>` as a `chore(deadline-checkpoint)` marker commit, and auto-continues across ticks (progress-gated, with a `maxAutoCheckpoints` ceiling before it surfaces to a human). It is merged and working. It preserves the WIP BYTES.

What it does NOT preserve is the resume-CONTEXT. The next tick's continue-agent is a FRESH agent session with no memory of what the prior session did or intended. It inherits a half-done working tree and must reverse-engineer the diff to answer "what did a previous me already do, and what's left?" That re-orientation is expensive and carries real thrash risk: the fresh agent can re-run a migration over already-migrated files, undo an in-progress refactor, or drive the half-done tree in a different direction than the session that started it.

Crucially, this is NOT a correctness blocker, and the spec must be framed accordingly. LIVE EVIDENCE: the checkpoint feature completed its own hardest case, PR-2b `bounce-migrate-stuck-assertions-and-flip-exit-codes` (a 48-file / +1268-line migration), by DRAINING across THREE autonomous sessions: two `chore(deadline-checkpoint)` commits (`005fe5dc`, `b84fe504`) followed by a completing run. Context-less resume DEMONSTRABLY WORKS: a fresh agent reading a half-done tree can, and did, finish a large migration coherently. (It needed a hand-authored resumption preamble bolted onto that one task's prompt, commit `52412694`, to do it smoothly: evidence that the RE-ORIENTATION cost is real and generic, not that resume is broken.)

So the problem this spec frames is an OPTIMIZATION, not a fix: reduce the re-orientation cost and thrash risk of a resumed checkpoint, so a genuinely-over-cap task drains across ticks CHEAPLY and COHERENTLY instead of paying a full reverse-engineering tax each session, and do it once, generically, for every task rather than per-task preamble edits.

A second, structural problem sits underneath it. The base checkpoint's resume path, and any richer handoff built on it, is pi-only. The null/shell harness config is a single opaque command template (`agentCmd: string`), and its `HarnessRecord` records only `{pid, command}`: it has no way to express "to RESUME a session, run THIS instead," and no way to LEARN what session (if any) a shell launch created. So any non-pi agent that natively supports resume (Claude Code, Codex, and the like) is locked out of the whole feature by the shape of the seam, not by any real limitation of the agent.

## Solution

One feature, two layers, both ADDITIVE over the shipped checkpoint and both degrading cleanly to today's WIP-only save.

**Layer 1: a HANDOFF NOTE authored by the session that did the work.** At checkpoint time, BEFORE finalizing the save, dorfl RESUMES the paused agent session for ONE hard-bounded turn (`pi --print --continue --session <path>`) and asks it to write a concise handoff: what's DONE, what's LEFT, the current TREE STATE (does build/test/format pass? if red, why + which files), and the EXACT next step. The agent that just did the work authors this WHILE it still has full context in the resumed session. This is strictly better than the two alternatives: mid-run injection is impossible under `pi --print` (no live stdin to a running turn), and a static prompt preamble (the PR-2b hand-edit) is generic boilerplate written by someone who never saw this specific half-done tree. The handoff note is folded into the SAME checkpoint commit that pushes the WIP (no extra push), and the resume side reads it FIRST. If the handoff turn fails, times out, or there is no session, it degrades cleanly to today's WIP-only save: the handoff is a best-effort enrichment, NEVER a gate on preserving work.

**Layer 2: a harness seam so this is not pi-only.** The null/shell `agentCmd` becomes a STRUCTURED shape (`{run, continue?, interactive?, sessionFrom?}`), a backward-compatible superset of today's bare string, with a `{model}` + `{session}` placeholder vocabulary. Critically, the seam gains a session-CAPTURE direction: dorfl must LEARN the session id a shell launch used, not just inject one. Two strategies in preference order: (preferred) INJECT-A-KNOWN-ID, where dorfl generates an id and injects it via `{session}` into both `run` and `continue`, mirroring pi's `--session-id`, so dorfl already knows it with no parsing; (fallback) a `sessionFrom` EXTRACTOR (stdout regex or file) for an agent that mints its own id. Both directions of the seam (inject and capture) land in the existing `HarnessRecord.session`. With this, a shell agent that supports resume gets handoffs exactly like pi.

The net user-visible effect: a genuinely-over-cap task that drains across N sessions carries an authoritative "here's where I got to" note from each session to the next, for pi AND for any configured shell agent, and nothing about work preservation regresses if the handoff cannot be produced.

## User Stories

1. As a maintainer running a genuinely-over-cap task under autonomous CI, I want each deadline checkpoint to leave an authoritative "what's done / what's left / next step" note, so the next session resumes coherently instead of reverse-engineering a half-done diff.
2. As the agent that hit the deadline, I want ONE bounded turn (with my full session context still live) to record my own handoff, so the note reflects what I actually intended, not a guess reconstructed from bytes.
3. As a resuming continue-agent on a checkpoint branch, I want to be pointed at the latest handoff note FIRST, generically (the engine prepends it when a resumed checkpoint branch carries one), so I orient in seconds without a per-task prompt edit.
4. As a maintainer, I want a failed, timed-out, or session-less handoff turn to NEVER lose work (it degrades to exactly today's WIP-only checkpoint), so enabling handoffs can only help, never risk the preserved bytes.
5. As a maintainer, I want the handoff turn HARD-bounded by its own short sub-deadline (and a small tool budget), so the enrichment step can never itself wedge the leg or eat the checkpoint's headroom.
6. As an adopter using a non-pi shell agent (Claude Code, Codex, …), I want the same handoff behaviour, so the feature is not silently pi-only.
7. As an adopter with an existing bare-string `agentCmd`, I want it to keep working byte-for-byte, so adopting the structured shape is opt-in and nothing I already configured breaks.
8. As an adopter whose agent accepts a caller-supplied session id, I want dorfl to generate and inject a known id (like pi's `--session-id`), so dorfl round-trips the session with no fragile output parsing.
9. As an adopter whose agent mints its own session id, I want a minimal `sessionFrom` extractor (stdout regex or a file the agent writes) to capture it, so resume still works when I cannot inject the id.
10. As a maintainer, I want the handoff note kept in a discardable bucket (`work/notes/handoffs/<slug>.md`) that rides the branch and is discarded on integration / `--reset`, so it never pollutes `main` or lingers after the task lands.
11. As a maintainer, I want the base checkpoint's auto-continue / surface / ceiling routing UNCHANGED, so this feature adds resume context without touching the (working, load-bearing) anti-loop machinery.
12. As a maintainer, I want each checkpoint's handoff to supersede the previous one (latest wins on the branch), so a multi-session task always resumes from the most recent state, not a stale first-session note.
13. As a reviewer, I want the durable WHY of the session-resume seam and the handoff mechanism recorded (ADRs), so the harness-vocabulary expansion and the "resume-the-paused-session" decision are ratified, not reverse-engineered later.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** omitted. Tasking this spec is ordinary engineering work with no product/security/release judgement that binds a human to drive the tasking.
- **`needsAnswers`:** omitted. The cross-task decisions the two backlog tasks left open are RESOLVED below (Implementation Decisions §Resolved cross-task decisions); nothing blocks autonomous tasking.

## Implementation Decisions

### Grounded seams (verify at build; STOP if a premise is false)

- The deadline hook is `routeDeadlineCheckpoint` (`packages/dorfl/src/do.ts`, mirrored in `run.ts`), fired when the launch reports the deadline stop; it calls `saveDeadlineCheckpoint` (commit the tree + `chore(deadline-checkpoint)` marker + push `work/<slug>`) and then applies the progress+ceiling routing. The handoff turn INSERTS between "agent timed out" and "save WIP," so the note rides the SAME checkpoint commit.
- `runDoAgent` (`do.ts`) returns `{ok, detail, output, timedOut}` and does NOT currently surface the session path. It must surface `LaunchResult.record.session` so `routeDeadlineCheckpoint` knows which session to resume.
- The harness contract lives in `packages/dorfl/src/harness.ts`: `Harness`, `LaunchInput` (already carries an optional `session` and a deadline), `HarnessRecord.session` ("Adapter-specific session pointer", already exists, the null adapter just never populates it), `NullHarness`, `substituteModel`, and the `{model}` placeholder. The pi adapter (`pi-harness.ts`, `launchAsync`, the SIGTERM/grace/SIGKILL race, `PiHarnessRecord.session`) already generates + injects + records the pi session path via `generateSessionPath`.
- `config.ts` holds `agentCmd`. pi's `--print` / `--continue` / `--session <path|id>` / `--session-id <id>` are all confirmed present in `pi --help`.

### The handoff turn (layer 1)

- A harness capability `continueSession({session, prompt, dir, model, env, deadlineMs})` resumes a session for ONE turn. pi form: `pi --print --continue --session <session>`, reusing the existing `launchAsync` deadline-race (SIGTERM → ~grace → SIGKILL) with a SHORT own sub-deadline (a new `handoffDeadlineMinutes`, default ~5) so the handoff turn can never wedge the leg.
- `deadlineMs` CONVENTION: `continueSession`'s `deadlineMs` MUST be the SAME absolute-epoch-ms wall-clock convention `LaunchInput.deadlineMs` already uses (`harness.ts`), NOT a raw duration. Resolve `handoffDeadlineMinutes` to it exactly as `runDoAgent` already does for the leg deadline (`Date.now() + minutes * 60_000`), so the handoff sub-deadline and the leg deadline share one convention and cannot diverge.
- The handoff prompt is bounded and focused: "You hit the pause deadline and are being checkpointed. Write a SHORT handoff to `work/notes/handoffs/<slug>.md` for the agent resuming this branch next tick: (a) what you COMPLETED, (b) what REMAINS, (c) current tree state (does build/test/format pass? if red, why + which files), (d) the EXACT next step. Commit ONLY that note. Do NOT continue the main task, you are out of time." Cap the turn hard (sub-deadline + small tool budget).
- `saveDeadlineCheckpoint` folds the note into the same commit+push (the tree now includes the handoff). A failed / absent / session-less handoff DEGRADES to today's WIP-only save, never a gate.
- The base checkpoint's progress+ceiling routing (auto-continue / surface / ceiling) is UNCHANGED; the handoff is inserted before the save and alters nothing about the routing decision.

### The harness seam (layer 2)

- `agentCmd` parses as EITHER a string (today, unchanged; the string IS `run`) OR `{run: string, continue?: string, interactive?: string, sessionFrom?: <capture spec>}`. Missing `continue` ⇒ `continueSession` is a clean no-op for that harness. For the BARE-STRING form the other operations fall back: `continue` ⇒ no-op (today's degrade), `interactive` ⇒ run-fresh where applicable. The `interactive?` member maps to the existing `launchInteractive` seam (`harness.ts`), so a shell agent with a distinct interactive invocation can express it too; it is optional and orthogonal to the handoff path (which uses only `run`/`continue`).
- Placeholder vocabulary extends `{model}` with `{session}`; the prompt stays on STDIN (not a placeholder), matching today. Generalise `substituteModel` into a `substitutePlaceholders` that handles both and FAILS LOUD on a present-but-unresolved placeholder (e.g. `{session}` in `continue` with no capture strategy), the same discipline `substituteModel` already uses for `{model}`.
- Session CAPTURE, two strategies in preference order, both recorded into `HarnessRecord.session`:
  - (preferred) INJECT-A-KNOWN-ID: dorfl generates an id, injects it as `{session}` into `run` and `continue`, records it. No parsing; dorfl controls the id exactly as pi does today.
  - (fallback) `sessionFrom` EXTRACTOR, kept MINIMAL: `{ stdout: "<regex with one capture group>" }` OR `{ file: "<path the agent writes>" }`. The adapter runs the extraction after launch and records the result.
  - Neither configured ⇒ `HarnessRecord.session` stays unset ⇒ `continueSession` no-ops (the documented degrade).
- `{session}` is treated as an OPAQUE string dorfl round-trips (a path for pi, whatever `--resume`/`--session` wants for a shell agent). This is a RESOLVED decision, not an open question: the id-vs-path meaning is the ADAPTER's to interpret; dorfl never parses it, it only generates/captures and hands it back verbatim on `continueSession`. (The pi adapter already treats it as a path; a shell adapter treats it as whatever its `continue` template consumes.)

### Resolved cross-task decisions (the two backlog tasks left these open; this spec RESOLVES them, does not defer)

1. **Sequencing / ownership of `continueSession`: DEFINE IT ONCE, seam-foundation FIRST.** The structured-`agentCmd` + session-capture foundation lands FIRST and introduces `continueSession` on the `Harness` contract (pi: native `--continue`; null: run the `continue` template, or clean no-op when absent). The handoff-note task then CONSUMES that single method for both pi and shell from day one. Rationale: defining `continueSession` in the same task that establishes the placeholder/capture vocabulary keeps the method's signature and the seam it depends on in one changeset, avoids a pi-only interim shape that the second task would have to widen, and means the handoff feature is never pi-only even for one release. (The backlog tasks offered both orderings; this is the pick.)
2. **Handoff bucket: `work/notes/handoffs/<slug>.md`.** A new `notes/` sub-bucket. It is BRANCH-LOCAL working state: written on the checkpoint branch, superseded each checkpoint (latest wins), and discarded with the branch on integration / `--reset`. It never lands on `main`. It is exempt from status flow (a capture bucket, per WORK-CONTRACT.md), and, being discarded with the branch, leaves no litter.

   COHERENCE CAVEAT (tasking must ratify): this is a FOURTH `notes/` bucket, and its polarity DIFFERS from the three the WORK-CONTRACT + `CONTEXT.md` glossary pin (`ideas/` editable, `observations/` append-only, `findings/` durable-external, ALL living on `main` and leaving by DELETION). A handoff is branch-local, superseded-latest-wins, and discarded WITH THE BRANCH (never on `main`), so it does not obey the capture-bucket "leaves by deletion on `main`" rule. Two honest resolutions; tasking picks ONE and records it durably (an ADR-gated call):
   - **(preferred) keep it under `notes/handoffs/` but PIN the new term** in `CONTEXT.md` (the glossary) AND `WORK-CONTRACT.md` (the capture-bucket table), naming its distinct polarity (branch-local, superseded, discarded-with-branch) so the next author cannot re-fork or mistake it for an on-`main` bucket. The pin lands WITH the code (glossary/contract are current-truth docs, updated at integration, not by this launch-snapshot spec).
   - **(alternative) place it OFF the ledger entirely** (a branch-only file NOT under `work/notes/`, e.g. a `.git`-adjacent or worktree-root path), so it never touches the `notes/` umbrella and needs no contract change.
   Do NOT silently add a fourth bucket without one of these; an unpinned term is exactly the coherence debt this caveat exists to stop.
3. **Resume-side reading: the ENGINE prepends generically, NOT per-task prompt edits.** When a resumed checkpoint branch carries a `chore(deadline-checkpoint)` marker AND a `work/notes/handoffs/<slug>.md`, the engine prepends a single "read the handoff at `work/notes/handoffs/<slug>.md` FIRST" line to the continue-agent's prompt. This retires the interim per-task preamble hack (PR-2b's `52412694`) in favour of one generic mechanism every resumed task benefits from.
4. **`sessionFrom` shape: MINIMAL, stdout-regex + file only.** `{ stdout: "<regex, one capture group>" }` OR `{ file: "<path>" }`. No env/JSON-field extractor until a real target agent demands it. Inject-a-known-id is preferred and covers the common case; `sessionFrom` is the fallback for self-minting agents.

## Testing Decisions

- End-to-end handoff (pi path): inject a fast deadline + a stub harness whose `continueSession` writes a canned note; assert the note lands in the SAME checkpoint commit that pushes the WIP, and that the resumed branch carries it.
- Degrade paths: a failed / timed-out `continueSession` AND a session-less (null, no `continue`) harness each save WIP exactly as today, no handoff, no error.
- Hard-bound: assert the handoff turn cannot exceed its sub-deadline (SIGTERM → grace → SIGKILL applies to the resume turn too).
- Base routing unchanged: auto-continue / surface / ceiling behaviour from the shipped checkpoint is byte-for-byte unaffected by the handoff insertion (a regression control).
- Structured `agentCmd`: bare-string is byte-for-byte unchanged (control); the object shape parses + validates and fails loud on a bad shape / unresolved `{session}`.
- Session capture: inject-a-known-id round-trips through `HarnessRecord.session` and is reused on `continueSession` (stub agent echoing its args); `sessionFrom` stdout-regex and file each capture a self-minted id.
- Resume-side wiring: a resumed checkpoint branch carrying a handoff surfaces the "read the handoff first" line to the continue-agent (engine-prepended), verified by the prompt content.
- SHARED-STORE ISOLATION (WORK-CONTRACT.md task-quality rule): any test that drives a real agent session store must point it at a temp/scratch dir (e.g. `PI_CODING_AGENT_SESSION_DIR` / `--session-dir`) AND assert the real store is UNTOUCHED after the run. A malformed session fixture in a shared store can crash unrelated tooling; a synthetic fixture must be VALID per the tool's contract. This MUST be an explicit ACCEPTANCE CRITERION (a checkbox) on the handoff-routing task, not merely prose, because resuming a real session touches `PI_CODING_AGENT_SESSION_DIR`; and the handoff-routing tests should drive a STUB `continueSession` that writes a canned note (never a real pi turn) so they are deterministic and never touch the real store.

## Out of Scope

- **A full continue-token / resumable-task protocol.** The branch push IS the durable checkpoint; the handoff note is an ENRICHMENT of the existing resume, not a new protocol. (This spec deliberately builds only the minimal high-value slice the base checkpoint's non-goals deferred.)
- **Per-agent presets** (a built-in "claude" / "codex" profile). `agentCmd` expresses resume generically via the structured shape; presets are a later convenience, not this feature.
- **Any change to the base checkpoint ROUTING.** Auto-continue / surface / ceiling / the anti-loop counter / the deadline vocabulary (`agentDeadlineMinutes` / `checkpointHeadroomMinutes` / `maxAutoCheckpoints`) are all UNCHANGED. This feature inserts a handoff turn and reads it back; it touches nothing in the progress-gated routing.
- **Mid-run injection into a live turn.** Impossible under `pi --print` (no live stdin); the resume-a-paused-session turn is the sanctioned mechanism.
- **A richer `sessionFrom` (env/JSON-field extractor).** Minimal stdout-regex + file only; add on demand (an incubating idea, not a task).

## Further Notes

- The two existing backlog tasks (`harness-structured-agentcmd-and-session-resume`, the seam foundation, and `deadline-checkpoint-writes-handoff-note`, the handoff routing) are the STARTING POINT for decomposition, but they overlap on `continueSession` ownership and each carried the open questions this spec now resolves. When this spec is tasked, they should be DROPPED / FOLDED into the spec's re-decomposition (see the tasking note below), so the resolved sequencing and the resolved decisions are the single source of truth, not scattered across two tasks that each left the ordering to "the maintainer picks."
- Suggested decomposition (two tasks, reconciled under this spec):
  1. **`harness-structured-agentcmd-and-session-resume`** (foundation, lands first): structured `agentCmd` `{run, continue?, interactive?, sessionFrom?}`, the `{model}`+`{session}` placeholder vocabulary (`substitutePlaceholders`, fail-loud), session capture (inject-a-known-id preferred; `sessionFrom` stdout-regex/file fallback) into `HarnessRecord.session`, and the `Harness.continueSession` method (pi native; null runs the `continue` template or no-ops). Bare-string + pi unchanged. Owns the harness-seam ADR.
  2. **`deadline-checkpoint-writes-handoff-note`** (`blockedBy: [harness-structured-agentcmd-and-session-resume]`): surface the session path to `routeDeadlineCheckpoint`; run the bounded handoff turn via `continueSession` before the WIP save (resolving `handoffDeadlineMinutes` to the absolute-epoch `deadlineMs` convention); fold the note into the checkpoint commit; degrade cleanly on failure/no-session; the engine prepends the generic "read the handoff first" line on a resumed checkpoint branch; `handoffDeadlineMinutes` (default ~5) config knob; carries the handoff-bucket coherence pin (glossary/contract) and the shared-store-isolation ACCEPTANCE CRITERION. Base routing unchanged. Owns the handoff-mechanism ADR and retires the PR-2b interim preamble.
