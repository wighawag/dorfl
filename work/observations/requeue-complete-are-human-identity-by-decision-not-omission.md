---
title: `complete` and `requeue` are HUMAN-identity commands BY DECISION (not by omission) — both now thread the ambient `process.env` explicitly so the runner `identity` is deliberately withheld; the autonomous completion/recovery path is `do`, which IS identity-aware
date: 2026-06-10
kind: observation
area: src/cli.ts (the `complete` + `requeue` actions), src/complete.ts, src/ledger-write.ts (the env seam)
severity: low
status: resolved
---

## The signal

While end-to-end testing the new `identity` feature (a configured bot, e.g.
`0xronan7`, performing the runner's git/provider transitions), I completed a
stuck slice via standalone `agent-runner complete` and noticed the completion
commit + the opened PR were attributed to the **human** (`wighawag`), NOT the
bot — even though the same run's `do`-path claim/surface commits WERE correctly
the bot.

Pulling that thread surfaced the design question: **should `complete` (and the
sibling recovery verb `requeue`) carry the runner `identity`, or stay human?**

## What we found

- **`complete`** already threads its `env` down to the integration core, and the
  `complete.ts` seam comment explicitly frames it as "the human `complete`" — but
  the CLI action passed NO `env`, so it fell back to ambient `process.env` via the
  seam's silent `?? process.env` default. Human-attributed, but only by omission.
- **`requeue`** is worse: it passed no `env` AND had no comment — its human
  attribution was entirely accidental (the seam's `?? process.env` fallback). Yet
  it commits + pushes (the needs-attention → backlog move; `--reset` deletes the
  remote work branch), so the attribution is real and observable.
- The env seam (`applyReturnToBacklogTransition` / `performComplete`) ALREADY
  accepts an optional `env` — the plumbing existed; the call sites just didn't use
  it.

## The decision (RESOLVED — maintainer)

Both `complete` and `requeue` are **HUMAN** commands. Rationale:

1. They are the human's "I'll finish/merge this" and "I'll put this back"
   actions. The commit/push/PR is genuinely the human's, so it SHOULD be
   attributed to them.
2. The **autonomous** completion already exists and is identity-aware: it is
   `do`'s OWN integrated complete (verified: `do`'s claim + surface commits are
   the bot). So there is no need for standalone `complete`/`requeue` to carry the
   identity — the bot's finish/recover path is `do` (re-claim + rebuild), not
   these human verbs.
3. Therefore the runner `config.identity` is deliberately WITHHELD from
   `complete`/`requeue`.

## The change made

To make the decision **declared, not accidental**, both CLI actions now thread
the ambient `process.env` EXPLICITLY (`env: process.env`) with a comment stating
the human-identity framing — instead of relying on the seam's silent
`?? process.env` fallback. No behaviour change (ambient was already the effective
identity); this only makes the choice visible at the call site and prevents a
future reader from "fixing" it by wiring in `config.identity`.

## Open follow-on (LOW — only if an autonomous recovery loop is ever built)

If a future UNATTENDED daemon ever calls `requeue` (a runner auto-recycling a
stuck item without a human), its ambient git identity would attribute the
recovery move to whatever account the daemon runs under — NOT the configured bot.
That would be the same silent-wrong-account class the `identity` feature exists to
prevent. At that point, give the autonomous caller an identity-aware path (either
thread `identityEnv(config.identity, …)` for that caller specifically, or route
recovery through an identity-aware command). NOT needed today: the only callers of
`requeue`/`complete` today are humans.
