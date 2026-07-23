---
title: 'Protocol — write the land-time re-verify invariant + human-reconcile warning (dual-write SOURCE + mirror)'
slug: protocol-land-time-reverify-invariant
spec: land-time-reverify-and-parallel-merge-ceiling
blockedBy: [adr-land-primitive-rebase-reverify-advance]
covers: [1, 2, 3]
---

## What to build

Add the land-time re-verify invariant to the protocol docs, and the
human-reconcile WARNING (the resolution of OQ5 in the spec), as a single
dual-write change.

Two facts to land in prose:

1. **The land invariant.** Every land = fetch current `main` → rebase →
   re-run `verify` (and review) on the rebased tree → advance. A lost CAS
   / moved-`main` INVALIDATES any prior green and re-arms the gate. Merge
   mode runs it inline at the serialised land; propose mode runs it at the
   human checkpoint. Human review is ADDITIVE, not a substitute. Point to
   the ADR (`adr-land-primitive-rebase-reverify-advance`) for the why.

2. **Human-reconcile warning** (in `CLAIM-PROTOCOL.md` next to the existing
   `pull --rebase` instruction): a plain `git pull` (merge) does NOT re-run
   `verify` on the reconciled tree, so a clean merge can hide a
   semantically-broken result. If a push is rejected non-fast-forward:
   `git pull --rebase`, then re-run `verify` on the rebased tree BEFORE
   pushing. The runner path enforces this automatically; on the human path
   it is on you. (Warning, not a gate — the human path is deliberately
   lighter.) Use the wording from the spec's Applied Answer q4 verbatim
   unless it needs minor adaptation to match the surrounding doc voice.

Per this repo's protocol-docs rule, EDIT THE SOURCE (`skills/setup/protocol/`)
AND MIRROR byte-identically into `work/protocol/`. Bump
`skills/setup/protocol/VERSION` and mirror.

## Acceptance criteria

- [ ] The invariant is written into `skills/setup/protocol/WORK-CONTRACT.md`
      (the right section — likely near the build-board / done semantics) and
      into `skills/setup/protocol/CLAIM-PROTOCOL.md` (next to the existing
      claim/land sequence).
- [ ] The human-reconcile warning is written into
      `skills/setup/protocol/CLAIM-PROTOCOL.md` next to the existing
      `pull --rebase` instruction.
- [ ] `skills/setup/protocol/VERSION` is bumped.
- [ ] `work/protocol/` is updated to match: `diff -r skills/setup/protocol
      work/protocol` is clean apart from files that legitimately only live
      in one tree.
- [ ] The new prose references the ADR by slug for the durable why.
- [ ] `pnpm format` + `pnpm -r build && pnpm -r test && pnpm format:check`
      green.

## Blocked by

- `adr-land-primitive-rebase-reverify-advance` — the protocol prose points
  at the ADR; the ADR slug must exist first.

## Prompt

> Read `work/specs/tasked/land-time-reverify-and-parallel-merge-ceiling.md`
> (or `specs/ready/`) — especially Stories 1-3, the Solution section, and
> Applied Answer q4 for the verbatim warning wording. Read this repo's
> AGENTS.md "Protocol docs — edit the SOURCE, never `work/protocol/`" rule
> before touching anything. Edit `skills/setup/protocol/WORK-CONTRACT.md`
> and `skills/setup/protocol/CLAIM-PROTOCOL.md`, mirror byte-identically
> into `work/protocol/`, bump and mirror `VERSION`. Keep the additions
> short — they are pointer-prose to the ADR, not the ADR itself. Run
> `pnpm format` then verify with the acceptance gate from AGENTS.md.
