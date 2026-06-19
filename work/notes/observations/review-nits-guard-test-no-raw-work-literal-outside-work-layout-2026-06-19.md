---
title: review-gate non-blocking nits for 'guard-test-no-raw-work-literal-outside-work-layout' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: guard-test-no-raw-work-literal-outside-work-layout
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'guard-test-no-raw-work-literal-outside-work-layout' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Unrecorded in-scope scoping decision to RATIFY: the matcher's `refPrefix` only matches an interpolated/text prefix that ends in `:` (a git-ref like `${ref}:work/done`). A hand-built ABSOLUTE path literal with a non-ref interpolated root prefix, e.g. the template literal `${root}/work/backlog/${slug}.md` or `${cwd}/work/done`, is NOT flagged. Since the centralisation specifically replaced absolute-path constructions (workFolderPath/workItemPath use join(root,'work',folder)), and the most natural way to re-scatter one in a future edit is exactly such a template literal, this is a real (if narrow) hole in the guard's net. The agent did not record this scope cut anywhere (there is no '## Decisions' block in the PR/commit body). Recommend the human ratify it as acceptable-for-now (the repo-relative form that workFolderRel/workItemRel build IS caught, and the split-arg form join(root,'work','backlog',...) was never a single literal under any guard) OR ask for a follow-up that also catches an interpolated `<prefix>/work/<folder>` body. It is trivially extensible (broaden the anchor to allow a leading non-`:` path prefix segment) and not load-bearing-or-hard-to-reverse, hence non-blocking.
  (test/work-layout-guard.test.ts buildPathLiteralRegex: `const refPrefix = (?:[A-Za-z0-9_.$\{\}/-]*:)?` requires the optional prefix to END in ':'. Verified empirically: regex.test('${root}/work/backlog/${slug}.md') === false; regex.test('work/backlog/${slug}.md') === true; regex.test('${ref}:work/done') === true. Current tree has 0 such absolute-template offenders, so the green gate is unaffected today; this is purely about future regression coverage.)
- Minor doc-comment number drift to note (no action required): the slice's forward-pointer estimates '~26' legitimate retained `work/<folder>` literals, but the guard's header JSDoc says '~70'. This is an estimate in a comment, not a behavioural claim, and the agent's larger figure appears closer to reality (55 src files touch a `work/<folder>` token, many with multiple occurrences). Flagging only so a reader is not confused by the two different numbers across the slice file and the test file; no fix needed unless you want them reconciled.
  (work/done/guard-test-no-raw-work-literal-outside-work-layout.md:33,41 say '~26'; test/work-layout-guard.test.ts:26 says '~70'. Both are descriptive prose about the deliberately-retained residual, not part of any assertion.)
