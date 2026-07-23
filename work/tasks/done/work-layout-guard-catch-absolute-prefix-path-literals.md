---
title: 'work-layout guard, catch absolute interpolated-prefix work/ path literals'
slug: work-layout-guard-catch-absolute-prefix-path-literals
blockedBy: []
covers: []
---

## What to build

Broaden the work-layout guard's path-construction matcher so it ALSO flags an
absolute `work/<folder>` path that is reached via a leading interpolated, non-`:`
path-prefix segment (e.g. `${root}/work/tasks/backlog/${slug}.md`,
`${cwd}/work/tasks/done`), in ADDITION to the cases it already catches.

Context (the guard and the gap):

The work-layout guard is a source-scanning invariant test that enforces
CENTRALISATION: no module except the `work-layout` module may hold a raw
`work/<folder>` path literal (so the `work/` tree shape lives in exactly one
place). Its matcher (`buildPathLiteralRegex`) flags a string/template literal
only when its WHOLE content is a `work/<folder>` path, with an OPTIONAL prefix
that MUST END IN `:` (a git-ref like `${ref}:work/tasks/done` or
`${arbiter}/main:work/tasks/backlog`). Folder NAMES are the post-rename NESTED
forms (`tasks/backlog`, `tasks/done`, `briefs/ready`, ...), so the matched body is
`work/tasks/backlog/...`, NOT a flat `work/backlog/...`; a flat `work/backlog/...`
does not match at all because `backlog` is not a folder name. Empirically today:

- `'work/tasks/backlog/${slug}.md'` -> matches (caught)
- `'${ref}:work/tasks/done'` -> matches (caught)
- `'${root}/work/tasks/backlog/${slug}.md'` -> **does NOT match** (missed)
- `'${cwd}/work/tasks/done'` -> **does NOT match** (missed)

So a future regression that re-scatters an ABSOLUTE `work/` path via an
interpolated non-`:` root prefix (`${root}/work/<folder>/...`) would slip past
the guard. This task closes that future-regression hole.

Why this is low-priority (and why the current gate is unaffected):

The centralisation produces the REPO-RELATIVE forms (`workFolderRel` /
`workItemRel` -> `work/<folder>/...`), which the guard ALREADY catches. The
ABSOLUTE forms (`workFolderPath` / `workItemPath`) are built with
`join(root, 'work', folder, ...)` (split arguments, never a single text literal
under any text guard), so the absolute-template literal was never a centralisation
target. The current tree has ZERO such offenders, so the green acceptance gate is
unaffected today. This is PURELY about future-regression coverage; it is the
belt-and-braces extension of an already-shipped guard.

The change (scope):

Broaden the matcher's OPTIONAL prefix so that, in addition to the existing
trailing-`:` git-ref prefix, it also matches a leading interpolated non-`:`
path-prefix segment before `work/` (i.e. `<prefix>/work/<folder>` where `<prefix>`
is e.g. `${root}` or `${cwd}`). Every currently-matched case must STILL match, and
no false positives may be introduced.

## Acceptance criteria

- [ ] The matcher flags `${root}/work/tasks/backlog/${slug}.md` and
      `${cwd}/work/tasks/done` (the two currently-missed absolute-prefix cases, in
      the post-rename NESTED folder-name form), in addition to every form it
      already matches.
- [ ] The detector self-check in the test file is extended with those two cases,
      so the matcher's own coverage is pinned against rot.
- [ ] No regression in the matched set: every case the matcher flags today still
      flags (the repo-relative `work/tasks/backlog/...` / `work/tasks/done/...`
      forms, the `${ref}:work/tasks/...` / `${arbiter}/main:work/tasks/...` git-ref
      forms, the `<slug>.md` template forms).
- [ ] No new false positives: the `work/questions/**` CI-template glob is still
      NOT flagged; the folder-name word-boundary still holds so `work/tasks/done`
      does NOT match inside `work/tasks/done-ish`; and a bare unrelated prefix like
      `${root}/something` (no `work/<folder>` body) is NOT flagged.
- [ ] The guard scan over the real `src/` tree stays GREEN: the broadened matcher
      must not start flagging existing legitimate code (zero offenders today).
- [ ] Tests use the existing test harness and write nothing outside their own
      fixtures (this is a pure-in-memory matcher change plus a `src/`-readonly scan;
      no shared/global location is touched).

## Blocked by

- None. Can start immediately.

## Prompt

> Broaden the work-layout guard's path-construction matcher so it also flags an
> absolute `work/<folder>` path reached via a leading interpolated non-`:`
> path-prefix segment, e.g. `${root}/work/tasks/backlog/${slug}.md` and
> `${cwd}/work/tasks/done`. Today these two return false; they should return true
> after your change. (The folder NAMES are the post-rename NESTED forms such as
> `tasks/backlog` / `tasks/done`, so the body is `work/tasks/backlog/...`, not a
> flat `work/backlog/...`.)
>
> Where to look. The guard is the work-layout guard source-scanning test in the
> dorfl package's test suite (a detector + `src/`-relative scan, the same
> house style as the ledger-lint and flag-cleanup-renames guards). The matcher is
> `buildPathLiteralRegex` (specifically the `refPrefix` / `segment` parts and the
> anchored `^...$` regex it returns. The currently-shipped form is roughly:
> anchored `^...$` regex it returns).
> `refPrefix = (?:[A-Za-z0-9_.$\{\}/-]*:)?` (an OPTIONAL prefix that must end in
> `:`), composed as `^${refPrefix}work/(?:<folderAlt>)(?![A-Za-z-])(?:/(?:<segment>)?)*$`,
> where `<folderAlt>` is the alternation of the NESTED folder names (`tasks/todo`,
> `tasks/backlog`, `tasks/done`, `briefs/ready`, ...).
> The job is to ALSO admit a leading non-`:` interpolated path-prefix segment
> before `work/` (a `<prefix>/` like `${root}/` or `${cwd}/`), while keeping the
> existing `:` git-ref prefix branch.
>
> Constraints / traps to respect:
> - Keep the folder-name word-boundary (`(?![A-Za-z-])`): `work/tasks/done` must
>   NOT match inside `work/tasks/done-ish`.
> - Do NOT flag the `work/questions/**` CI-template glob (it is a deliberate
>   legitimate residual the self-check pins as a non-match).
> - Do NOT flag a bare unrelated prefix with no `work/<folder>` body (e.g.
>   `${root}/something`).
> - The matcher is anchored to the WHOLE literal (`^...$`); keep it so it fires on
>   the whole literal only, not a substring of prose.
>
> Then extend the detector self-check (the `it(...detector self-check...)` block in
> the same test file) by adding `${root}/work/tasks/backlog/${slug}.md` and
> `${cwd}/work/tasks/done` to the SHOULD-flag list, and add `${root}/something` (or
> similar) to the SHOULD-NOT-flag list to pin that a non-`work/` interpolated
> prefix is not over-matched. Use the NESTED folder-name forms that the existing
> self-check already uses (e.g. `work/tasks/backlog/`, `work/tasks/done/${slug}.md`,
> `${arbiter}/main:work/tasks/backlog`); a flat `work/backlog/...` would not match.
>
> Done means: the two new absolute-prefix cases flag, all pre-existing matches and
> non-matches in the self-check still hold, and the `src/` scan over the real tree
> stays green (zero offenders, so the broadened matcher must not start flagging
> existing legitimate code). Run the package build + tests + the format check used
> by the acceptance gate.
>
> FIRST, check this task against current reality (it is a launch snapshot and may
> have DRIFTED): confirm `buildPathLiteralRegex` and the detector self-check still
> live in the work-layout guard test and still have the shape described above. If
> the matcher was already broadened, or the guard was refactored such that this
> premise no longer holds, do NOT build on the stale premise: route the task to
> needs-attention with the discrepancy as the reason. The original observation
> noted ZERO offenders in the tree (verified green at task-authoring time); if that
> has changed, surface it rather than silently absorbing a real offender into a
> matcher change.
>
> RECORD non-obvious in-scope decisions you make while building (e.g. how you
> structure the prefix alternation, whether you keep the `:` and `/`-prefix branches
> separate or fold them). If a choice meets the ADR gate, write an ADR;
> otherwise note it in the done record / PR description.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/<slug>.md work/tasks/done/<slug>.md
```
