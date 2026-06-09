---
title: The repo has an in-repo skills/ tree (skills/review, skills/to-slices, …) AND the runtime reads from an installed ~/.agents/skills/ copy — an edit to one may not reach the other; confirm which is canonical for the running agent
date: 2026-06-08
status: open
---

## The signal

Surfaced building `slicer-loop-set-lens-prompt` (the slicing-coherence chain). The slice's AC#2 said: edit the `review` skill's set-of-slices mode IF the skills tree is in-repo-editable, ELSE flag it. The agent edited `skills/review/SKILL.md` (in-repo, versioned). Gate-2 nit #2 then asked the right question: **is the in-repo `skills/` tree the copy the RUNTIME actually reads, or is it shadowed by a separately-installed skill?**

Observed reality this session: the harness loaded skills from `~/.agents/skills/<name>/SKILL.md` (e.g. `~/.agents/skills/review/SKILL.md`, `~/.agents/skills/to-slices/SKILL.md`) — an INSTALLED tree, NOT the repo's `skills/` folder. So an edit to the repo's `skills/review/SKILL.md` is the correct change to the CANONICAL VERSIONED source (it belongs in the repo, travels with the code, is what a fresh clone/install would pick up), but it is **informational-only for a CURRENTLY-running agent** until that installed copy is re-synced from the repo.

## Why it matters

Two copies of the same skill that can drift:

- **`<repo>/skills/`** — versioned source of truth, in the repo's contract, what `to-slices`/`review`/`drive-backlog` document as the on-disk skills.
- **`~/.agents/skills/`** — the INSTALLED copy the live harness actually reads.

A slice that edits the in-repo copy (correctly) does NOT change the behaviour of the agent running RIGHT NOW (which reads the installed copy). Conversely, a local edit to `~/.agents/skills/` would change live behaviour but NOT be captured in the repo. Either edit alone leaves the two out of sync.

## What to confirm / fix direction

1. **Confirm the relationship** (maintainer): is `~/.agents/skills/` a symlink to / install-from `<repo>/skills/`, or an independent copy? If independent, document the sync step (how a repo `skills/` change reaches the installed tree) so a slice author knows whether editing the in-repo copy is sufficient or needs a follow-up install/sync.
2. **Make the canonical-source rule explicit** in WORK-CONTRACT / the skills' own docs: "the repo `skills/` tree is the source of truth; the installed `~/.agents/skills/` copy is derived — re-sync after editing." So slices that edit a skill (like this one) know the in-repo edit is correct AND whether a sync is needed for it to take effect live.

This is NOT a defect of `slicer-loop-set-lens-prompt` (it did the right thing — edited the versioned source + added a content assertion on the in-source `buildSliceReviewPrompt`, which IS what the runtime reads for the prompt). It is a latent two-copies subtlety worth pinning before a future skill edit silently "doesn't take".

## Related

- `review-nits-slicer-loop-set-lens-prompt-2026-06-08.md` (#2) — the Gate-2 nit that asked this question.
- `work/done/slicer-loop-set-lens-prompt.md` — the slice; its AC#2 anticipated the in-repo-vs-flag branch.
