<!-- dorfl-sidecar: item=task:merge-questions-gate-axis type=task slug=merge-questions-gate-axis allAnswered=false -->

## Q1

**Gate name: what should the new per-repo gate axis be called?**

> Task body OQ7.1 lists candidates `mergeQuestions`, `surfaceMerge`, or another option consistent with the existing gate vocabulary (the same precedence-chain helper used by `merge-retries-gate-precedence` and sibling gates). Pick one name — it must be SEPARATE from `observationTriage`.

_Suggested default: `mergeQuestions` — parallels existing gate-name shape (single noun-phrase like `observationTriage`) and names the thing being gated rather than the verb._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Default value: what should the resolved default for this gate be?**

> Task body OQ7.2 + prd fix: default must NOT be `off` (a dropped merge-question means pushed work never lands). `ask` = surface + wait for a human answer; `auto` is allowed only for repos that trust auto-landing of answered/unblocked merges (merge-mode-like fast path); `off` is only correct for repos that land by other means. Acceptance criterion explicitly forbids `off` as the default.

_Suggested default: `ask` — the prd's stated likely default; safest higher-than-`off` choice, leaves `auto` opt-in per repo._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Shape: three-state `off | ask | auto` (mirroring `observationTriage`), or boolean?**

> Task body OQ7.3: 'The prd leans 3-state; confirm or override.' Three-state mirrors `observationTriage`'s shape exactly and gives repos the auto fast-path without a second flag; boolean is simpler but cannot express the `auto` mode listed in OQ7.2.

_Suggested default: Three-state `off | ask | auto` — matches the prd's lean and mirrors `observationTriage`, keeping the gate vocabulary uniform._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
