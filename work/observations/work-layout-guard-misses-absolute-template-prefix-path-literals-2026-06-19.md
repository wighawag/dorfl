---
title: work-layout guard misses absolute-path interpolated-prefix literals (e.g. `${root}/work/backlog/${slug}.md`)
date: 2026-06-19
status: open
reviewOf: guard-test-no-raw-work-literal-outside-work-layout
priority: low
---

## What was noticed

While merging the Phase-0 guard slice
(`guard-test-no-raw-work-literal-outside-work-layout`, PR #174, drive-backlog
conductor Gate-3), the Gate-2 review surfaced a narrow coverage gap in the
guard's path-construction matcher, ratified at merge as acceptable-for-now and
recorded here so it is not lost.

The matcher in `test/work-layout-guard.test.ts` (`buildPathLiteralRegex`) flags a
string/template literal only when its WHOLE content is a `work/<folder>` path,
with an OPTIONAL prefix that must end in `:` (a git-ref like `${ref}:work/done`
or `${arbiter}/main:work/backlog`). Empirically:

- `regex.test('work/backlog/${slug}.md')` === true (caught)
- `regex.test('${ref}:work/done')` === true (caught)
- `regex.test('${root}/work/backlog/${slug}.md')` === **false** (NOT caught)
- `regex.test('${cwd}/work/done')` === **false** (NOT caught)

So a future regression that re-scatters an ABSOLUTE path via an interpolated
non-`:` root prefix (`${root}/work/<folder>/...`) would slip past the guard.

## Why it is non-blocking (and why it was ratified)

- The centralisation (`work-layout`) produces the REPO-RELATIVE forms
  (`workFolderRel` / `workItemRel` -> `work/<folder>/...`), which the guard DOES
  catch, and the absolute forms via `workFolderPath` / `workItemPath` use
  `join(root, 'work', folder, ...)` (split args, never a single literal under any
  text guard). So the absolute-template literal was never a centralisation target.
- The current tree has ZERO such offenders, so the green acceptance gate is
  unaffected today. This is purely about FUTURE regression coverage.
- It is trivially extensible: broaden the anchor to also allow a leading non-`:`
  interpolated path-prefix segment before `work/`.

## Suggested disposition

Keep as a low-priority follow-up. If a human wants belt-and-braces future-proofing,
broaden `buildPathLiteralRegex`'s optional prefix to also match an interpolated
`<prefix>/work/<folder>` body (and add the two cases above to the detector
self-check). Otherwise leave as-is: the repo-relative form is covered and that is
the shape the codebase actually builds.
