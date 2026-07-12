<!-- dorfl-sidecar: item=observation:rename-spec-4f-cli-flags-and-internal-purge-decisions-2026-07-10 type=observation slug=rename-spec-4f-cli-flags-and-internal-purge-decisions-2026-07-10 allAnswered=false -->

Item: [`observation:rename-spec-4f-cli-flags-and-internal-purge-decisions-2026-07-10`](../notes/observations/rename-spec-4f-cli-flags-and-internal-purge-decisions-2026-07-10.md)

## Q1

**What becomes of this signal — should this observation be deleted now that every decision and follow-up it recorded appears discharged?**

> Observation records batch-4f decisions (D1-D6) + one manual follow-up (regen compiled workflows). Current-reality probe: (a) parent task rename-spec-intake-cli-flags-and-residual-prd-identifiers is in work/tasks/done/; (b) D3 verdict content keys prdHumanOnly/prdNeedsAnswers have since been swept — intake.ts:156-160 now reads specHumanOnly/specNeedsAnswers, tracked by done task rename-spec-intake-verdict-outcome-and-content-keys; (c) manual follow-up on compiled workflows is discharged — no merge-prd/propose-prd/prd_flag/.prds[] hits in .github/workflows/intake.yml or advance-lifecycle.yml; (d) D5 `--prds-land-in` input surface removed (cli.ts:708 says 'HARD CUTOVER: the legacy --prds-land-in flag is GONE'); (e) D4/D6 protocol-contract cluster (<prd> placeholder, ResolvedTask.prd, to-prd prose) has been touched in prompt.ts and no protocol-contract spec remains open in work/specs/. Nothing here still names an open judgement.

_Suggested default: Delete — every decision/carve-out and the manual regen follow-up have landed; keeping the note adds no future signal._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Delete. Every decision (D1-D6) and the manual regen follow-up have landed: the parent task rename-spec-intake-cli-flags-and-residual-prd-identifiers is in work/tasks/done/, and the D3 verdict keys were swept (intake.ts now reads specHumanOnly/specNeedsAnswers). The note adds no future signal.
