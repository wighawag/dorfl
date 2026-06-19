# Spurious directory-rename rebase conflict when a done-move empties a sparse work/ folder

**Spotted 2026-06-19** while recovering `sweep-dead-surface-commit-path-after-lock-cutover` (it bounced twice in CI `advance-lifecycle`; the second failure was NOT a red gate but `rebase onto the latest main conflicted`).

## What happened

The `sweep-dead-...` work branch carried its own durable done-move
`git mv work/backlog/sweep-...md -> work/done/sweep-...md`, made when `work/backlog/`
held essentially only that one slice. Git's RENAME DETECTION then inferred a whole
**directory rename** `work/backlog/ -> work/done/` for that commit. When the runner
later continued the kept branch by rebasing it onto a `main` that had ADDED 6 new
files into `work/backlog/` (the `folder-taxonomy-reorg-and-rename` slices), git
applied the inferred directory rename and flagged each of those 6 new files as
`CONFLICT (file location): ... added in HEAD inside a directory that was renamed ...
suggesting it should perhaps be moved to work/done/<slug>.md`.

The conflict is SPURIOUS: verified there is NO content conflict (the 6 slice files
are byte-identical to main's), and the sweep branch never touched them. The runner
did the right thing (abort, never auto-resolve, mark the lock stuck) because a
directory-rename conflict is indistinguishable from a real one without judgement.
Recovered via `requeue --reset` (discard the stale branch; the code sweep is
mechanical and regenerates cleanly off current main, where `work/backlog/` now has
7 files so the whole-dir-rename heuristic no longer fires).

## Why it matters (it will recur)

This bites ANY branch that carries a durable folder transition (`backlog -> done`,
`prd -> prd-sliced`, `backlog -> dropped`, and after the taxonomy reorg the
`tasks/*` / `briefs/*` moves) WHEN the source folder is SPARSE enough at branch
time that git reads the single move as a whole-directory rename, AND `main` later
adds files into that same folder. It is a latent false-needs-attention source: the
runner stuck-locks a branch over a conflict that is purely git's rename heuristic,
not a real clash. The taxonomy migration makes this MORE likely, not less (more
folders, several of them often holding 0-1 files: `tasks/cancelled/`,
`briefs/dropped/`, `briefs/proposed/`, etc.).

## Candidate fix (rethink welcome)

Make every work/ folder PERSISTENTLY NON-EMPTY so a single item's move can never be
read as a whole-directory rename:

- Have `setup` scaffold a sentinel file in EACH work/ folder. Prior discussion
  leaned toward a **`README.md` per folder describing what that folder is** (its
  regime + lifecycle role) rather than an empty `.gitkeep` — it doubles as
  human-facing documentation of the tree AND keeps the directory populated so git
  never infers a directory rename from the last item leaving.
- The README content is a natural fit for the `protocol-docs-skills-and-setup-scaffold-new-vocabulary`
  taxonomy slice (it already owns the `setup` scaffold of the new
  `notes/`/`tasks/`/`briefs/` tree). Consider folding "scaffold a per-folder
  README" into that slice, or cut a small dedicated slice.
- Open question to settle when this is picked up: README vs `.gitkeep` (README is
  richer but is itself a non-`*.md`-item file the item-scan predicate must exclude
  — the `work-layout` item-scan rule would need to treat `README.md` as a reserved
  non-item, like it already must for other companions); whether the existing
  (already-shipped) repos need a backfill migration; and whether a lighter fix
  (e.g. disabling rename detection on the runner's rebase, `-Xno-renames` /
  `merge.renames=false` for the continue-rebase) is preferable or complementary.

Recorded as a spotted signal (it leaves by deletion once a slice/ADR absorbs it).
