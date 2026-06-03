---
title: scan — cross-repo eligible-work queue (read-only)
slug: scan
prd: agent-runner
afk: false
blocked_by: [scaffold]
covers: [1, 2, 3, 4, 9]
created: 2026-06-03
claimed_by: wighawag
claimed_at: 2026-06-03T11:53:56Z
---

## What to build

The `agent-runner scan` command: a read-only, end-to-end pass that prints the
cross-repo queue of work items and whether each is runnable now. No claiming, no
execution.

A thin path through every layer:

- **Config** — load an optional `~/.config/agent-runner/config.json` (and/or a
  path passed by flag), merged over built-in defaults so that zero config still
  works (defaults make the tool usable out of the box). Honour `roots`,
  `include`, `exclude`, `allowUnspecifiedGate`.
- **Detection** — walk each configured root and find **participating repos**: a
  repo participates iff it has a `work/backlog/` dir containing >= 1 `.md`. Prune
  `node_modules` and dotdirs while walking. `include`/`exclude` override
  detection.
- **Frontmatter parsing** — for each `work/backlog/*.md`, parse YAML frontmatter
  to extract `slug`, the `afk` gate (true/false/unspecified), and `blocked_by`.
- **Eligibility** — resolve, per item: does it pass the **AFK gate** (`afk: true`
  ⇒ yes; `afk: false` ⇒ no; unspecified ⇒ depends on `allowUnspecifiedGate`) AND
  are all `blocked_by` slugs present in that repo's `work/done/`? Eligibility is
  per-repo; deps never cross repos.
- **Output** — print the queue clearly, grouped by repo, showing per item: repo,
  slug, afk gate, blocked-by satisfaction, and whether it is eligible now.

This is increment A from the PRD and the smallest useful first slice. It forces
the config/detection/eligibility design to be concrete before any agent executes.

## Acceptance criteria

- [ ] `agent-runner scan` runs with zero config and prints a sensible queue.
- [ ] A repo with a non-empty `work/backlog/` is detected; one without is not.
- [ ] `node_modules` and dotdirs are pruned during the root walk.
- [ ] `include`/`exclude` config overrides detection.
- [ ] Per item, the AFK gate resolves correctly for afk true / false / unspecified
      against both `allowUnspecifiedGate` settings.
- [ ] An item is eligible only when its gate passes AND every `blocked_by` slug is
      present in that repo's `work/done/`.
- [ ] Output shows, per item: repo, slug, afk gate, blocked-by status, eligible?
- [ ] The deterministic core (config-merge, detection, eligibility, frontmatter
      parsing) is unit-tested with vitest against fixture directory trees.

## Blocked by

- `scaffold` — needs the monorepo skeleton (CLI package, tsc/vitest toolchain)
  in place before any command can be built.

## Prompt

> Build the `scan` command for `agent-runner` (this repo, a pnpm monorepo;
> CLI package at `packages/agent-runner/`). `scan` is **read-only**: it discovers
> participating repos across configured roots and lists which `work/` items are
> runnable now. It claims and runs nothing.
>
> Domain vocabulary (see the `to-slices` skill's `WORK-CONTRACT.md`,
> which this consumes): **status is the folder** (`work/backlog|in-progress|done/`),
> one `.md` file per item, content-derived **slug** IDs, `blocked_by: [slug]`
> dependencies resolved against the SAME repo's `work/done/`, and the **`afk`**
> gate (boolean, omittable: `true` claimable unattended, `false` never, omitted
> ⇒ runner policy via `allowUnspecifiedGate`).
>
> A repo **participates** iff it has a `work/backlog/` with >= 1 `.md`. Walk the
> configured `roots`, pruning `node_modules` and dotdirs; `include`/`exclude`
> override. Config lives at `~/.config/agent-runner/config.json` and is merged
> over defaults so zero-config works.
>
> Eligibility (for display only here) = AFK gate passes AND every `blocked_by`
> slug is in that repo's `work/done/`.
>
> Test the deterministic core first (TDD, vitest in `test/`): config-merge,
> repo detection, frontmatter parsing, eligibility resolution — against fixture
> directory trees. The CLI surface uses `commander`. Match the repo house style
> (scaffolded from `template-typescript-lib`: NodeNext, tabs + single quotes,
> `type: module`). "Done" = the acceptance criteria above are met and tests pass.
