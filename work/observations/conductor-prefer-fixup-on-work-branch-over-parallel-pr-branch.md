---
title: When a flake-recovered slice's work/<slug> branch needs a needs-attention→done fixup, commit the fixup ON that branch and PR it — do NOT spin a parallel pr/<slug> branch (it orphans the canonical branch)
date: 2026-06-08
status: open
---

## The signal

While conducting the `slicing-coherence` keystone (`slice-output-through-integration`),
the conductor needed to open a PR from a flake-recovered branch whose tip carried
green source work BUT sat under two runner commits — `save aborted work (wip)` +
`chore(…): route to needs-attention` — with the slice `.md` parked in
`work/needs-attention/`. To get a tidy single-commit PR, the conductor created a
SEPARATE `pr/slice-output-through-integration` branch off `origin/main`, re-applied
the source tree, moved the slice `needs-attention/ → done/`, and PR'd THAT.

It worked, but it left the canonical `work/slice-output-through-integration` branch
**orphaned on the remote** (its content now squash-merged via the `pr/` branch, but
the branch itself undeleted, carrying misleading "aborted/needs-attention" commit
subjects). The maintainer had to ask why a new branch existed and why the old one
still lingered; the conductor then deleted it manually.

## The smell

The `work/<slug>` branch is the CANONICAL home for a slice's work (the runner cuts,
keeps, and re-claims it; `requeue` keep+continue is DEFINED in terms of it). Spinning
a parallel `pr/<slug>` branch:

- **orphans** the canonical branch (it must then be remembered + deleted by hand —
  exactly the cleanup that got missed here), and
- **discards** the branch's real history in favour of a re-applied tree, for no gain
  beyond cosmetic single-commit tidiness.

The conductor over-defaulted to "clean slate" when "fix up in place" was equally
available and cheaper: the fixup the `pr/` branch needed (move `needs-attention/ →
done/`, strip the runner's reason note) could simply have been COMMITTED ON the
existing `work/<slug>` branch, and that branch PR'd directly. One branch, no orphan,
real history preserved.

## The guidance (for the conductor / drive-backlog)

When a flake-recovered (or otherwise manually-finished) slice's `work/<slug>` branch
holds green work but needs a small lifecycle fixup before PR:

1. Commit the fixup (`git mv work/needs-attention/<slug>.md →
   work/done/<slug>.md`, strip the runner's needs-attention reason, etc.) **ON the
   existing `work/<slug>` branch**.
2. `gh pr create --head work/<slug>` (or push it as the PR head). One branch, its
   own history, no orphan.
3. Only spin a fresh branch if the canonical one is genuinely unusable (e.g.
   poisoned history that must not land) — and if you do, DELETE the orphan in the
   same breath.

## Why this largely disappears soon

This manual dance exists ONLY because the no-op backstop currently mis-routes a
requeue continue-from-tip (see
`work/observations/noop-backstop-misfires-on-requeue-continue-from-tip.md`, promoted
to slice `noop-backstop-counts-branch-commits`). Once that lands, a re-`do` continues
from the kept `work/<slug>` branch tip and the runner ITSELF opens the PR — no manual
fixup, no branch choice, no orphan. So this guidance is a stopgap for the window
before that fix lands; after it, prefer letting `do` re-drive the slice over any
manual PR at all.

## Related

- `noop-backstop-misfires-on-requeue-continue-from-tip.md` / slice
  `noop-backstop-counts-branch-commits` — the underlying gap that forces the manual
  PR in the first place.
- `requeue-continue-and-reset` (`work/done/`) — defines the keep+continue contract
  this branch is the subject of.
