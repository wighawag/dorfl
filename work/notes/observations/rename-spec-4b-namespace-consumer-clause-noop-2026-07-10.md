# 4b: the "close-job/lifecycle-gather `namespace === 'prd'` consumers" clause is a no-op in those files (2026-07-10)

While building `rename-spec-remaining-src-modules-b`, the task's first acceptance clause ("`close-job.ts`/`lifecycle-gather.ts` `namespace === 'prd'` consumers also match `'spec'`; add `|| === 'spec'`, keep `'prd'`") rests on a premise that does not match the code:

- `close-job.ts` has NO `namespace` field or `'prd'` literal at all. Its consumer axis is `via: 'brief' | 'issue'` (renamed to `via: 'spec' | 'issue'` here), not `namespace`.
- `lifecycle-gather.ts` has NO `namespace === 'prd'` COMPARISON. It only EMITS `namespace: 'prd'` literals into `BlockedItem`/`NeedsAnswersCandidate` (the sidecar identity key). The only `===` in the file is `needsAnswers === true`.

Every real `namespace === 'prd'` comparison lives in sub-batch (a)/(c) files (`do.ts`, `advance*.ts`, `scan.ts`, `cli.ts`, `do-remote-auto.ts`, `advance-isolated.ts`, `do-autopick.ts`) — which this task's own scope boundary lists as OUT of scope. Sub-batch (a)'s done record explicitly says "the `namespace === 'prd'` value-consumer switches owned by 4b/4c" but points them at do/advance, not at close-job/lifecycle-gather.

Decision (PROCEED, recorded per the decision-bar rule): I treated the clause as a VERIFIED NO-OP for these two files rather than inventing a change. The "add `|| === 'spec'`" shape only fits a comparison consumer; neither file has one.

I deliberately did NOT flip lifecycle-gather's `namespace: 'prd'` EMITTERS to `'spec'`, because that is NOT additive: `sidecarPathFor('spec:<slug>')` resolves to `work/questions/spec-<slug>.md` while `prd:<slug>` resolves to `prd-<slug>.md` (two distinct files). Flipping the emit would make the needsAnswers sidecar read MISS every prd sidecar still on disk as `prd-<slug>.md`, breaking the apply pool until the migration command converts data — contradicting the task's own "additive-migrate, green in isolation, the `prd` alias covers untouched occurrences" framing. That data-path flip belongs with the folder/data migration (the `prd-to-spec` command), not this comment+`via`-tag sweep.

The real, well-specified work of this task (the `via: 'brief' → 'spec'` live union tag in close-job/frontmatter, `prdCandidates → specCandidates`, the `closeComment` user-facing string, `resolveClosingIssue`'s return field `prd → spec` + read `fm.prd → fm.spec`, and the ~14 "the brief" doc-comments) was done and the full gate is green.

Alternatives considered: (a) STOP the task as drifted — rejected because the drift is a small, self-contained factual gap resolvable from the code (the consumers are simply elsewhere), and the bulk of the task is real and unambiguous; (b) flip the emitters — rejected as non-additive/user-visible-data-path-breaking (above).
