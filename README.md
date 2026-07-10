# dorfl

> Claims work atomically off a git ref; status is the folder.

A small TypeScript/Node CLI that discovers, schedules, and runs work across many
repos, both as a guided **human loop** and as an unattended **autonomous runner**,
on top of a file-based `work/` contract and an atomic git-ref claim protocol. It is
built by dogfooding itself: it tracks its own roadmap in its own `work/` tree.

## The idea in one breath

- **Status is the folder, never a field.** Every work item is one markdown file, and
  the folder it lives in IS its status (`tasks/ready/` = claimable, `tasks/done/` =
  finished). No shared index, no counters, content-derived slugs only. This is what
  makes the whole thing conflict-safe for many agents working in parallel.
- **Claims are atomic.** Acquiring an item is a create-only `--force-with-lease` push
  of a per-item lock ref (`refs/dorfl/lock/<entry>`). The first push wins; the
  losers pick another item. The claim writes nothing to `main`.
- **The runner owns every git-state transition.** A build agent only writes code and
  gets the acceptance gate green; claim, done-move, and integration are the runner's
  job.
- **Conflicts are never auto-resolved.** Integration rebases or aborts to a
  needs-attention state for a human.

## The `work/` contract

`work/` lives inside each target repo, versioned with its code. It is grouped into
three governance regimes plus two standalone top-level surfaces:

```
work/
  notes/         # CAPTURE buckets (do NOT flow; leave by deletion)
    ideas/         # proposed, pre-spec ideas
    observations/  # spotted, unverified signals (append-only)
    findings/      # verified external/domain ground truth
  tasks/         # the BUILD board (status = folder)
    backlog/       # staging (not yet admitted to the agent pool)
    ready/         # the AGENT POOL: claimable items
    done/          # completed
    cancelled/     # the task regime's won't-proceed terminal
  specs/          # the SPEC lifecycle (status = folder)
    proposed/      # staging (pre-promotion)
    ready/         # the auto-task pool
    tasked/        # tasked, resting (source of truth for tasked-ness)
    dropped/       # the spec regime's won't-proceed terminal
  questions/     # the "what needs me?" queue a human answers (top-level)
  protocol/      # the contract docs (WORK-CONTRACT.md, CLAIM-PROTOCOL.md, ...)
```

The authoritative contract is `work/protocol/WORK-CONTRACT.md`; the domain glossary
is `CONTEXT.md`; architectural rationale lives in `docs/adr/`.

## Commands at a glance

Organised by two axes: **target** (the registry vs one repo) and **doer** (agent vs
human). See `docs/adr/command-surface-and-journeys.md` for the full model.

- **Registry:** `remote add` / `rm` / `ls` / `find` register the repos to watch (each
  becomes a hub mirror).
- **Autonomous (agent does it):** `run` (the cross-repo parallel daemon),
  `do` (the per-repo, in-place worker, and the CI command).
- **Human (do it yourself):** `start` / `complete` (in-place, takes over the current
  checkout), `work-on` (claim into an isolated worktree and `cd` in), `resume`.
- **Ops:** `scan`, `status`, `requeue`, `gc`, `verify`.

## Layout

A pnpm monorepo:

- `packages/dorfl/` — the CLI (`type: module`, NodeNext, tsc, vitest,
  commander).
- `website/` — the Dorfl landing site (Dorfl is the product name for this tool).
- `skills/` — the dorfl skills, authored here; `~/.agents/skills/*` symlink
  into them.
- `docs/adr/` — architecture decision records.

## Develop

```sh
pnpm install
pnpm -r build          # build the CLI + site
pnpm -r test           # run the suite (vitest, throwaway git repos + a local --bare arbiter)
pnpm format            # prettier --write .
```

## Acceptance gate

A task is done-eligible (equivalent to `dorfl verify`) when this is green:

```sh
pnpm format:check && pnpm -r build && pnpm -r test
```

Note `format:check` is a ROOT-only script, so it is `pnpm format:check`, not
`pnpm -r format:check`.
