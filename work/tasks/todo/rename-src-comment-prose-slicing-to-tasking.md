---
title: Sweep slice/PRD/slicing free-prose comments + user-facing strings in src/ to task/brief/tasking
slug: rename-src-comment-prose-slicing-to-tasking
brief: code-identifier-slice-prd-to-task-brief-rename
blockedBy: [rename-slicing-modules-and-symbols-to-tasking]
covers: []
---

> **CARVED OUT 2026-06-23 (decided conductor + human, during the `drive-tasks` drive — split of `rename-slicing-modules-and-symbols-to-tasking`).** The parent task bundled the file/symbol RENAMES (a clean, mergeable, green unit) with a BROAD, judgement-heavy sweep of free-prose doc comments + user-facing message strings across ~9 large modules (~480 lines). Gate-2 blocked the parent THREE times purely on this prose residue while the renames themselves were green. This task is the carved-out prose sweep. It deliberately does NOT block the protocol-doc / protocol-prose tasks (`rename-protocol-doc-slicing-to-tasking`, `rename-protocol-prose-and-skills-slicing-to-tasking`) — those depend only on the parent's module/symbol renames, which land with the parent.

## What to build

Sweep the retired slice/PRD/slicing/slicer vocabulary out of FREE-PROSE doc comments and USER-FACING message/help strings across `packages/agent-runner/src/*.ts`, replacing with task/brief/tasking where the word denotes the CURRENT concept. This is the prose residue left after the parent task's mechanical file+symbol renames.

Known high-residue modules (counts approximate, AFTER excluding the allowed-keep categories below): `do.ts` (~120 lines incl. outcome comments "the PRD was sliced", "the slicing gate refused", "stale slicing"), `ledger-read.ts` (~57: "PRD-existence read", "once SLICED it rests at", "the slicing lock no longer moves it"), `review-gate.ts` (~49: the review-PROMPT builder STRINGS fed to the review agent — "AGAINST the slice that specified them", "CROSS-SLICE", "code-vs-its-slice", "review of one slice"), `select-priority.ts` (~40), `prompt.ts` (~40), `close-job.ts` (~42: "a lone slice closes its own issue", "prd:<slug> slices"), `scan.ts` (~38), `item-lock.ts` (~21), `mirror-pool-scan.ts` (~15), plus the `cli.ts` USER-FACING `--help` strings the parent left (e.g. "auto-build undeclared … slices", "run one agent on a slice prompt", "claim a slice", "the slug to work on (bare = the slice)", "default drain = slices-first then PRDs-to-slice").

## KEEP verbatim (do NOT rename — these are NOT concept prose)

- **Immutable slugs** of OTHER tasks/briefs/observations: e.g. `slice-acceptance-gate`, `slicer-review-edit-loop`, `auto-slice`, `runner-deterministic-slice-placement-policy-and-precedence`, `remove-sliced-marker-step-b`, `claim-cas-spinner`, and any historical slug referenced as provenance.
- **The intake per-emitted-type `{slice, prd}` wire vocabulary** (`IntakeArtifactType`, the `sliceSlug`/`sliceTitle`/`sliceBody`/`prdSlug`/`prdTitle` draft fields, the `--merge-slice`/`--propose-slice` flag VALUES) — governed by brief Decision 2 (intake `{slice,prd}`→`{task,brief}`), owned by the config-keys lineage, NOT this prose task.
- **The `slicerLoop`/`slicerLoopMax`/`slicerLoopModel` CONFIG KEYS** — a separate deferred code-key rename; keep the key spelling, only fix surrounding free prose.
- **`.slice(` array-method calls** (a JS builtin, unrelated).
- **The `LONE_SLICE_REVIEW_MAX_ROUNDS` / `dispatchSlice` symbols** if still so named at task time.

Where a comment describes a PAST state (e.g. "originally `work/slicing/`"), keep the historical term and optionally note the current name in parentheses — do not falsify history.

## Acceptance criteria

- [ ] No FREE-PROSE doc comment or user-facing message/help string in `packages/agent-runner/src/*.ts` uses slice/PRD/slicing/slicer for a CURRENT concept; the keep-verbatim categories above are preserved (and, where a kept token sits in otherwise-renamed prose, left intact).
- [ ] The `cli.ts` `--help`/usage strings read task/brief/tasking consistently (a user running `agent-runner do --help` / `--help` sees no stray "slices"/"PRDs" for the current concepts).
- [ ] No symbol, type, filename, config key, or wire-field is renamed here (those are owned by the parent + the config/CLI tasks); this is a PROSE-only sweep.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` stays green (run `pnpm format` after editing).
- [ ] Any doc-consistency test asserting touched prose is updated in this task; suite green.

## Blocked by

- `rename-slicing-modules-and-symbols-to-tasking` — this sweeps the comment prose in the modules that task renames; it must follow so the symbol/filenames are already settled.

## Prompt

> Goal: finish the src/ vocabulary cutover by sweeping FREE-PROSE comments + user-facing strings slice/PRD/slicing → task/brief/tasking, per brief `code-identifier-slice-prd-to-task-brief-rename`. PROSE ONLY — rename no code identifier.
>
> FIRST check reality: the parent module/symbol rename has landed; confirm the symbols/filenames are already in their tasking names. Grep each module for `slic`/`prd`/`PRD`. For EACH hit decide: current-concept prose (rename) vs an allowed-keep (immutable foreign slug / intake `{slice,prd}` wire field / `slicerLoop*` config key / `.slice(` call / historical past-state). Apply REVIEW-PROTOCOL lens 4: a second instance of a pattern means generalise the fix across ALL modules, do not fix-one-and-stop. Self-verify to zero before finishing.
>
> Where to look: `do.ts`, `ledger-read.ts`, `review-gate.ts`, `select-priority.ts`, `prompt.ts`, `close-job.ts`, `scan.ts`, `item-lock.ts`, `mirror-pool-scan.ts`, and the `cli.ts` `--help` strings — plus any other `src/*.ts` with residue. Run `pnpm format` after editing.
>
> Done = build/test/format:check green, no current-concept slice/PRD/slicing prose left in src comments/strings (allowed-keep categories preserved), behaviour unchanged.

---

### Claiming this task

```sh
agent-runner claim rename-src-comment-prose-slicing-to-tasking --arbiter <remote>
git fetch <remote> && git switch -c work/rename-src-comment-prose-slicing-to-tasking <remote>/main
git mv work/tasks/todo/rename-src-comment-prose-slicing-to-tasking.md work/tasks/done/rename-src-comment-prose-slicing-to-tasking.md
```
