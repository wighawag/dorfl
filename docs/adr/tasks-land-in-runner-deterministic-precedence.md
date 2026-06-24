---
title: tasksLandIn precedence — the positional twin of the untrusted-origin build-propose rule
status: accepted
created: 2026-06-17
decided: 2026-06-17
supersedes:
superseded_by:
---

# ADR: tasksLandIn (the task-placement default) + the fixed staging/pool precedence

> **AMENDMENT (2026-06-24, ADR `rename-task-pool-folder-todo-to-ready`).** The pool
> VALUE spelling was renamed `'todo'` → `'ready'` (a clean break, matching the on-disk
> folder `tasks/ready/` and the brief-side `'ready'` pool value). The precedence SHAPE
> and reasoning below are unchanged; read every `'todo'` value spelling in this ADR as
> `'ready'`.

## Context

The task `runner-deterministic-slice-placement-policy-and-precedence` generalises
the tracer task (`pre-backlog-staging-folder-and-promote-step-a`) — which
hard-coded "tasker output is always staged in `pre-backlog/`" — into a
RUNNER-deterministic decision from unforgeable inputs. The governing ADR
(`placement-is-runner-deterministic-humanonly-is-agent-judgement`) names the
shape (a per-repo placement policy + per-source exceptions resolved via a fixed
precedence chain); this ADR pins the CONCRETE CONFIG KEY + the PRECEDENCE ORDER
the runner uses, so a future reader can see why those choices are correct in the
context of the existing trust precedences.

## Decision

### 1. The config key is `tasksLandIn: 'pre-backlog' | 'todo'`

A per-repo default landing for the tasker's emitted tasks, resolved EXACTLY like
the existing `taskingIntegration`/`integration` precedence:

    flag (`--tasks-land-in`) > env (`DORFL_TASKS_LAND_IN`) > per-repo
      `.dorfl.json` > global config > built-in default (`'pre-backlog'`)

Spelling rationale:

- `tasksLandIn` — same shape as `taskingIntegration` / `prdsLandIn`,
  per-lifecycle, plural ("tasks"), camelCase. The prd-placement caller
  introduces `prdsLandIn` with the IDENTICAL chain (the two are a pair).
- Values are the actual FOLDER NAMES (`pre-backlog` / `todo`), not abstract
  `staging`/`pool` tokens. The folder is the user-visible artifact; making the
  config name the folder keeps the mental model honest. The lifecycle-generic
  resolver (`src/placement.ts`) maps these folder names onto its internal
  `'staging' | 'pool'` side enum, so the prd-placement caller can reuse the
  same resolver with its own folder slots (`pre-proposed` / `ready`).

### 2. The precedence is `explicit > untrusted-origin > configured default > built-in`

The POSITIONAL twin of the existing untrusted-origin build-propose precedence in
`src/integration-core.ts` (task `untrusted-origin-forces-build-propose`):

    explicit --merge  >  untrusted-origin ⇒ propose  >  config mode  >  default

becomes, for placement:

    explicit --tasks-land-in  >  untrusted-origin ⇒ staging  >  tasksLandIn
      default  >  built-in (staging)

Same trust signal (`originTrust:` frontmatter, stamped at intake, propagated by
the tasker), same "explicit-operator beats the trust force" shape — the operator
is present; CLI always wins, no special force-key. The two precedences thus stay
in lockstep: the existing rule resolves MODE (propose vs merge), this rule
resolves POSITION (staging vs pool), reusing one trust principle.

### 3. The built-in floor is STAGING (`pre-backlog`)

Zero behaviour change for a repo that does not set `tasksLandIn`: the tasker
output keeps landing staged. A repo opts
into the trusted-fast-path landing by setting `tasksLandIn: 'todo'`; the
runner-deterministic resolver then overlays the untrusted-origin force on top, so
an untrusted-origin tasking on a `'todo'` repo still lands STAGED. The
conservative floor (`staging`) is the cheap default because a wrongly-staged
task is recoverable (a human promotes it), a wrongly-pooled task is not (an
agent may already have claimed it). It also gives the task and the
prd-placement caller the same floor shape.

## Why this is one ADR, not three

The KEY SPELLING, the PRECEDENCE ORDER, and the BUILT-IN FLOOR are decided
together because each pins the meaning of the other: the spelling says "values
are folder names, not abstract sides", the precedence pins WHO can override
WHICH rung (the operator's flag wins over the trust force), and the floor says
what HAPPENS when nothing is set. A future reader inverting any one of them
would silently change the safety story; one ADR keeps them legible together.

## Considered and rejected

- **A boolean `tasksLandStaged: true/false`.** Rejected — it locks the lifecycle
  to two values forever and would not survive a folder rename (the spelling would
  no longer match the folders). The folder-name enum survives a rename with one
  constant flip.
- **An abstract `tasksLandIn: 'staging' | 'pool'`.** Rejected — it hides the
  folder name from the user (a config inspecting reader has to mentally
  re-resolve `staging` to `pre-backlog`); the folder is the user-visible artifact
  and the config should name it directly.
- **`todo` as the built-in floor (trusted-fast-path default).** Rejected — it
  is the cheap default for ONE repo policy (a fully-trusted single-maintainer
  repo) and the dangerous default for every other (an autonomous tick can claim
  a freshly-emitted task in the same tick). Staging-by-default keeps the
  recovery story symmetric with `autoBuild: false` and the existing untrusted-
  origin force.
- **Layering the resolver INTO the tasking path** (the trivial inline-it path).
  Rejected — the prd names `pre-prd-staging-pool-split-and-untrusted-prd-
  placement` as the next caller, and a future intake variant will reuse the same
  shape. Inlining it would force a refactor to extract it later. The resolver is
  a small pure function whose lifecycle-specific bits (folder slots, default
  key) are PARAMETERS; both callers get one implementation.

## Consequences

- A repo's `.dorfl.json` may carry `tasksLandIn: 'todo'` (the
  trusted-fast-path landing) or `'pre-backlog'` (the staging default); both land
  through the same resolver, with the same untrusted-origin force overlaid.
- The runner-deterministic placement is THE seam (`src/placement.ts`); a future
  precedence change (a new rung, a different floor) touches one pure function,
  and both the task and prd-placement callers inherit it.
- The agent NEVER picks placement: it always writes to the staging folder, the
  runner reads + redirects at integrate-stage time. The governing ADR's
  tamper-proof structural guarantee holds: a misbehaving or compromised
  agent that writes to the pool is scrubbed; the runner's commit only ever
  reflects the resolver's choice.

## Decisions (ratified post-review, the Gate-2 bounce)

The first build of this task was BLOCKED by Gate 2 (and routed to
needs-attention) for a real defect: the resolver + config keys + env coercion
+ direct `performTask` tests were all in, but `config.tasksLandIn` and the
`--tasks-land-in` flag were NEVER threaded from `cli.ts` into the `DoOptions`
the `do prd:` path builds, so the configured-default + explicit-flag rungs were
dead from the shipped binary (a user setting `tasksLandIn: 'todo'` got the
built-in `pre-backlog` floor). The continuation closes that wire and ratifies the
in-scope choices the reviewers asked to pin:

1. **The CLI wire (the fix).** `tasksLandIn: config.tasksLandIn` (and
   `remoteConfig.tasksLandIn`) is threaded at the SAME five `DoOptions`
   construction sites that already carry `taskingIntegration`; a new
   `--tasks-land-in <pre-backlog|todo>` flag contributes `explicitTasksLandIn`
   ONLY when the operator typed it (mirroring `flagMode === 'merge'` =>
   `explicitMerge: true`), so an untrusted-origin staging force still wins when the
   value came from config, not the flag. A bad flag value FAILS LOUDLY
   (`explicitTasksLandInFromFlag`), the same discipline as the
   `--observation-triage` enum + the `DORFL_TASKS_LAND_IN` env coercion.
   A binary-level test (`do prd:` through `buildProgram()` on a `--bare file://`
   arbiter with a stub tasker) proves the configured value + the flag actually
   reach `performTask` end-to-end, not only via the in-process interface.
2. **The pool-placement scrub fence is SILENT by design.** `scrubPoolDrift`
   reverts an agent's write into the pool during tasking (new files
   removed, changed files restored to HEAD) WITHOUT a per-file `note()`. It is a
   structural enforcement of the governing ADR (the agent cannot
   self-place into the pool), not an operator-actionable event: the agent should
   never have written there, so there is nothing for a human to do. Kept silent.
3. **`TaskResult.emitted` reports the RUNNER-RESOLVED destination.** When the
   resolver lands tasks in the pool, `emitted` shows the pool path (not the
   agent's `work/pre-backlog/*.md` staging path), and the agent's staging twin is
   removed when the destination differs. `emitted` honestly describes where the
   files landed; callers reading the task result see the real residence.
