<!-- dorfl-sidecar: item=observation:advance-lifecycle-yml-regenerated-by-tests type=observation slug=advance-lifecycle-yml-regenerated-by-tests allAnswered=false -->

## Q1

**Should this observation be closed/archived as resolved, given that both symptoms it flagged no longer reproduce on current main?**

> On current main HEAD, pnpm format:check passes cleanly, and running pnpm -r test (2880 tests) leaves the working tree clean — advance-lifecycle.yml is NOT regenerated with a diff. The intermediate commit 9d5f9efc (style(ci): prettier-format advance-lifecycle.yml (pre-existing drift)) re-committed a prettier-canonical yml, which matches what advance-lifecycle-template.ts now emits, so template output and committed file and prettier now agree.

_Suggested default: Yes — mark the observation resolved (fixed by 9d5f9efc); no template-emitter change needed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Yes, resolved. Both symptoms no longer reproduce on current main (format:check clean, tests leave the tree clean, template output = committed file = prettier all agree, fixed by 9d5f9efc). Delete the observation; no template-emitter change needed.

## Q2

**Is a defensive follow-up still wanted to prevent future recurrence when the template YAML strings change again?**

> The observation suggested two fixes: (a) make the template emitter always produce prettier-canonical form, or (b) just re-commit a prettier'd yml. Only (b) was done. Any future edit to a quoted YAML string in advance-lifecycle-template.ts could re-introduce the same three-way drift (committed vs. regenerated vs. prettier). A CI/test-time invariant that runs prettier over the freshly emitted template and fails on diff would catch it at the source.

_Suggested default: No — accept the recurrence risk; treat it as a one-shot drift already fixed._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

No defensive follow-up. Accept the low recurrence risk (only a future edit to a quoted YAML string could re-introduce it, and the acceptance gate's format:check would catch a committed-file drift anyway). Treat as a one-shot already fixed. If it recurs, then add the emit-and-prettier-diff invariant.
