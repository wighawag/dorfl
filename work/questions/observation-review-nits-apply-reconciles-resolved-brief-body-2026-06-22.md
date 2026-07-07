<!-- dorfl-sidecar: item=observation:review-nits-apply-reconciles-resolved-brief-body-2026-06-22 type=observation slug=review-nits-apply-reconciles-resolved-brief-body-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation recording the four non-blocking Gate-2 review nits for the landed slice 'apply-reconciles-resolved-brief-body' — keep it as a durable triage record, promote one or more nits to a follow-up task/ADR, or delete it because the nits are already addressed or absorbed elsewhere?**

> The observation (work/notes/observations/review-nits-apply-reconciles-resolved-brief-body-2026-06-22.md, status: open, needsAnswers: true) is the durable home for four nits raised when Gate 2 APPROVED the slice. Reality has since moved on: both this slice AND its sibling 'templates-mark-transient-open-questions-block' have LANDED (both in work/tasks/done/). Nit-by-nit against current reality: (1) Decisions-visibility nit — the done task file (work/tasks/done/apply-reconciles-resolved-brief-body.md lines 15-16) records the WIRING decisions but NOT the three behavioural choices (strip-all-pairs / fail-safe-on-unmatched-fence / collapse \n{3,}); those still live only in the stripOpenQuestionsBlocks JSDoc (apply-persist.ts ~276-300). (2) Cross-slice marker contract — RESOLVED in fact: the literal '<!-- open-questions -->' / '<!-- /open-questions -->' matches byte-for-byte between apply-persist.ts (OPEN_QUESTIONS_MARKER_OPEN/CLOSE, lines 99-100) and the landed templates (skills/setup/protocol/{task,prd}-template.md); and the sibling observation's sidecar (work/questions/observation-review-nits-templates-mark-transient-open-questions-block-2026-06-22.md Q2) ALREADY surfaces the explicit ratification of this load-bearing literal, so re-surfacing it here would duplicate. (3) Marker-namespacing design choice — see the next question; still genuinely open. (4) Terminal-route test gap — see the third question; confirmed still open.

_Suggested default: keep — retain as the durable triage record; nits 1-2 are visibility/ratification-only and nit 2 is already covered by the sibling sidecar, so no new task is needed for them. Spin nits 3 and 4 into the two questions below rather than a code change here._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep as the durable triage record. Nits 1-2 are visibility/ratification-only and nit 2 is already covered by the sibling sidecar, so no new task for them. Nits 3 and 4 are handled in Q2/Q3 below.

## Q2

**Should the open-questions fence markers stay un-prefixed ('<!-- open-questions -->' / '<!-- /open-questions -->'), or be renamed to carry the 'dorfl-' namespace (e.g. '<!-- dorfl-open-questions -->') to match the existing '<!-- dorfl-sidecar: … -->' style and avoid colliding with author-written HTML comments?**

> Nit 3. sidecar.ts already namespaces its HTML-comment markers under 'dorfl-' (e.g. '<!-- dorfl-sidecar: … -->'); the new open-questions markers do NOT (confirmed: no 'dorfl-open-questions' string exists anywhere in packages/, skills/, or work/). The brief (apply-reconciles-stale-open-questions D1) offered '<!-- open-questions -->' only as an 'e.g.' example, so the un-prefixed form is not a contract violation — but the brief also said 'mirroring how the sidecar already uses HTML-comment markers', and strict mirroring would have included the prefix. Risk: an author writing the literal '<!-- open-questions -->' in their own brief prose would now trigger the strip. Probability is low, but the namespace was free. Renaming now touches three sites only (apply-persist.ts constants + task-template.md + prd-template.md) since the markers are centralised; cost rises once briefs are authored against the un-prefixed form.

_Suggested default: keep un-prefixed — the brief used the un-prefixed example, both siblings already landed consistent on it, and the collision risk is low; only revisit if an author-collision is actually observed._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Keep un-prefixed. The brief used the un-prefixed example, both siblings already landed consistent on it, and the author-collision risk is low. Only revisit (rename to `dorfl-open-questions`) if an actual author-collision is observed; the markers are centralised so a later rename is cheap.

## Q3

**Is a belt-and-braces test wanted that exercises the body-reconcile (strip of the marker-fenced block) on a terminal-disposition route (e.g. 'keep' or 'delete'), or is coverage of the default full-resolution route sufficient given the code structurally feeds all terminal routes through the same strip?**

> Nit 4. The reconcile (const reconciledBody = stripOpenQuestionsBlocks(baseBody), apply-persist.ts ~435) sits BEFORE the terminal === 'keep' branch and feeds the keep/delete/default branches alike, so structurally the strip reaches every full-resolution route. But the tests (packages/dorfl/test/apply-persist.test.ts) only assert the reconcile on the default resolve (the 'marker-present full-resolution' test ~406) plus the re-pause RETAIN case (~435) — confirmed no marker-fenced reconcile test on the keep/delete/dropped/needs-attention routes. A single test on (say) the keep route would lock that the strip also reaches there and guard against a future refactor moving the strip inside the default branch.

_Suggested default: add a single terminal-route reconcile test (e.g. on the 'keep' route) as a small low-priority follow-up; not a blocker since the code path is shared._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Add a single terminal-route reconcile test (e.g. on the `keep` route) as a small low-priority follow-up. Not a blocker since the strip is structurally shared across all terminal routes, but the test locks that invariant against a future refactor moving the strip inside the default branch.
