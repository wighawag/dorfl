---
title: A "continue from kept branch" rebase conflict pushes users toward the destructive `requeue --reset` — there is no smooth non-destructive way to disentangle, and --reset can DISCARD correct, building work for a conflict that wasn't a genuine content clash
date: 2026-06-15
status: open
severity: high
---

## The signal

When `do --isolated` continues a requeued slice and the kept `work/<slug>` branch does not rebase cleanly onto the latest main, the runner routes to needs-attention with:

```
continuing the kept work/slice-…: rebase onto the latest main conflicted
(aborted, never auto-resolved) — resolve against the latest main, or
`requeue --reset` to discard and start fresh
```

The only two options the message offers are:
1. **"resolve against the latest main"** — but there is no command/affordance that DOES this for an isolated/mirror-side branch. The branch lives on the arbiter + mirror, not in the user's checkout, so "go resolve it" has no obvious, supported path (you'd have to hand-fetch the branch, rebase, force-push — exactly the manual git the conductor is told NOT to do).
2. **`requeue --reset`** — DISCARD the work and start fresh. This is destructive (deletes the remote branch) and, as observed, did NOT even fix the situation (stale mirror ref resurrected it — see `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`).

So the practical pressure is to reach for the destructive option, and in this case that meant throwing away CORRECT, already-built work (the diff matched every acceptance criterion; the commit `58bf7d5` "…add to RACE_SENSITIVE; done" was sound). It felt like a shame to lose it — because it WAS a shame, and unnecessary.

## Why it matters

- The conflict here was NOT a genuine content clash between two real lines of development. It was the slice `.md` lifecycle move (needs-attention ↔ backlog ↔ done) plus accumulated appended `-m` handoff notes, conflicting because of agent-runner's own incomplete mirror state. A trivial, mechanical conflict in protocol bookkeeping should be AUTO-RESOLVABLE (the runner owns both sides of a `.md` lifecycle move), not a wall that forces discarding the code.
- Routing CORRECT work to needs-attention and then nudging the user to `--reset` it inverts the protocol's intent: needs-attention is for genuine blocks, and the kept-branch-continue feature exists precisely to PRESERVE good work across requeues. A bookkeeping rebase conflict defeats both.

## What SHOULD happen

1. **Auto-resolve protocol-mechanical conflicts.** When the only rebase conflict is in `work/**` lifecycle bookkeeping (a slice `.md` folder move and/or appended handoff notes the runner itself wrote), the runner should resolve it deterministically (the arbiter's current folder is the truth for placement; appended notes union cleanly) and continue — never surface it as a human block.
2. **A non-destructive recovery verb.** Offer `requeue --reconcile`/`--rebase` (or make plain `requeue` retry the rebase after re-syncing the mirror to the arbiter) so the DEFAULT escape from a continue-conflict KEEPS the work. Reserve `--reset` for genuinely worthless branches, and make the error message lead with the non-destructive option, not `--reset`.
3. **Make "resolve against latest main" actionable.** If a real content conflict exists, give a supported command to fetch the kept branch into a scratch worktree, rebase, and re-push (the runner already owns mirror/worktree machinery), instead of telling the user to do raw git on a branch the skill forbids them to touch in the human checkout.

## The broader principle (user's framing)

Recovery affordances should be NON-DESTRUCTIVE by default and should fire on GENUINE errors. Today the path of least resistance out of a self-inflicted, mechanical conflict is to destroy correct work — and even that didn't work. The lesson: keep+continue is the right default; --reset should be rare, loud, and effective; and protocol-bookkeeping conflicts should never reach the user at all.

## Cross-refs

- `requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md` — the stale-mirror root cause that made the conflict recur and made `--reset` ineffective.
- `do-should-fail-fast-when-prepare-or-verify-unset.md` — the first self-inflicted needs-attention in the same slice (env-config gap surfaced as a build failure).
