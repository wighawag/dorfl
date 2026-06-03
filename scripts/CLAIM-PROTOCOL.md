# Claim protocol (consumed by the lifecycle skill)

This documents how a `work/backlog/<slug>.md` item is **atomically claimed** by
one agent (human or AFK) when several may try at once. The **slices** skill does
not perform claims — it only emits files in a shape this protocol can consume. The
**lifecycle** skill implements the steps here.

## The core idea: claim = an atomic compare-and-swap on `main`

A claim is a tiny, fast commit (just a `git mv backlog/ → in-progress/`) that
**races to land on the arbiter's `main` before any real work happens.** Git's
ref-update-on-push IS the atomic compare-and-swap: the first push to `main` wins,
a concurrent non-fast-forward push is rejected. The loser wasted ~one commit, not
real work, and simply picks another item.

**Separate the claim commit from the work commit.** Claim first (cheap,
collision-detecting); do the work only after the claim has provably landed.

## The arbiter: one serialization point for updating `main`

The atomicity comes from a **single repo that everyone treats as the integration
point** (`origin`), whose ref update on push linearizes claims. It can be EITHER:

- **A remote remote** — e.g. GitHub. Bare by construction; works across machines;
  everyone (including the human) participates by pushing to it.
- **A local bare remote** — a `--bare` repo in a folder (e.g. `work.git`), reached
  via `file://`. Works fully offline. **Must be `--bare`** (you cannot work *in*
  the arbiter: a non-bare repo with `main` checked out rejects pushes to `main`,
  and force-enabling that moves `main` under your working tree).

The protocol is **identical** for both — it targets a remote *by name*
(`<arbiter>`), not a hardcoded URL. Switching offline↔online is
`git remote set-url <arbiter> <url>` (or adding a second remote); the claim steps
do not change.

> **Consequence the human must accept:** you participate like an agent — you reach
> `main` via push (ff / `pull --rebase` then push), NOT via unsynchronized local
> commits onto a checked-out `main` that is also the arbiter. The arbiter ref and a
> working `main` you hand-commit to cannot be the same ref. This is mild, good
> hygiene, and is what keeps the claim guarantee intact for everyone.

### Offline setup (local bare arbiter), once

```sh
# create the bare arbiter next to (not inside) your working clone
git clone --bare /path/to/project /path/to/project-work.git   # or: git init --bare
# in each working clone, point an `arbiter` remote at it
git remote add arbiter file:///path/to/project-work.git
```

When back online, repoint: `git remote set-url arbiter <github-url>` (or push the
bare repo's `main` up). Same protocol throughout.

## The script: `scripts/claim.sh`

These steps are implemented (and verified against real git, including a truly
simultaneous two-agent race) by [scripts/claim.sh](scripts/claim.sh) — so a human
or agent does not hand-run the dance:

```sh
scripts/claim.sh <slug> [--arbiter <remote>] [--by <who>] [--retries N] [--dry-run]
```

Exit codes: `0` claimed · `2` not claimable (not in backlog, or lost the race) ·
`3` push kept being rejected (contended — retry later) · `1` usage/env error. It
refuses to run on a dirty tree, makes the failed-move and no-op cases fatal
(never a false "claimed"), and verifies the arbiter's `main` actually points at
your claim after the push. The steps it performs:

## Claim steps

```
CLAIM (fast, collision-detecting):
  1. git fetch <arbiter>
  2. git switch -c claim/<slug> <arbiter>/main        # branch off the latest main
  3. git mv work/backlog/<slug>.md work/in-progress/<slug>.md
     (optionally stamp advisory claimed_by / claimed_at in frontmatter)
  4. git commit -m "claim: <slug>"
  5. git push <arbiter> claim/<slug>:main --force-with-lease    # ATOMIC CAS
        # (a plain ff-only push works too; NEVER --force)
     ├─ ACCEPTED  -> the claim is atomically yours.
     └─ REJECTED (non-fast-forward) -> someone/something moved main:
            git fetch <arbiter>
            is work/backlog/<slug>.md still present on <arbiter>/main?
              NO  -> you lost the race for THIS item:
                     delete claim branch/worktree, pick a DIFFERENT backlog item.
              YES -> main merely advanced (a different item landed):
                     rebase claim/<slug> onto <arbiter>/main and retry push.
                     Cap retries (e.g. 3) then back off, to avoid livelock.

WORK (only after the claim landed):
  6. git switch -c work/<slug> <arbiter>/main      # NEW main, includes your claim
     (use a dedicated worktree/clone for isolation when running AFK / in parallel)
  7. do the work; tests green.
  8. in the same PR/merge: git mv work/in-progress/<slug>.md work/done/<slug>.md
  9. integrate to <arbiter>/main as normal (PR on GitHub, or ff/rebase push offline).
```

## Why this prevents (not merely detects) double-claims

The rejected push is the rejection of the claim. Because the arbiter serializes
ref updates on `main`, only one `claim/<slug>:main` can be the fast-forward winner;
all others are rejected atomically by `git receive-pack`'s ref lock. No lock
server, no integrator process. `--force-with-lease` is a CAS against the expected
old value (safe); `--force` would clobber and MUST NOT be used.

## Isolation for parallel AFK agents

Run each agent's work in its **own clone or worktree** so on-disk code changes
can't collide; conflicts then only surface at integration time (normal PR-style
resolution), never as corrupted shared state. Clones-of-an-arbiter give fully
independent object stores (best isolation); worktrees share one object store (save
disk) — either is fine, but prefer separate clones when many agents run at once.
