# The hub-mirror key encodes host+path, NOT transport — local↔remote arbiter switch silently forks the mirror

2026-06-04 (while explaining the arbiter / hub-mirror / worktree layering)

## What the key encodes today

`encodeRepoKey` (`src/repo-mirror.ts`) deliberately **drops the scheme / user /
port / `.git` suffix** and keys off **host + path segments only** (its docstring:
those "carry no identity for keying"). So:

- A **GitHub arbiter** keys off the host: `git@github.com:wighawag/agent-runner.git`,
  `https://github.com/wighawag/agent-runner.git`, and
  `ssh://git@github.com/wighawag/agent-runner.git` all → `github-com/wighawag/agent-runner`.
- A **local bare arbiter** has no host, so the path becomes the key:
  `file:///home/me/git/host.com/org/repo.git` → `home/me/git/host-com/org/repo`.

This drives both `mirrorPath` (`<workspacesDir>/repos/<key>.git`) and, via
`encodeWorkId`, the job worktree dir (`<workspacesDir>/work/<key-flattened>__<slug>/`).

## What is correct and should NOT change

Collapsing `ssh://` ↔ `https://` ↔ scp-like `git@` for the **same GitHub repo**
onto **one** key is intentional and right: they are the same repo and *should*
share one mirror (one object store, one set of `work/<slug>` branches). The
`encodeRepoKey` tests pin this ("stable with or without `.git`"). **Encoding the
transport into the key would break this** and fragment a single project's mirror
+ work branches across several mirrors — it fixes a rare footgun by introducing a
common one. So: do not add transport to the key.

## The actual gap

Switching a project's arbiter between a **local bare** repo and its **GitHub**
equivalent (same logical project, different host+path) produces **different
keys**. `ensureMirror` is "create if absent, else fetch" with no notion of "this
project already has a mirror under another key", so:

- the old hub mirror (`home/me/git/...`) is left behind and silently goes stale;
- a fresh mirror (`github-com/...`) is created;
- worktrees cut from the stale mirror may still hold **un-pushed `work/<slug>`
  branches** — work that is now stranded and invisible to the new mirror.

Nothing errors out. The dangerous condition is specifically **stranded un-pushed
work**, not the switch itself (a clean switch with no live worktrees is harmless).

## Proposed direction (NOT yet sliced)

Guard on *project identity* (the trailing `org/name` of the key), not on the URL,
since two arbiters for the same project have different keys and the system can't
otherwise know they're related:

- **Cheap:** a `doctor` / `arbiter status` warning when >1 hub mirror shares the
  same trailing `org/name` ("two arbiters for one project; un-pushed work may be
  stranded on the other").
- **Stronger:** at claim / `work-on` time, if a sibling mirror (same `org/name`
  tail, different key) exists AND holds un-pushed `work/<slug>` branches, **refuse**
  with a clear message unless `--force` — scoped to the stranded-work condition,
  not the harmless clean switch.

Precedent for "refuse the unsafe thing with a clear message" already exists in
`src/arbiter.ts` (`assertBare`); a guard here fits that safety philosophy. No
action taken yet — captured for slicing.

## Update (2026-06-05) — cheap guard LANDED; corrections; strong-version decided

**Corrections to the above (maintainer):**

- **Key is `host/org/name` OR `host/path`**, not just `org/name`. `encodeRepoKey`
  drops scheme/user and keys on **host + path segments**; the project-identity tail
  is the path part under the host (commonly `org/name`, but it is the path, not
  necessarily two segments). Guard on that path-tail-under-host, not literally
  "`org/name`".
- **Drop the `doctor` framing.** `doctor` is NOT planned (the command-surface ADR
  leaves it explicitly undecided). Ignore the `doctor` mention above.

**The cheap guard landed** in `registry-remote` (PR #1, in `done/`): `remote add`
refuses registering one project (same host/path identity, via `projectIdFromKey`)
under a second TRANSPORT unless `--force`, reading the existing mirror's origin via
`git remote get-url`. So the transport-mismatch case is now guarded at
registration time.

**Strong version — DECIDED design (future slice):**

- **Block on an existing mirror for the same project regardless of un-pushed work**
  (i.e. `remote add` of a second arbiter for an already-registered project refuses
  by default — not only on transport mismatch but on project-identity collision).
- **`--force` allows REPLACING a mirror** — so you can re-link a project's mirror
  from a remote to a `--bare` arbiter (or vice-versa) deliberately.
- **BUT `--force` must STILL FAIL if un-pushed work is detectable** on the mirror
  being replaced — we never silently lose work. (Force overrides the *policy*
  block, never the *data-loss* block.)

**Feasibility — un-pushed work IS detectable, but NOT from the mirror's refs alone
(important correction).** Two KINDS of un-pushed work, with different homes:

- **Committed-but-unpushed:** a job worktree's commits + its `work/<slug>` branch
  ref ARE in the bare mirror's object store (the worktree shares the mirror's
  objects; the local `work/*` ref moves as the worktree commits). Detectable from
  the mirror: a local `work/*` tip NEITHER merged into `origin/main` NOR equal to
  `origin/<branch>` tip.
- **Uncommitted (DIRTY working tree):** lives ONLY in the worktree's files on disk
  — it is no git object, no ref, NOT in the mirror. **A mirror-refs-only check
  CANNOT see it.** (This is the crash/abort case the original "stranded work"
  worry centres on.)

This is exactly why the existing **§4 deletion-safety predicate** (`src/gc.ts`) has
TWO conditions: (1) the **working tree is clean** — checked by `git status` INSIDE
the worktree, not on the mirror — AND (2) the branch tip is **reachable on the
arbiter** (`merge-base --is-ancestor` OR `origin/<branch>` tip == local tip), the
mirror-side check. So the strong guard must apply the FULL per-worktree predicate,
not a mirror-refs-only check.

The system CAN enumerate a mirror's worktrees to do this: `discoverJobs(
workspacesDir)` walks `<workspacesDir>/work/*` for `.agent-runner-job.json`
records, each carrying the mirror KEY — so it maps mirror → its job worktrees and
can run the clean/reachable predicate in each. (`git worktree list` in the mirror
is the other half.) So: the strong guard REUSES `gc.ts`'s per-worktree predicate
across the replaced mirror's worktrees; `--force` proceeds only when every
worktree is provably safe (clean AND reachable) — a dirty worktree blocks `--force`
even though the mirror's refs look fine.

Still a future slice (not phase-2). The cheap guard suffices for now; this records
the decided shape so the strong version is buildable when wanted.

## Promoted 2026-06-08

The STRONG replace-time guard is PROMOTED to slice
`work/backlog/hub-mirror-strong-replace-guard.md` (the cheap transport-mismatch
guard already landed via `registry-remote`). Delete this observation once the strong
guard slice lands in `done/`.
