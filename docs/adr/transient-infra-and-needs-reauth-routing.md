---
title: Failure-cause routing — transient-infra retries, needs-reauth surfaces separately
status: proposed
created: 2026-07-07
supersedes:
superseded_by:
---

# ADR: routing per failure CAUSE — `transient-infra` retries with backoff, `needs-reauth` surfaces to a dedicated re-auth surface, `agent-failed` keeps `needs-attention`

> **STATUS: proposed.** Records the routing POLICY per failure cause so the
> follow-up implementation slice in `run.ts` / `do.ts` has a settled reference.
> The classification half of the split (a new `needs-reauth` variant on
> `FailureCause`, matched on `authentication_required` / OAuth-token-expired /
> tight 401+auth signatures) lands in the SAME task as this ADR
> (`failure-cause-needs-reauth-and-transient-infra-routing`); the routing wiring
> is a separate slice.

## Context

`work/needs-attention/` means "a human must inspect the **WORK**" — the wiring is
fine, the infra is fine, but the item itself is stuck and needs a person to
look. That is the signal downstream tooling (and the operator) read it as.

Two OTHER failure kinds have historically been surfaced there anyway, and both
misrepresent the signal:

1. A harness-surfaced **model/network/git outage** the harness reported after its
   own retries were exhausted (`ECONNRESET`, 5xx, 429, `overloaded`, "network
   unreachable", …). The work is fine; the infra was unavailable. Retrying the
   SAME work later is the natural recovery.
2. A **credential expiry / revocation** (observed: a CI `advance` run that came
   back with a 401 body `{"error":{"type":"authentication_required","message":"OAuth
   refresh token expired or revoked. …"}}`). The work is fine; the credential
   expired. No amount of retry helps — a human must **re-auth**.

Before `classifyFailureCause` grew a `needs-reauth` variant, (2) fell through to
the generic `agent-failed` and (pre-per-item-lock ledger cutover) even risked a
silent revert via sibling-ledger reconcile. Problem (A) — the silent revert — is
already RESOLVED by the per-item-lock ledger cutover (ADR
`ledger-status-on-per-item-lock-refs`). This ADR fixes problem (B): with the
cause now DISTINGUISHABLE (`transient-infra` vs. `needs-reauth` vs.
`agent-failed`), route each to a surface that MATCHES its recovery.

## Decision

Route the terminal `run` / `do` outcome by `FailureCause`:

- **`transient-infra`** (model outage / 5xx / 429 / overloaded / network / DNS /
  connection-reset) → **bounded auto-retry with backoff on the SAME work**. If
  the retry budget is exhausted, surface to a **distinct infra-blocked surface**
  — NOT `needs-attention`, because the WORK is not what a human should
  inspect; the infra is.
- **`needs-reauth`** (credential expired / revoked, e.g. OAuth refresh token,
  matched on `authentication_required` and tight 401+auth signatures) → **do
  NOT retry** (retries cannot help). Surface to a **dedicated needs-reauth
  surface** that asks a human to RE-AUTH, kept **SEPARATE from
  `needs-attention`** so the "look at the work" signal is not muddied with
  "look at your credentials".
- **`agent-failed`** and the other work-stuck causes (`gate-failed`,
  `rebase-conflict`, `agent-stopped`, `review-blocked`) → **unchanged**,
  continue to `needs-attention`. This is where "a human must inspect the WORK"
  correctly belongs.
- **`config-error`** (a thrown CORE wiring/config error, e.g. `review` on with
  no `reviewGate` configured) → **unchanged**: this is a wiring problem, not
  infra and not credentials, and it already has its own precise outcome
  channel; do NOT retry it (retries cannot fix wiring) and do NOT route it to
  the infra-blocked or needs-reauth surface.

## Why NOT fold 401 / `authentication_required` into `transient-infra`

`transient-infra` and `needs-reauth` have INCOMPATIBLE recovery semantics AND
INCOMPATIBLE human actions:

- **Retry semantics differ.** A transient outage EXPECTS the same call to succeed
  later; `transient-infra` is the cause on which bounded auto-retry is CORRECT.
  A revoked credential guarantees every retry produces the same 401 until a
  human re-auths; auto-retrying is pure waste (and blows the retry budget so a
  genuinely transient failure later has no budget left).
- **Human action differs.** `transient-infra` asks the operator to wait / check
  the provider status; `needs-reauth` asks them to run the re-auth flow. The
  surface each is routed to must ASK for the RIGHT action.

Folding 401 into `transient-infra` would force the routing layer to re-split a
`transient-infra` bucket by inspecting the message string a second time,
defeating the point of having a taxonomy in the first place. Making
`needs-reauth` its own first-class variant keeps the routing branch a plain
switch on `cause`.

## Non-goals of this ADR

- The exact **backoff schedule** (fixed / exponential / jittered, how many
  retries, per-item vs. per-run budget). A separate implementation slice sets
  this alongside the routing wiring.
- The **on-disk shape** of the new `infra-blocked` / `needs-reauth` surfaces
  (folder names, sidecar format, per-item-lock ref labels). Fixed at the same
  time as the routing wiring so the surface names + the classifier stay in
  step.
- The exact **call sites** in `run.ts` / `do.ts` that get rewired. This ADR is
  the policy reference the wiring task cites; it deliberately does not
  pre-empt where the branch lives.

## Consequences

- A transient 401 like the one in the source observation
  (`transient-infra-failure-indistinguishable-from-genuine-stuck-state`) will
  stop landing in `work/needs-attention/` once the routing slice lands. The
  operator sees "re-auth" as the ASKED action, not "inspect the work".
- The `infra-blocked` and `needs-reauth` surfaces become new concepts the runner
  must implement. Until the routing slice lands, the routing code MAY still
  fall back to today's behaviour (surfacing to `needs-attention`) — that keeps
  this task's classification-only change SAFE, and this ADR is the intended
  end-state reference for the follow-up.
- The `FailureCause` taxonomy stays HONEST: each variant means one recovery,
  one human action, one route. Any future cause that has a NEW recovery /
  action pair should get its OWN variant, not be folded into an existing one.
