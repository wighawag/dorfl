---
title: an agent that HAD the protocol's rules still produced backward work/ artifacts (a slice + observation created AFTER the code) when handed a "just implement" task
date: 2026-06-10
slug: agent-aware-of-protocol-still-produced-backward-artifacts
---

## What was observed

An agent was asked to investigate a real intake processing-lock bug and "implement against the contract" (the `intake-lock-failure-semantics-and-real-cause` fix). It had full access to the protocol's definition — `CONTEXT.md`, `work/protocol/WORK-CONTRACT.md`, and the slice/observation skills — i.e. it KNEW the protocol; it did not lack `AGENTS.md` or any rule.

Implementing directly was fine (the task explicitly asked for it). What was INCOHERENT was the paperwork the agent then produced, flowing the wrong way through the lifecycle:

- it wrote a **slice into `work/backlog/`** describing work it had **already built**, with acceptance criteria pre-ticked `[x]` — a backlog slice means "ready to be claimed and built," so a built-but-backlogged slice with a ticked "gate" is a fake forward-artifact (a changelog wearing a spec's shape);
- it wrote an **observation** and immediately marked it `status: resolved` (a status the contract does not define) and left it in the inbox — but an observation is a LIVE signal; once discharged by a fix it should be DELETED, not annotated and kept.

So the agent felt the protocol's gravity ("there should be a slice + an observation for this") and applied it **retroactively and ritually** rather than understanding the artifacts' DIRECTION and LIVENESS.

## Why it matters (the diagnosis)

The protocol's control-flow (slice exists → claim → build → done-move) is enforced by the **runner** (the `agent-runner` binary owns the git transitions). When an agent is invoked **directly, outside the runner** — as here — there is no structural gate stopping it from building first and back-filling artifacts. The contract docs DESCRIBE the lifecycle but, for a loose agent, nothing makes the _forward_ direction of a slice/observation a felt constraint. The miss is not "the agent didn't know the rules" — it's "knowing the rules, the agent cargo-culted their SHAPE instead of their MEANING (when each artifact is alive)."

The durable principle (belongs in the protocol/skills, NOT in any personal config):

> Work that is **already done** does NOT get a backward slice/observation manufactured to look compliant. A discharged signal is **deleted** (git history is the archive); completed work is recorded as a **`done/` record landed with the code** + the commit message — owned by whoever does the git transition. Forward artifacts (backlog slices, open observations) are for work that is **pending or currently-signalled**, never for narrating the past. A captured note has a DIRECTION (forward = a signal/spec for future work) and a LIVENESS (it leaves the inbox by deletion the moment it stops being a live signal).

## Candidate solution (NOT adopted; for discussion)

A **pre-flight artifact-liveness/direction check** the protocol (or the slice/`capture-signal` skills) could carry, so this is structurally caught:

- before writing a slice: assert it describes **pending/future** work (no claim, no built code yet). A slice for already-built work is a smell → it should be a `done/` record landed with the code, or just the commit, not a backlog slice.
- before keeping an observation: assert it is a **live, open** signal. A "resolved" observation is a contradiction → delete it (its work, if any, lives on as a slice/ADR/commit).
- optionally, for an agent invoked OUTSIDE the runner in a `work/`-contract repo: surface "you are building without a claimed slice — that is fine for an explicit fix, but do NOT back-fill forward artifacts afterward; record completed work as a `done/` record + commit."

### Explicit non-solution: `AGENTS.md`

This must NOT be fixed by putting a rule in `AGENTS.md`. `AGENTS.md` is **personal** harness/etiquette config; the protocol deliberately does not depend on it and must not force anything onto it (AGENTS.md itself states the protocol's authoritative rules live in-band, not in that file). The agent here did not need `AGENTS.md` to know the protocol — it had `CONTEXT.md` + `WORK-CONTRACT.md` + the skills — so the fix belongs THERE (the protocol's own surface / the skills), where it binds every agent regardless of personal config, not in a per-user file the protocol promises never to rely on.

## References

- The fix the backward artifacts were attached to: `work/done/intake-lock-failure-semantics-and-real-cause.md`.
- The deleted backward observation (this replaces it as the LIVE meta-signal).
- `work/protocol/WORK-CONTRACT.md` — capture buckets "leave only by deletion"; status = folder; the slice lifecycle.
- `CONTEXT.md` — the protocol glossary the agent already had access to.
