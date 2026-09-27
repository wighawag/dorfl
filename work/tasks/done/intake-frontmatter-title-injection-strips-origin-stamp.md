---
title: 'An intake title with a line break can end the frontmatter early and strip the originTrust stamp'
slug: intake-frontmatter-title-injection-strips-origin-stamp
humanOnly: true
blockedBy: []
---

## What to build

`intake` turns an issue into a task or spec document. The decision agent (which reads issue text any GitHub user can write, so it can be prompt-injected) drafts the title, and the lone-task review loop may rewrite it. The runner then renders the document itself: `renderBacklogTask` in `intake.ts` (and the spec renderer next to it) builds the frontmatter as plain lines, starting with `` `title: ${title}` `` unescaped, then `slug`, `issue`, and, when CI passes `--origin-trust`, `origin: issue` and `originTrust: <value>`. The verdict parser accepts any string for the title.

A title such as `Fix it\n---\n` therefore closes the frontmatter before the stamp lines are written. The stamp lands in the body, the item reads as unstamped, and the rule that forces an untrusted-origin item's BUILD to a code PR (ADR `untrusted-origin-carries-via-stamp-not-forced-staging`, ADR `untrusted-origin-build-checkpoint`) no longer applies to it. A title can also inject other frontmatter keys (for example `humanOnly` or `blockedBy`) or a different `slug`.

Make every runner-rendered frontmatter safe against agent-supplied values, on today's single-job path:

- reject (route to the existing `agent-failed` outcome, never a silent emit) a title that is not a single line or contains a control character, and reject an empty title;
- render every agent-supplied scalar YAML-quoted, through one shared helper used by every renderer that puts agent text into frontmatter (find them all: intake task and spec renderers, and any promotion or mint path that writes a title or other agent text into frontmatter, such as the observation promote and ADR mint paths);
- after rendering, re-parse the frontmatter with the same reader dorfl uses elsewhere and assert that `slug`, `issue`, `origin` and `originTrust` equal the values the runner meant to write; fail loudly otherwise.

Task `ci-split-intake` (spec `ci-agent-job-without-write-token`) relies on this helper in its apply phase and is blocked by this task; landing it here first fixes the live path.

## Acceptance criteria

- [ ] A test drives `intake` with a stubbed decision verdict whose title contains `\n---\n` followed by fake keys, with `--origin-trust untrusted`, and asserts the result is `agent-failed` (nothing written, nothing integrated). The test is run against the current code first and shown to fail (the document is emitted and its parsed frontmatter lacks `originTrust`).
- [ ] The same test with a title containing `: `, `#`, quotes or a leading `-` (legal on one line) emits a document whose parsed `title` equals the input and whose `originTrust` is `untrusted`.
- [ ] Every renderer that writes agent-supplied text into frontmatter uses the shared quoting helper; a test covers each one with a hostile single-line title.
- [ ] The post-render re-parse assertion exists and has a test that forces a mismatch.
- [ ] A changeset (patch) explains the hole and the fix.

## Blocked by

- None. Can start immediately, and should land before the tasks of spec `ci-agent-job-without-write-token`.

## Prompt

> Goal: close a frontmatter injection in dorfl's intake renderer. The intake decision agent's title is written unescaped into YAML frontmatter by `renderBacklogTask` (and the spec renderer) in `packages/dorfl/src/intake.ts`, before the `origin` / `originTrust` stamp lines, so a title with a line break and `---` ends the frontmatter early and strips the stamp that forces an untrusted-origin item's build to a PR. Read the verdict parser in the same file (it accepts any string for titles), the frontmatter reader in `frontmatter.ts`, and search `packages/dorfl/src` for every other place that writes agent-supplied text into frontmatter (promotion of observations, ADR minting, tasking). Add one shared helper that quotes a YAML scalar, use it everywhere, reject multi-line or control-character titles at the verdict boundary (map to the existing `agent-failed` outcome), and re-parse each rendered document to assert the runner-owned keys. Write the tests first and report the red run. Tests follow the style of `packages/dorfl/test/intake.test.ts` (stubbed verdicts, temporary bare-repo arbiters with `GIT_CONFIG_GLOBAL=/dev/null`). Add a patch changeset under `.changeset/`. Background: spec `work/specs/tasked/ci-agent-job-without-write-token.md`, with its decisions in ADR `docs/adr/ci-agent-job-holds-no-write-token.md` (and task `ci-split-intake`). This task is `humanOnly` because it is a security fix.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does `renderBacklogTask` still interpolate the title unescaped? If not, route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not). Do no git.

## Decisions

- **Always quote, single-quoted style.** Every agent-supplied title is written as `'...'`, even when it would be safe unquoted. Why: one form is simple to audit, it is valid YAML for every one-line string, and the repo's own frontmatter already uses it. Alternatives: quote only when needed (keeps old output byte-for-byte but relies on judging YAML's plain-scalar rules correctly), or double quotes (dorfl's readers don't decode backslash escapes, so titles with `"` or `\` would not read back exactly). Touches: the output of intake task/spec, ADR mint and promote (a user-visible format change), and the exact-output tests updated above.
- **The readers now decode `''` to `'`.** This applies to the frontmatter reader's unquoting and the two `title:` readers in `tasking.ts` and `integration-core.ts`. Why: with single quotes, a title like `Don't` would otherwise come back as `Don''t` in commit subjects and PR titles. Touches `readFrontmatterField` and every `parseFrontmatter` field read from a single-quoted value; nothing previously written relied on a literal `''`.
- **Rejecting at the verdict boundary.** For intake, only the title the outcome will actually render is checked (`taskTitle` for `task`, `specTitle` for `spec`). A missing title is still allowed (it falls back to the slug); an empty or whitespace-only one is rejected. "Control character" means C0, DEL, the C1 range (including NEL) and U+2028/U+2029, which is a bit wider than `ci-handoff-format.ts`'s single-line check (that one doesn't cover C1). A failed render/re-check after the verdict also maps to `agent-failed`, since the bad input came from the agent. The renderer's own throw stays as a backstop.
- **New refusals on two other commands.**
  - **ADR mint:** `mintAdr` returns `usage-error` for a multi-line or control-character ADR title. It could instead have collapsed whitespace; I refused so nothing is silently rewritten, and the observation stays for a retry.
  - **Promotion:** `promoteObservation` returns `usage-error` when the finished document doesn't have exactly one `slug:` and one `promotedFrom:` with the runner's values (for example, an agent-drafted body that repeats `slug:`). The alternative was to strip duplicates before stamping. I refused because the task asks to "fail loudly".
  - **What they touch:** the `advance` apply path's mint-adr and mint-task/spec outcomes.
- **The promote title is quoted even though it is a sanitised slug.** Why: every runner-written title has the same shape. It also changes the bytes of promoted tasks and specs.
