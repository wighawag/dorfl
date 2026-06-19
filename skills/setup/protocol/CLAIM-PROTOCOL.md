# Claim protocol (consumed by the runner — `agent-runner claim`/`do`/`complete`)

This documents how a `work/backlog/<slug>.md` item is **atomically claimed** by one agent (human or AFK) when several may try at once. The **slices** skill does not perform claims — it only emits files in a shape this protocol can consume. The **lifecycle** skill implements the steps here.

## The core idea: claim = acquiring the item's per-item LOCK (an atomic create-only ref push)

A claim **acquires the item's per-item lock** — a hidden `refs/agent-runner/lock/<type>-<slug>` ref created by an ATOMIC create-only push (`--force-with-lease=<ref>:`, i.e. "succeed only if the ref is still absent"). Git's ref-update-on-push IS the compare-and-swap: the winner creates the ref; a concurrent acquirer for the SAME item finds it present and is rejected = **definitively lost, with NO retry budget** (a per-item ref only ever contends with another writer for that same item — a genuine conflict the loser should lose). The item's body STAYS in `work/backlog/<slug>.md`; **claim writes NOTHING to `main`** (so an agent can claim even on a protected `main`). (ADR `ledger-status-on-per-item-lock-refs`.)

This SUPERSEDES the older claim mechanism (a `git mv backlog/ → in-progress/` micro-commit raced on the shared `main` ref): that shared-`main` CAS falsely-contended between DIFFERENT items under parallelism and exhausted its retry budget; per-item lock refs never falsely contend. The claimable predicate is now **"the body is in the pool `backlog/` on `main` AND no lock is held on its ref."**

**Separate the claim from the work.** Acquire the lock first (cheap, collision-detecting); do the work only after the lock is provably held.

## The arbiter: one serialization point for updating `main`

The atomicity comes from a **single repo that everyone treats as the integration point** (`origin`), whose ref update on push linearizes claims. It can be EITHER:

- **A remote remote** — e.g. GitHub. Bare by construction; works across machines; everyone (including the human) participates by pushing to it.
- **A local bare remote** — a `--bare` repo in a folder (e.g. `work.git`), reached via `file://`. Works fully offline. **Must be `--bare`** (you cannot work _in_ the arbiter: a non-bare repo with `main` checked out rejects pushes to `main`, and force-enabling that moves `main` under your working tree).

The protocol is **identical** for both — it targets a remote _by name_ (`<arbiter>`), not a hardcoded URL. Switching offline↔online is `git remote set-url <arbiter> <url>` (or adding a second remote); the claim steps do not change.

> **Consequence the human must accept:** you participate like an agent — you reach `main` via push (ff / `pull --rebase` then push), NOT via unsynchronized local commits onto a checked-out `main` that is also the arbiter. The arbiter ref and a working `main` you hand-commit to cannot be the same ref. This is mild, good hygiene, and is what keeps the claim guarantee intact for everyone.

### Offline setup (local bare arbiter), once

```sh
# create the bare arbiter next to (not inside) your working clone
git clone --bare /path/to/project /path/to/project-work.git   # or: git init --bare
# in each working clone, point an `arbiter` remote at it
git remote add arbiter file:///path/to/project-work.git
```

When back online, repoint: `git remote set-url arbiter <github-url>` (or push the bare repo's `main` up). Same protocol throughout.

## The command: `agent-runner claim` / `do`

These steps are implemented (and verified against real git, including a truly simultaneous two-agent race) by the runner — so a human or agent does not hand-run the dance:

```sh
agent-runner claim <slug> [--arbiter <remote>] [--by <who>] [--dry-run]
```

Exit codes: `0` claimed · `2` not claimable (not in the pool, or the lock is already held = lost) · `1` usage/env error. The acquire is self-arbitrating (no `3 contended` retry class, unlike the old shared-`main` CAS — a per-item lock never falsely contends). The steps it performs:

## Claim steps

```
CLAIM (acquire the per-item lock; collision-detecting, no body move):
  1. fetch the lock refs from <arbiter> (refs/agent-runner/lock/*)
  2. confirm the body is still in the pool: work/backlog/<slug>.md on <arbiter>/main
  3. build a PARENTLESS lock-entry commit (action: implement, state: active,
     holder/since) with plumbing — never touches the working tree/HEAD
  4. push it create-only to refs/agent-runner/lock/<type>-<slug>
     with --force-with-lease=<ref>:   (the EMPTY expected value = "ref must be absent")
     ├─ ACCEPTED  -> the lock is atomically yours (the body stays in backlog/;
     |              NOTHING was written to main).
     └─ REJECTED  -> the ref already exists: another writer holds this SAME item's
                    lock. You LOST, definitively (exit 2). No retry budget — pick a
                    DIFFERENT pool item. (holder/since are readable on the lock entry
                    via `agent-runner status`.)
     # who/when rides the lock entry, not a frontmatter field (no claimed_by/claimed_at).

WORK (only after the lock is held):
  5. git switch -c work/<slug> <arbiter>/main      # the body is still in backlog/ on main
     (use a dedicated worktree/clone for isolation when running AFK / in parallel)
  6. do the work; tests green.
  7a. SUCCESS path — the runner, at integration, lands the DURABLE move on main:
        git mv work/backlog/<slug>.md work/done/<slug>.md
      committed together with the work (completed-slice message, see below), then
      RELEASES the lock (delete the ref). Order: durable main-move FIRST, lock
      release SECOND — a crash between leaves a done-on-main item with a stale lock,
      and recovery treats the main record as authoritative and clears it.
  7b. STUCK path — if it could NOT complete (red gate, rebase/merge conflict, slice
      too ambiguous to build, timeout, rejected review): the runner amends the held
      lock active -> stuck (+ reason and any surfaced questions ON THE LOCK ENTRY)
      and SAVES the recoverable work as a wip commit on the kept work/<slug> branch
      (pushed to the arbiter). NO main write, NO folder move. A human resumes
      (stuck -> active) or requeues (stuck -> released; the body is already in the
      pool). (The build agent never touches the lock — the runner owns it.)
  8. integrate to <arbiter>/main as normal (PR on GitHub, or ff/rebase push offline).
```

> The durable `backlog → done` / `prd → prd-sliced` / `backlog → dropped` moves are the ONLY writes to the shared `main` ref, so THEY keep a small retrying CAS; the per-item LOCK acquire/release never does (it is self-arbitrating). The two are independent substrates that may legitimately disagree (e.g. `done` on `main` + a `stuck` lock co-exist after a rebase-conflict bounce of a just-completed item).

## The prompt handed to the work agent (the `## Prompt` wrapper)

When a human or an autonomous runner dispatches an agent to do the WORK phase, the agent is given a small, constant **wrapper** around the slice's own `## Prompt` section. The wrapper is the same every time except the slug; an autonomous runner emits it deterministically. The slice file is the brief; the wrapper just frames it and draws the line around git.

```
You are completing one work slice in this repo. It has already been claimed for
you (its per-item lock is held) and lives at work/backlog/<slug>.md — read that
file fully; it is your complete brief (What to build, Acceptance criteria, Prompt).
Also read its source PRD (the slice's `prd:` field, at work/prd/<prd>.md) for
context.

Implement it to satisfy every Acceptance criterion. TDD where the slice asks for
it; match the repo's house style.

If you NOTICE a problem OUTSIDE this slice's scope (a flaky test, a latent bug, a
suspicious behaviour), do NOT fix it and do NOT expand your scope. Instead drop a
short, dated note in work/observations/<short-slug>.md (one or two sentences is
enough — what you saw and where) so the signal is captured, then carry on with
your slice. (work/observations/ is an append-only capture bucket; anyone, you
included, may add to it. Writing such a NOTE is the one exception to the "no file
changes outside your slice" rule below — it is a note, not work.)

If the SLICE ITSELF is the problem — it is ambiguous, under-specified, rests on a
premise that no longer matches the code/ADRs (it has DRIFTED), or hides an
unresolved design decision — do NOT guess and build on it. STOP and report
specifically what is unclear or contradicted (and where), so a human can resolve it
(the runner routes the item to needs-attention). Do not be shy about this: a
confident build on a wrong/ambiguous premise produces wrong-but-compiling work that
is far more expensive than a question. Building exactly what a flawed slice says is
NOT success.

To STOP, make NO source change and end your final report with this EXACT
machine-readable block (the runner detects it, routes the item to
needs-attention with your reason VERBATIM, and SKIPS the gate + review — so put
the specific drift report INSIDE it):

=== SLICE-STOP ===
<the specific reason: which premises are false, where, and a suggested re-scope>
=== END SLICE-STOP ===

The decision bar between "resolve and proceed" and "STOP" / "record a decision":
A genuinely small, certain, SELF-CONTAINED factual gap you can resolve from the
code itself (it affects nothing outside this slice), resolve and proceed silently.
But a choice that touches ANOTHER command/flag/slice, introduces a new
ERROR/REFUSAL, or sets a USER-VISIBLE DEFAULT is a DESIGN decision, NOT a small
factual gap — do NOT bury it in code. If it is load-bearing AND hard to reverse,
STOP (above). Otherwise PROCEED but RECORD it: end your report with a "## Decisions"
block, one entry per decision — what you chose + why + the alternative(s) you
considered + what it touches (which other flag/command/slice). This does NOT stop
the build; it makes the choice visible so the reviewer + the human can ratify or
reverse it. The bar is "would another slice / a user / a reviewer be surprised this
was decided here?" — if yes, record it. A real ambiguity or stale premise, STOP.

COHERENCE CHECK (before you introduce a new concept). Consistency and coherence
with the system's existing LANGUAGE is a first-class quality. Before you add a new
flag / config key / status / verb / named concept, check it against the project's
`CONTEXT.md` glossary + the ADRs + the existing code: (1) does the name already
MEAN something — are you silently re-meaning it or making it mean two things? (2)
is the concept at the RIGHT LAYER (e.g. a policy gate on the autonomous-selection
step vs the explicit verb a human typed)? (3) does it DUPLICATE/overlap an existing
concept you should reuse or rename instead of forking? If a new concept conflicts
with, re-means, or duplicates an existing one — or sits at the wrong layer — that is
NOT a "small factual gap": STOP if it is load-bearing/hard-to-reverse, else RECORD
it in `## Decisions` (what concept, what it overlaps, why your placement). This is
the prevention half of the review's conceptual-coherence lens — a muddled concept
that compiles is far more expensive than the question, because every later artifact
that reuses the muddled term inherits the debt.

Do NOT perform any git operations on THIS repo — do not stage, commit, push, or
move any files between work/ folders, and do not touch the item's lock ref or its
body at work/backlog/<slug>.md. The runner (or human) owns every git-state
transition (the durable main-moves AND the per-item lock acquire/release/amend).
(Your TESTS may freely create and operate on their OWN throwaway git repos — that
is expected.)

Leave a CLEAN working tree — only the changes this slice intends. The runner
commits everything untracked (`git add -A`), so any scratch, debug, or
runtime-artifact file you or your tools created would otherwise be swept into the
commit. Before you stop, delete such stray untracked files, or add them to
.gitignore if they legitimately belong ignored. This is NOT git work: deleting an
untracked file or editing .gitignore is producing clean WORK, like writing source
— the "no git" rule above (no stage/commit/push/move) still holds.

When the acceptance criteria are met and the repo's build/test/format checks are
green, STOP and report what you did. The runner handles the durable `git mv` of the
body backlog/ -> work/done/, the completion commit, the lock release, and
integration.
```

Why the "no git" line is **in-band** in the prompt (not delegated to a host config like a global `AGENTS.md`): a portable runner cannot assume the target machine has any such rule, so the boundary travels with the prompt. This keeps the acceptance-test gate authoritative (the agent can't commit/merge around it) and the runner the single owner of git state.

## Completed-slice commit message

The commit that completes a slice (the work + the `git mv` to `work/done/`) uses a consistent, greppable format so the lifecycle is visible in `git log` and an autonomous runner can author it deterministically:

```
<type>(<slug>): <slice title or short summary>; done
```

- `<type>` follows conventional-commits (`feat`, `fix`, `docs`, `chore`, …); use `feat` for a slice that adds behaviour.
- `<slug>` is the slice slug (its `work/done/<slug>.md` basename).
- the trailing **`; done`** marks the durable `backlog→done` transition landing in this commit (the claim itself has no `main` commit to mirror — it is a lock-ref acquire, not a folder move).

Example: `feat(scan): cross-repo eligible-work queue (read-only); done`

Keep it ONE commit (work + the `git mv`) so a slice's completion is a single, atomic, revertable unit — just as the claim is a single commit.

## Why this prevents (not merely detects) double-claims

The rejected push is the rejection of the claim. Because the arbiter serializes ref updates on `main`, only one `claim/<slug>:main` can be the fast-forward winner; all others are rejected atomically by `git receive-pack`'s ref lock. No lock server, no integrator process. `--force-with-lease` is a CAS against the expected old value (safe); `--force` would clobber and MUST NOT be used.

## Isolation for parallel AFK agents

Run each agent's work in its **own clone or worktree** so on-disk code changes can't collide; conflicts then only surface at integration time (normal PR-style resolution), never as corrupted shared state. Clones-of-an-arbiter give fully independent object stores (best isolation); worktrees share one object store (save disk) — either is fine, but prefer separate clones when many agents run at once.
