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
