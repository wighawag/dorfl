---
title: `requeue` (and the conductor's needs-attention recovery) assume a LOCAL checkout whose work/ tree mirrors the arbiter — there is no `requeue --remote/--arbiter`-against-the-mirror form, so recovering `do --remote`/worktree-built work is awkward and races the local/arbiter split
date: 2026-06-11
status: open
---

## The signal

Driving the backlog with `do --remote <url>` (worktree isolation on the arbiter, no human checkout touched), a build was routed to `work/needs-attention/` ON THE ARBITER (origin/main), its `work/<slug>` branch preserved there, and the job worktree reaped. To RECOVER it (requeue → re-`do`), the conductor reached for `agent-runner requeue <slug> --arbiter origin` — and it FAILED:

```
error: work/needs-attention/<slug>.md not found — nothing to return to backlog (wrong slug, or not in needs-attention?).
```

Because `requeue` operates on the LOCAL `cwd` work tree (`git mv work/needs-attention/<slug>.md → work/backlog/`, commit, optionally push to `--arbiter`). But with `--remote`, the needs-attention move lives on the ARBITER, and the local checkout is STALE (it still showed the slug in `work/in-progress/` from an earlier claim). Only after a `git pull --ff-only` did the local work tree catch up and `requeue` succeed.

So the recovery worked, but ONLY by first manually re-syncing the local checkout to the arbiter — exactly the "leave local main alone" property `--remote` was chosen to give up. The whole point of `--remote` is that the conductor need not own a synced checkout; yet `requeue` forces one.

## Why it bites (the deeper asymmetry)

`do --remote` is a NO-checkout form (materialise mirror + worktree, build, integrate, reap). Its recovery verb `requeue` has NO matching no-checkout form: there is no `requeue <slug> --remote <url>` that does the `needs-attention/ → backlog/` move directly against the hub mirror's main (the way `do --remote` claims/integrates against it). The conductor is pushed back into a local-checkout workflow for the one step (`requeue`) that should mirror `do --remote`'s own arbiter-native mechanics.

Worse, it RACES the local/arbiter split: between the `do --remote` that routed the item and the local `requeue`, the local checkout can be arbitrarily behind (another build merged, the human committed). The conductor has to `git fetch && pull --ff-only` and hope for a clean fast-forward before `requeue` sees the right state. On a dirty or diverged local tree (which `--remote` was meant to make irrelevant) this is fragile.

## What would fix it

A no-checkout recovery form symmetric with `do --remote`:

- **`requeue <slug> --remote <url> [--reset] [-m …]`** — resolve/refresh the hub mirror for `<url>`, perform the `needs-attention/ → backlog/` move (default keep+continue) or the branch-delete (`--reset` discard) DIRECTLY against the mirror's main via the same CAS/throwaway-clone mechanics `do --remote` already uses, and push. No local checkout, no pre-sync, no race. (Same for `work-on`/any other recovery verb the conductor leans on.)
- At minimum: when `requeue` is run with `--arbiter` and the local work tree does NOT have the item in `needs-attention/` but the ARBITER does, say so explicitly ("item is in needs-attention on <arbiter> but your local checkout is behind — `git pull` first, or use `requeue --remote <url>` once it exists") instead of the bare "not found".

## Interaction with the rebase-conflict-on-continue bug

Compounding this: after the requeue + re-`do --remote`, the continue-from-kept-branch rebase CONFLICTED (main had advanced) and the run aborted mid-switch (`.agent-runner-job.json` blocked the `git switch`), leaving the item stuck IN-PROGRESS on the arbiter with the green branch preserved — a half-state that `continue-conflict-resurface-from-needs-attention` (already in backlog) targets, but which a no-checkout `requeue --reset --remote` would also help unstick cleanly. The two gaps (no remote-requeue form + the conflict-resurface bug) together make worktree-built recovery the rough edge of the `--remote` conductor path.

## Where

`src/cli.ts` `requeue` action + `src/`'s requeue/needs-attention move logic (local-cwd-only today); compare `do --remote`'s arbiter-native claim/integrate path in `src/do.ts` `performDoRemote` (the mechanics a `requeue --remote` would reuse). Cross-ref: `remote-do-ignores-per-repo-config.md`, `drive-backlog-skill-assumes-in-place-do-not-remote.md`, and the `continue-conflict-resurface-from-needs-attention` backlog slice.
