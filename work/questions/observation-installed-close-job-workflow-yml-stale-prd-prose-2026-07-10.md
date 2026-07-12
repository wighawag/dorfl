<!-- dorfl-sidecar: item=observation:installed-close-job-workflow-yml-stale-prd-prose-2026-07-10 type=observation slug=installed-close-job-workflow-yml-stale-prd-prose-2026-07-10 allAnswered=false -->

Item: [`observation:installed-close-job-workflow-yml-stale-prd-prose-2026-07-10`](../notes/observations/installed-close-job-workflow-yml-stale-prd-prose-2026-07-10.md)

## Q1

**The stale prd prose this observation flagged in .github/workflows/close-job.yml appears to have been swept by commit f89c8037 (cleanup(prd->spec): ... sweep stale prd/PRD comment prose in generated .github/workflows/*.yml). Should this observation be marked resolved/archived rather than remain a live note?**

> Current .github/workflows/close-job.yml no longer contains task.prd:, prd:<slug>, or prd complete? — grep for those strings returns 0 hits. The single prd match on line 17 is prd-complete-query, which is the identifier also present in the template source (packages/dorfl/src/close-job-template.ts line 19). The template and installed copy now both use spec:/spec complete? prose. Commit f89c8037 also tightened the WORD leak scan so that living-doc .github/*.yml drift like this is now flagged rather than exempted, closing the mechanism that let it drift unnoticed.

_Suggested default: Yes — mark resolved: f89c8037 swept the prose AND fixed the scan gap, so both the symptom and the root cause the observation raised are addressed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
