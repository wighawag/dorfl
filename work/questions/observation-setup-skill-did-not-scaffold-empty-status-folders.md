---
item: observation:setup-skill-did-not-scaffold-empty-status-folders
type: observation
slug: setup-skill-did-not-scaffold-empty-status-folders
allAnswered: false
---

## Q1
id: q1
question: |
  Which contract does the setup skill enforce for the empty status folders: (A) EAGER — setup creates all 12 work/ folders up front (incl. slicing/, prd-sliced/, in-progress/, needs-attention/, done/, out-of-scope/) each with a .gitkeep, making this run a skill-fidelity bug; or (B) LAZY — status folders are created on demand by whoever first writes/moves into them (runner / git mv), making the skill TEXT wrong for over-specifying eager creation and this run's partial skeleton correct?
context: |
  A setup run on the rocketh repo produced only the 6 work/ folders it populated (prd, backlog, ideas, observations, findings, protocol); the 6 empty status folders (slicing, prd-sliced, in-progress, needs-attention, done, out-of-scope) were missing, even though Phase A / A1 / A5 of skills/setup/SKILL.md enumerate all 12 and instruct .gitkeep for each. The maintainer (2026-06-10) leans (B): empty status folders are a convention, not a requirement; an absent folder is not a broken contract, and `git mv` creates the destination dir anyway. The disposition depends on which way this resolves: (A) ⇒ promote-slice to fix the skill's scaffold step + add an eval invariant 'full skeleton present after setup'; (B) ⇒ promote-slice to relax the skill text (drop eager-creation of empty status folders, document lazy creation) after verifying no runner/lifecycle step assumes the folder pre-exists.
default: |
  (B) Lazy — relax the skill text; promote-slice to edit skills/setup/SKILL.md Phase A / A1 / A5 to stop instructing creation of empty status folders + .gitkeep, document lazy-on-first-use, after a quick verification that `git mv` into work/done/ etc. succeeds when the dir is absent and no other lifecycle step reads the folder before writing it.
answered: false
answer: |
disposition: promote-slice
