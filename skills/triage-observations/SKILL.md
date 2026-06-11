---
name: triage-observations
description: Drain the work/observations/ inbox ONE note at a time as a human-in-the-loop triage loop — for each observation, READ it, INVESTIGATE its claim against current reality (code/slices/PRDs/ADRs), RECOMMEND exactly one disposition (leave / delete / make-slice / amend / fold-into-ADR), WAIT for the human's decision, then EXECUTE it with writes + scoped commits. Defaults to alphabetical (folder-listing) order for a deterministic full pass; the human may override. Use when asked to triage/trim/prune/clean the observations backlog, decide what to do with each observation, or drain work/observations/ toward a live-only inbox. Protocol-native (assumes the work/ contract); the INVERSE of capture-signal. NEVER auto-decides — the human owns each call. The investigate-before-judging discipline is the point: an observation is a SPOTTED, often-stale signal, not ground truth.
---

# Triage observations

Drain `work/observations/` toward a **live-only inbox**: every note that survives is still a useful signal; everything else is discharged. You are the investigator + recommender; the **human owns every disposition call**.

> An observation is a **spotted, unverified, often-stale signal** — NOT ground truth. The whole value of this loop is *investigating before judging*: "this is surely irrelevant now" must become a real check against current code, which sometimes agrees and sometimes doesn't.

## The loop (one observation at a time)

Default to **alphabetical order** (the folder listing — `ls work/observations/`), so a full pass deterministically covers the whole inbox with nothing skipped or repeated. The human may override with their own order or name specific files; when they do, follow that and do NOT jump ahead or batch. For each:

1. **READ** the observation in full.
2. **INVESTIGATE** its claim against *current reality* — read the actual code, slices, PRDs, ADRs, and protocol docs it references. Confirm every file/line pointer (repos drift; paths move — e.g. a monorepo's `packages/*/src/`). Establish: is this signal still LIVE?
3. **RECOMMEND** exactly one disposition (below), with reasoning grounded in what you found — not a guess.
4. **WAIT** for the human's decision. Never auto-decide. Surface any genuine judgement residue (e.g. "is this PRD's unsliced state intentional?") as an explicit question.
5. **EXECUTE** the chosen disposition with writes, then **COMMIT** (scoped — one logical change per commit) before moving on.
6. **UPDATE** a running checklist of dispositions so the session has an at-a-glance summary.

## The disposition vocabulary

| disposition | when | execution |
| --- | --- | --- |
| **leave** | still a live, useful signal; just not acting now | nothing (note stays) |
| **delete** | no longer a live signal — its work landed, the defect is fixed, or it was promoted into a self-contained slice/ADR | `git rm` the file |
| **make a slice** | there is buildable residue worth promoting | write a SELF-CONTAINED slice (carries mechanism + fix shape, NOT a back-pointer), then delete the note |
| **amend** | still live but inaccurate/stale; the *record* should be corrected | edit the note (observations are append-only in spirit — prefer an `## Update` over rewriting what was seen) |
| **fold-into-ADR / code comment** | the durable *why* belongs in an ADR or a code comment, not the inbox | write the ADR note / comment, then delete the note |

A note's liveness test is **"is this still a useful signal?"** — NOT "has the work it points at completed?".

## Protocol rules this loop enforces

Apply the `work/` contract (`work/protocol/WORK-CONTRACT.md`), especially:

- **Discharge by deletion.** A capture-bucket note leaves the inbox by **deletion** the moment it stops being a live signal (git history is the archive). There is no `resolved` status; a note annotated "resolved" and kept is a contradiction.
- **Promoted notes discharge on SPAWN, not on landing.** A note promoted into a slice/ADR is deletable AS SOON AS that artifact carries its signal — *verify self-containment first* — NOT when the spawned work lands in `done/`. "Delete once the slice lands" is the resolved-but-kept contradiction. If the spawned artifact is NOT self-contained, the bug is the artifact (fix it to carry the signal), not a reason to keep the note.
- **Forward & live only.** Don't back-fill a slice/observation to narrate already-done work. A surviving observation describes a *pending or currently-signalled* concern.

## Two common discharge patterns

- **The spent drift-pointer:** the slice/code it warned about already landed, and its warning was inlined into that artifact → **delete**.
- **The fixed-defect note:** read the code; if the defect it describes is gone, the note is a tombstone → **delete** (optionally preserve the *why* as a code/ADR note first).

## Repo-specific trap (agent-runner)

`agent-runner` is both **author and user** of the protocol. The protocol **source of truth** is `skills/setup/protocol/`; `work/protocol/` is a propagated **copy**. NEVER edit `work/protocol/` alone — edit the source and mirror both (see that repo's `AGENTS.md`). Other repos have only `work/protocol/`.

## Guardrails

- **Investigate, don't assume.** A confident "this is obsolete" is a *hypothesis* until checked against the code.
- **Never auto-decide.** Recommend → WAIT → execute. The human owns the call.
- **Self-containment is a precondition for promote-then-delete.** If you make a slice and delete the note, the slice must stand alone.
- **Clean tree before writing.** Confirm the repo is ready for writes (the human will say so); commit in scoped commits as you go.
- **One at a time, human's order.** Don't fan out across the inbox.
