---
item: prd:folder-taxonomy-reorg-and-rename
type: prd
slug: folder-taxonomy-reorg-and-rename
allAnswered: false
---

## Q1
id: q1
question: |
  What is the PRD-side rename target — i.e. how should the brief/PRD staging vs pool folders be named after the rename?
context: |
  Per the REVISED 2026-06-19 banner (which supersedes the body), the slice-side rename is decided: `backlog → todo` (pool keeps being the pool, new name) and `pre-backlog → backlog` (staging takes the freed name). The PRD-side rename target is NOT yet decided and is flagged as the one true blocker that gates slicing (it determines the PRD-side `git mv` mapping and the protocol vocabulary). Today's shipped names are `pre-prd/` (PRD staging) and `prd/` (auto-slice pool). Three options on the table:
    (a) MIRROR the slice rename: `prd → prd-ready` (pool) + `pre-prd → prd` (staging), so 'bare name = staging, qualified name = pool' is consistent across both sides.
    (b) KEEP `pre-prd`/`prd` as-is (rename only the slice side), accepting the two sides name their pool differently.
    (c) Under the `slice→task`/`prd→brief` rename, fold into the umbrella verbs (`briefs/untasked → briefs/tasking → briefs/tasked`) and drop the staging/pool distinction's bare-vs-qualified naming entirely.
  The banner explicitly says a human must pick (a)/(b)/(c). Whichever wins must be mirrored into BOTH protocol copies (`skills/setup/protocol/*` SOURCE OF TRUTH + propagated `work/protocol/*`) as a Phase-1 acceptance criterion.
answered: false
answer: |
