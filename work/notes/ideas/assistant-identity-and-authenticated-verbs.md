---
title: an `assistant` identity (third actor beside autonomous `agent` and bare human) + a FAMILY of authenticated runner verbs (approve/commit/push/gh-write) the in-conversation agent calls instead of raw git/gh — and a skill-redirect that enforces it
slug: assistant-identity-and-authenticated-verbs
type: idea
status: incubating
---

# The `assistant` actor + authenticated verbs it acts through

> Captured 2026-06-11 from a design chat (superseding the narrower
> `agent-vs-ambient-identity-pair` draft). The trigger: `drive-backlog` builds via
> `dorfl do` (which runs under the configured bot `identity`) but does its
> OWN approve/comment/merge — and indeed any `git commit` / `gh` write — as the
> raw ambient shell identity. Designing an `approve` verb to fix that surfaced a
> bigger shape: there is a THIRD actor (the assistant: an agent in conversation
> with a human) that needs its OWN identity AND its own authenticated verbs, and
> the skill must REDIRECT agents onto those verbs. NOT built. Three coupled parts
> below; the provider-seam mechanics of the first verb live in the companion idea
> `approve-verb-seamed-over-host-provider`.

## Part 1 — a THIRD actor: the `assistant`

Today the runner's command surface has TWO actor classes
(`command-prefix-by-actor-type`):

- **autonomous `agent`** — `do` / `run` / `intake` (the bot acts unattended,
  under the configured `identity`).
- **bare human** — `claim` / `complete` / `requeue` / `start` / `work-on` (the
  human drives; deliberately AMBIENT — a documented decision).

The `drive-backlog` / in-conversation case is NEITHER. An agent working WITH a
human in a live session — proposing a commit, approving a reviewed PR, pushing a
branch — is a distinct actor: the **assistant**. It is not the unattended bot
(there IS a human in the loop) and it is not the bare human (an AGENT is emitting
the action). Naming it `assistant` is sharper than `ambient`/`human`/`operator`:
it names WHO is acting, not a fallback behaviour.

So config's single `identity` becomes a small, FIXED set of named roles — NOT an
open `{default, ...named}` map:

- **`agent`** (mandatory when present) — today's `identity`: the unattended bot.
- **`assistant`** (optional) — the in-conversation agent's identity, used by the
  authenticated verbs in Part 2. **Unset ⇒ fall back to real ambient** (today's
  byte-for-byte behaviour — the shell's own `git`/`gh`, no env wrapping).

### Why a fixed PAIR/SET and NOT a general map

`src/identity.ts` is carefully built around ONE coherent entity across three axes
(commit label / git transport auth / provider token), with mandatory-explicit
`auth` so a silent wrong-account push is UNSPELLABLE. A general
`{default, ...named}` map multiplies every one of those concerns for a generality
nothing yet needs. The concrete need is a small, NAMED set of ACTOR ROLES
(`agent`, `assistant`), not arbitrary identities — so encode exactly the roles.
Revisit a map only if a genuine fourth role appears.

## Part 2 — a FAMILY of authenticated verbs, not just `approve`

`approve` (companion idea) is the first and most-needed member, but the same need
covers every authenticated host-provider / git action an assistant performs:

- **`approve`** — approve-with-comment, fallback comment+merge (the
  `drive-backlog` merge step). FIRST member — see
  `approve-verb-seamed-over-host-provider` for its provider-seam mechanics.
- **`commit`** — author a commit under the `assistant` identity (so an
  in-conversation agent's commits are attributed to the assistant, not the bare
  human's ambient git config).
- **`push`** — push under the assistant's transport auth.
- **generic `gh`-write** — comment / label / close, through the provider seam.

The point of the family: an in-conversation agent NEVER calls raw `git commit` /
`gh` directly (which would run under the human's ambient identity and bypass the
runner's wiring). It calls the runner verb, which wraps the action in
`identityEnv(identities.assistant)` and routes host-provider actions through the
existing `ReviewProvider`/provider seam. One consistent attribution + one
provider-agnostic surface.

## Part 3 — the skill must REDIRECT onto these verbs (enforcement)

Verbs that exist but get bypassed change nothing. So the OTHER half of this work
is updating the relevant skills (`drive-backlog` first; any in-conversation-agent
guidance generally) to **forbid raw authenticated git/host actions and redirect
to the assistant verbs**:

- `drive-backlog` golden rule 4 + step 4c currently TELL the conductor to run
  `gh pr comment` + `gh pr merge` directly. Those instructions get rewritten to
  `dorfl approve …`.
- More broadly: an in-conversation agent should be steered away from
  `git commit` / `git push` / `gh <write>` toward the assistant verbs, so
  attribution actually holds in practice.

Without Part 3, Parts 1–2 are dead infrastructure — the agent keeps reaching for
raw `gh` exactly like today.

## The deeper question this forces (don't skip it)

There is a real reason the conductor acts as ambient TODAY, and it may be
CORRECT, not a bug — at least for `approve`:

- `do` ran the build under the `agent` identity, so the PR commits are the bot's.
- GitHub REFUSES `gh pr review --approve` on a PR authored by your own identity
  (skill golden rule 4) — which is exactly why approve falls back to
  comment+merge.
- So an approver DISTINCT from `agent` is a genuine SECOND PARTY. The `assistant`
  identity being SEPARATE from `agent` is therefore not just attribution hygiene
  — for `approve` it is what keeps author≠reviewer (collapsing them into one
  identity would defeat GitHub's self-approval guard).

So `assistant` must be a DISTINCT entity from `agent`, not an alias of it. When a
human runs `drive-backlog` and `assistant` is unset, real-ambient-as-actor is
already fine; the `assistant` identity's real value is the UNATTENDED / pinned
case (give the in-conversation/conductor actions a stable, named, non-bot
identity instead of whatever the shell happens to be).

## Open questions before a SPEC

- **Which axes does `assistant` need?** Full three-axis (label + transport auth +
  provider token) or a subset? An assistant that mostly commits + comments needs
  label + token; it may push less, so its `auth` story could be lighter. Resolve
  per verb in the family.
- **Migration from `identity`.** Keep `identity` as an alias for
  `identities.agent` (no breakage) vs a hard rename with a deprecation window.
- **Verb naming + the actor-prefix idea.** The family interacts with
  `command-prefix-by-actor-type`: `assistant` is a THIRD actor that idea does not
  yet model (it only has human vs agent). The prefix scheme (and which verbs are
  bare) should be reconsidered with three actor classes, not two.
- **Sequencing.** `approve` (provider seam) can land first as a single verb; the
  `assistant` identity + the rest of the family + the skill-redirect can follow.
  But the skill-redirect (Part 3) should land WITH the first verb so the conductor
  actually uses it.

## See also

- `approve-verb-seamed-over-host-provider` — the provider-seam mechanics of the
  FIRST member of the verb family.
- `command-prefix-by-actor-type` — the actor-prefix naming idea this adds a THIRD
  actor (`assistant`) to.
