<!-- dorfl-sidecar: item=observation:frontmatter-inline-list-mis-parses-trailing-comment-blocks-templated-tasks-2026-06-24 type=observation slug=frontmatter-inline-list-mis-parses-trailing-comment-blocks-templated-tasks-2026-06-24 allAnswered=false -->

## Q1

**This observation has already been resolved in-place (see the '## Update 2026-06-24 — fixed' section): the `parseInlineList` flaw was fixed via a new quote-aware `inlineListInner(value)` helper, the parser↔template drift guard plus other fixtures were added in `test/frontmatter.test.ts`, and the gate is green (build + 2593 tests + format:check). How should the observation itself be routed now?**

> The body documents the defect (`packages/dorfl/src/frontmatter.ts` `parseInlineList` doing blind `slice(1,-1)` on `blockedBy: [] # startable now`, yielding a phantom `"] # startable no"` dep that silently made template-default tasks ineligible), and the trailing '## Update 2026-06-24 — fixed' section records that the fix AND the suggested regression guards (including the shipped-template drift guard the observation explicitly asked for) have already landed and been verified. No follow-up task or ADR is named as outstanding — the 'Suggested fix (for the spawned task)' section has effectively been executed in-place rather than spawned out. So there is nothing left for a new task to do; the only open judgement is the terminal disposition for the observation file itself.

_Suggested default: dropped — the signal has fully landed (code fix + the requested template/parser drift regression guard + other fixtures, gate green); move the observation to its terminal folder with `reason: resolved in-place 2026-06-24` in the body rather than spawning a redundant task or ADR._

<!-- q1 fields: id=q1 disposition=dropped -->

**Your answer** (write below this line):

dropped (reason: resolved in-place 2026-06-24). The quote-aware `inlineListInner()` fix shipped, the parser-template drift guard and other fixtures were added in `test/frontmatter.test.ts`, and the gate is green (build + 2593 tests + format:check). Nothing left for a follow-up task or ADR.
