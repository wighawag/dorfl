---
title: agent prompt should make the build agent responsible for a clean working tree (delete/gitignore stray artifacts before finishing)
slug: agent-prompt-tree-cleanliness
blockedBy: []
covers: []
---

## What to build

> Self-contained protocol/prompt fix \u2014 derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live: a 402KB pi session log got swept into PR #3 by the runner's `git add -A`.

The runner commits the agent's work with **`git add -A`** (the completion commit sweeps EVERYTHING untracked in the working tree). The agent is the only party that KNOWS whether an untracked file is real work or junk \u2014 the runner's blind `git add -A` cannot tell. But the build-agent prompt currently says nothing about this: it tells the agent to implement + get the gate green + "the runner owns git" \u2014 so any stray/artifact file the agent (or its tooling) leaves behind becomes part of the committed deliverable. (Live example: a runtime pi session log committed into a PR.)

**The fix is a prompt-wording change to the canonical wrapper** \u2014 the single source of truth that flows to EVERY build agent. The wrapper is read VERBATIM from **`skills/to-slices/CLAIM-PROTOCOL.md`** (the "You are completing one work slice\u2026" fenced block under the work-agent-prompt section; `prompt.ts` extracts it via `extractCanonicalWrapperTemplate`). Add a short instruction making the agent responsible for the cleanliness of the tree the runner will commit:

- Before finishing, ensure the working tree contains **only the intended changes** for this slice. The runner commits EVERYTHING untracked (`git add -A`), so any scratch/debug/artifact file you (or a tool) created becomes part of the commit.
- For each stray/untracked file that should NOT be committed: **delete it**, or **gitignore it** if it legitimately belongs ignored (e.g. a generated dir). Use judgement \u2014 a real new source/test file is intended; a debug log, scratch output, a copied fixture you no longer need, or a runtime artifact is not.
- This is still NOT a git operation by the agent (it remains "no stage/commit/push/ move") \u2014 deleting an untracked file or editing `.gitignore` is part of producing clean WORK, exactly like writing source. The boundary that stays is: the agent does not run git STATE transitions (commit/push/mv); it IS responsible for the cleanliness of the work the runner then commits.

Keep it SHORT and in-band (the wrapper is deliberately terse; a sentence or two, in the same register as the existing "no git" / "drop an observation note" paragraphs). It must read coherently with the existing "do NOT perform any git operations" paragraph (this refines, not contradicts, it \u2014 cleaning the tree \u2260 doing git).

## Acceptance criteria

- [ ] The canonical wrapper in `skills/to-slices/CLAIM-PROTOCOL.md` (the work-agent prompt block) instructs the agent to leave a CLEAN tree \u2014 only intended changes \u2014 and to delete or gitignore stray/artifact untracked files before finishing, because the runner's `git add -A` commits everything untracked.
- [ ] The new wording is consistent with the existing "no git operations" boundary (deleting an untracked artifact / editing `.gitignore` is producing clean WORK, not a git STATE transition) and does not contradict it.
- [ ] It is short + in-band (matches the wrapper's terse register).
- [ ] `prompt.ts`'s `extractCanonicalWrapperTemplate` still parses the wrapper (the fenced block structure is intact); any prompt-assembly test still passes.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None \u2014 a self-contained edit to the canonical wrapper + (if any) the prompt-assembly test.

## Prompt

> The runner commits the agent's work with `git add -A`, so anything untracked the agent leaves becomes part of the commit (live example: a 402KB pi session log swept into a PR). The build-agent prompt says nothing about this. Add a SHORT, in-band instruction to the canonical work-agent wrapper making the agent responsible for a clean working tree: before finishing, leave ONLY the intended changes \u2014 delete stray/scratch/artifact untracked files, or gitignore ones that legitimately belong ignored. Make clear this is NOT a relaxation of the "no git" rule (deleting an untracked file / editing `.gitignore` is producing clean WORK, not a git STATE transition).
>
> READ FIRST: `skills/to-slices/CLAIM-PROTOCOL.md` \u2014 the work-agent-prompt fenced block ("You are completing one work slice in this repo\u2026"), specifically the\n> existing "Do NOT perform any git operations" paragraph (the new wording sits with it and must stay consistent). `src/prompt.ts` (`extractCanonicalWrapperTemplate` reads that fenced block VERBATIM \u2014 keep the fence structure intact) and any prompt-assembly test. CONTEXT.md / WORK-CONTRACT.md for the runner-owns-git principle (this refines the agent's side of it).
>
> Edit the wrapper text (terse, a sentence or two). Run the gate. "Done" = acceptance criteria met and green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim agent-prompt-tree-cleanliness --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/agent-prompt-tree-cleanliness <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/agent-prompt-tree-cleanliness.md work/done/agent-prompt-tree-cleanliness.md
```
