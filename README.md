# dorfl

> Claims work atomically off a git ref; status is the folder.

A small TypeScript/Node CLI that discovers, schedules, and runs work across many
repos, both as a guided **human loop** and as an unattended **autonomous runner**,
on top of a file-based `work/` contract and an atomic git-ref claim protocol. It is
built by dogfooding itself: it tracks its own roadmap in its own `work/` tree.

## What it does

Four jobs, one tireless golem: **discover, schedule, claim, run.** Point it at your
repos and it finds the claimable work, picks what is ready, claims each item
atomically so many agents never collide, and drives it through your acceptance gate
— either guiding you step by step, or running unattended in CI. The state lives in
plain markdown files versioned with your code (no database, no dashboard): folders
hold the durable status, git lock refs hold the live one.

## Get started

Adoption is three layers. You only need the later ones when you want the runner; the
contract itself adopts with no global install.

**1. Adopt the contract (a skill) — the front door.** Install the dorfl skills into
your agent, then drive from your agent. Nothing to install globally (the skills go in
via `npx dorfl`), and adopting the contract needs no `dorfl` runtime:

```sh
# install the dorfl skills into your agent (no install needed — run via npx)
npx dorfl skills add
# (or install the CLI once — `npm install -g dorfl` — then `dorfl skills add`)

# then, in your agent:
from-idea   # from scratch: idea → scaffolded work/-contract repo + spec
setup       # existing repo: onboard onto the work/ contract
```

**2. The `work/` contract, versioned with your code.** What adoption scaffolds into
your repo: one markdown file per item, status is the folder it lives in, plus a
`dorfl.json` acceptance gate. This is the durable substrate the CLI later consumes
(see [The `work/` contract](#the-work-contract) below for the full layout).

**3. Execute (the CLI) & CI.** Once the contract is in place, install the runner and
let it consume the pool: `dorfl do` in one repo, `dorfl run` across many, `dorfl
intake` as the issue → spec/task front door in CI:

```sh
# install the runner
npm install -g dorfl

dorfl remote add <repo>   # register a repo to watch
dorfl do                  # pick a ready task in this repo and build it
dorfl run                 # the cross-repo parallel daemon
```

See the [website](https://wighawag.github.io/dorfl/) for the same walkthrough with
more context.

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
