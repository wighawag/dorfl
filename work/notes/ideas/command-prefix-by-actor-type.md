---
title: prefix commands by ACTOR TYPE (human: / agent:) so the human-vs-autonomous split is visible IN THE COMMAND NAME — leaning toward prefixing only the HUMAN commands, since the tool's goal is agent-driven work
slug: command-prefix-by-actor-type
type: idea
status: incubating
---

# Command prefixes that name WHO the command is for (human vs agent)

> Captured 2026-06-10 from the identity-feature work. While auditing which commands carry the runner `identity` vs stay ambient (`work/observations/human-git-verbs-withhold-identity-by-decision-not-omission.md`), the human/autonomous split turned out to be a real, load-bearing axis across the WHOLE command surface — but it is currently INVISIBLE in the command names. You have to read docs/comments to know that `complete`/`requeue`/`claim`/`start`/`resume`/`work-on` are HUMAN verbs and `do`/`run`/`intake` are AGENT verbs. NOT built; an ergonomics/naming idea.

## The signal

dorfl has two clear classes of command, and the distinction matters
(it drives identity attribution, who is expected to invoke it, and the mental
model):

- **AGENT / autonomous** — `do`, `run`, `intake` (claim → build → gate →
  integrate, identity-aware, the bot acts).
- **HUMAN** — `claim`, `start`, `resume`, `work-on`, `complete`, `requeue`
  (the human drives; deliberately ambient, NOT the bot — see the audit
  observation).

Today that split is **only discoverable by reading documentation/comments**.
The command NAMES (`do`, `complete`, `claim`, …) carry no signal of which class
they belong to, so a new user — or an agent reasoning about which command to
emit — cannot tell human-from-agent at a glance.

## The idea

**Encode the actor type as a command PREFIX**, so the class is visible in the
name itself. Three shapes to choose between:

1. **Prefix the HUMAN commands** — `human:claim`, `human:complete`,
   `human:requeue`, `human:work-on`, … ; the agent commands stay bare
   (`do`, `run`, `intake`).
2. **Prefix the AGENT commands** — `agent:do`, `agent:run`, `agent:intake`;
   the human commands stay bare.
3. **Prefix BOTH** — `human:claim` AND `agent:do`, fully symmetric, nothing bare.

## Leaning: prefix the HUMAN commands (shape 1)

The tool's GOAL is agent-driven work — the agent path is the default, common,
"happy" case, so it should stay short and unmarked (`do`, `run`). The HUMAN
commands are the exceptions / the "I'm stepping in manually" cases, so MARKING
THEM (`human:complete`, `human:requeue`) is the right asymmetry:

- It keeps the agent surface terse (you type `do` constantly).
- It makes manual intervention look DELIBERATE — `human:complete` reads as "I,
  the human, am finishing this myself," which exactly matches the identity
  decision (those verbs withhold the bot identity ON PURPOSE).
- It nudges the user toward the agent path by making the human path visibly the
  special case.

Shape 3 (both prefixed) is the most "honest"/symmetric but adds ceremony to the
common agent path, working against the agent-first goal. Shape 2 (prefix agents)
is backwards — it marks the thing you want to be the default.

## Open questions / things to resolve before a SPEC

- **Backward compatibility / aliases.** Renaming to `human:complete` would break
  every existing invocation, script, and doc. Likely needs the bare names kept as
  ALIASES (so `complete` still works) with the prefixed form as canonical — or a
  deprecation window. Decide whether prefixes are the ONLY name or an additional
  surfacing.
- **Prefix syntax.** `human:complete` (colon, mirrors the existing `slice:` /
  `prd:` arg convention) vs a `human` SUBCOMMAND group (`dorfl human
  complete`) vs a help-only grouping with no name change. The colon form is
  consistent with the codebase's existing `<ns>:<slug>` convention.
- **Does this REPLACE or COMPLEMENT the existing help-group split?** cli.ts
  already groups commands into a HEADLINE tier vs ADVANCED/PLUMBING tier
  (`helpGroup`). The human/agent axis is ORTHOGONAL to headline/advanced — so
  this could be a second grouping dimension rather than a rename. Maybe the
  cheapest win is a help-GROUP relabel (Human commands / Agent commands) with NO
  name change at all — get the clarity without the compat cost. Worth weighing
  the naming change against a pure help-surface change.
- **Where do borderline verbs sit?** `claim` exists BOTH as a standalone human
  verb AND as the autonomous step inside `do`/`run`/`intake`. The standalone CLI
  `claim` is human, so it prefixes as `human:claim` — but note the SAME logical
  operation is the bot's inside `do`. The prefix is about the CLI ENTRY POINT's
  intended actor, not the underlying operation.

## Why it's worth doing

It makes a real, already-load-bearing distinction (human vs agent identity)
LEGIBLE at the surface instead of buried in docs — both for humans onboarding and
for an agent that emits dorfl commands and should never accidentally reach
for a human verb (or vice-versa). It is the naming-layer complement to the
identity feature's RUNTIME enforcement of the same split.

## Update (2026-06-11): a THIRD actor — the `assistant`

This idea models TWO actor classes (human, agent). A later chat surfaced a THIRD:
the **assistant** — an agent in conversation WITH a human (e.g. driving
`drive-backlog`), which is neither the unattended bot nor the bare human. It needs
its own identity AND its own authenticated verbs (`approve`/`commit`/`push`/`gh`-
write). See `assistant-identity-and-authenticated-verbs` (the actor + verb family)
and `approve-verb-seamed-over-host-provider` (the first verb). The prefix scheme
here should be reconsidered for THREE actor classes, not two.
