---
title: Command surface & user journeys — the coherent two-face model (registry, run/do, human face, adopt=skill/execute=command)
status: accepted
created: 2026-06-05
decided: 2026-06-05
supersedes:
superseded_by:
---

# ADR: command surface & user journeys

> **Forward note (2026-06-19 — `folder-taxonomy-reorg-and-rename`):** vocabulary/skill renames landed after this ADR. Read `to-slices`→**`skills/to-task/`**, `to-prd`→**`skills/to-brief/`**, the verbs `do prd:`/`do slice:`→**`do brief:`/`do task:`**, and the `work/` folders per the new `notes/`/`tasks/`/`briefs/` layout. The journey/command DECISIONS are unchanged; only the names moved.

> **Forward note (2026-06-22 — `code-identifier-slice-prd-to-task-brief-rename`):** the vocabulary cutover above is now complete in prose: read every conceptual `slice` below as **task**, `PRD` as **brief**, and the verb `slicing` as **tasking** (the agent that does it is the **tasker**). §3a's `slice:`/`prd:` namespace prefixes are the user-facing `task:`/`brief:` today; any residual `slice:`/`prd:` strings still in the command CODE are the as-yet-unrenamed identifiers tracked by `code-identifier-slice-prd-to-task-brief-rename`.

> **STATUS: accepted.** A full journey-model design pass (2026-06-05) reconciled a command surface that had grown slice-by-slice into an incoherent set. This ADR is the durable source of truth for the command model; CONTEXT.md "The faces (commands)" is the short glossary view. It **mandates a reconciliation** of the existing command code + the `runner-in-ci` / `auto-slice` PRDs/slices to this model (see "Reconciliation cadence"); those `work/observations/` notes track the drift this ADR deliberately introduces.

## The model in one sentence

Agents claim from file/folder backlogs across many **registered** repos and build them in isolation while a human does other things; a human can also do the same work themselves (in-place, or in parallel worktrees) — host-agnostic, offline-capable, never disturbing a human's working clone.

## Two organizing axes (everything hangs off these)

- **Target:** _the registry_ (all hub mirrors, cross-repo) **vs** _one repo_ (the current checkout, or one `--remote`).
- **Doer:** _agent_ (the full pipeline runs unattended) **vs** _human_ (you build, optionally with your own AI).

These two axes map cleanly onto the storage areas (below) and the command set.

## 1. The registry = the set of hub-mirror folders (no config list)

There is **no `roots` and no `remotes` config field.** The registered set of targets IS the set of hub mirrors on disk under `<workspacesDir>/repos/`.

- **`remote add <url> [--local]`** — register a target → create its hub mirror. `--local` registers a local `--bare` arbiter (offline). The hub mirror's `origin` URL is its self-description (scheme gives transport: `git@`/`https`/ `ssh` ⇒ remote host; `file://` ⇒ local-bare) — **no separate stamp needed.**
- **`remote rm <key|url>`** — delete the mirror. The **only** mirror deleter; `gc` NEVER reaps mirrors (mirrors are precious-ish registry, reconstructible from their origin but not garbage-collected).
- **`remote ls`** — enumerate mirrors + each origin URL/transport.
- **`remote find <folder>`** — discover **`work/`-participating** repos in a folder (reuse `isParticipatingRepo`; only repos with a populated `work/backlog/`), find-skills-style multi-select toggle, `remote add` each chosen.

**Key = `host/org/name`** (today's `encodeRepoKey`, unchanged): collapses ssh/https/scp for one repo onto one mirror (correct), keeps different hosts/projects distinct (no cross-project corruption). **`remote add` guards on the full host/org/name identity:** adding the same project under a _different transport_ (e.g. a `--local` arbiter for a repo already registered remotely) → **error naming the existing transport** (read from the existing mirror's origin URL), unless `--force`. This implements the anti-stranding guard from `work/observations/hub-mirror-key-ignores-transport.md`.

**Replaces/deletes:** `roots` field, `remotes` field, `arbiter init` (→ `remote add --local`), `arbiter status` (→ `status`).

## 2. Storage areas map onto the doer axis (the safety line)

- **Agents' area `~/.agent-runner/`** (config `workspacesDir`) — hub mirrors + **job worktrees**. Used by every AGENT execution (`run`, and `do --remote`).
- **Human area `humanWorktreesDir`** (NEVER under `~/.agent-runner/`) — human worktrees. Used ONLY by `work-on` (the human doing the work). This is the secrets-isolation boundary: a human's `--copy`'d `.env` never lands in an agent context.

**The mapping is exact: human-does-it → human area; agent-does-it → agents' area or in-place.** This is why `do` (agent) never uses the human area.

## 3. The autonomous face — `run` (daemon) and `do` (worker)

A sharp boundary, NOT two flavours of one thing:

- **`run`** — the **cross-repo, parallel daemon**. Scans the whole registry, claims up to `maxParallel` (`perRepoMax` per repo), runs agents **concurrently** in job worktrees (mirror + N worktrees), integrates, **loops forever** (the future system service). Its reason to exist is _cross-repo discovery + concurrency_ — nothing else provides those.
  - **`run --once`** — one tick then stop. A **debug/test affordance** on the daemon (NOT the CI path). Only meaningful because of cross-repo + parallelism; on a single repo with `maxParallel: 1` it degenerates toward `do`.
- **`do`** — the **per-repo, in-place worker**. Claims + builds + gates + integrates in ONE repo, then **exits**. Sequential. This is **the CI command** (CI has a checkout, is one repo, is one triggered invocation, exits) AND a local one-off worker.
  - `do <arg>` — that one named item (see §3a for slug resolution). `do` (no arg) — auto-pick one eligible thing. `do <arg> <arg> …` — those, in sequence. `do -n <x>` — x eligible things, in sequence.
  - **`--propose` (default) / `--merge`.** Propose (PR) is the CI norm.
  - **Isolation strategy by form:** `do <slug>` in a checkout works **in-place** (the checkout / CI container IS the isolation — no mirror). `do --remote <r>` (no checkout) materialises a **hub mirror + job worktree in the agents' area** — the SAME isolation `run` uses (agent execution → agents' area, never the human area).
    - The targeting/isolation surface is really **two orthogonal questions** — WHICH repo (current vs a foreign `--remote`) and, for the current repo, WHERE to build (in the checkout vs in a worktree). So there are three forms, not a binary:

      | form | repo | build location |
      | --- | --- | --- |
      | `do <slug>` | current | in the checkout (in-place; refuses on a dirty tree) |
      | `do --isolated <slug>` | current | a job worktree off THIS repo's arbiter |
      | `do --remote <r> <slug>` | foreign | a job worktree (isolation implied — no checkout exists) |

      `--remote` names the targeting axis (a foreign repo; isolation there is incidental); `--isolated` names the isolation intent (a worktree off my own arbiter) — the affordance an isolated supervised conductor needs without forcing a foreign URL. The two are orthogonal and `--isolated` is purely additive. **Decided 2026-06-08; all three forms ship today.**
  - **Auto-slice priority within a tick:** eligible **slices first, then PRDs to slice** (drain ready work before creating more), with a per-repo toggle to flip it.

CI uses **`do`** AND **`advance`** (wired by the future `install-ci`), never `run --once` — which verb is the §3b routing rule.

## 3b. `do` vs `advance` in CI: `advance` does NOT simplify SELECTION; it adds the LIFECYCLE rungs + the answer-driven trigger

The usual confusion conflates two distinct concerns. The routing rule, recorded so it is not re-derived:

- **"What do I work on?" (SELECTION) — `do` and `advance` are ~equal.** Both auto-pick over the SAME mirror-side eligible-pool scan (`do -n` picks buildable slices + sliceable PRDs; `advance -n` picks over that same pool PLUS observations). For a pure "build whatever is ready on a cron" job they are about the same amount of workflow YAML; **`advance` does NOT reduce selection logic.** A build-only CI cron is well served by `do` alone.
- **The LIFECYCLE — where `advance` earns its place.** `do` knows only two rungs: build a slice, slice a PRD. It structurally CANNOT triage an observation, surface a question to `work/questions/` when an item needs judgement, or apply a human's committed answer and then advance. `advance`'s whole point is "do every autonomous rung, and when you hit judgement, write a question file and STOP" — which is what lets a CI loop drain a POPULATED `work/` tree toward "all ready slices built," the human's only job being to answer question files on their own time. `do` has no question/answer protocol, so it cannot run that loop.
- **The genuine workflow simplification `advance` adds is the TRIGGER + the rung set, NOT the matrix logic.** The shipped CI template (`docs/ci/advance-loop.yml.template`) shows it: (1) an `on: push` touching `work/questions/**` trigger — "a human committed an answer → run a pass to apply it and surface the next batch" — a cadence `do` has no rung for; (2) one dispatch input `integrationMode` drives BOTH the integration flag AND the job shape (`propose` → a MATRIX of independent one-PR-per-item jobs; `merge` → a SINGLE SEQUENTIAL job, because merge-mode items rebase-chain and parallel merge jobs would thrash the main-CAS). NOTE the propose=matrix / merge=sequential discipline is a property of the INTEGRATION MODE, not the verb — `do` could use the identical CI shape.

**The routing rule:** CI is "build ready slices / slice ready PRDs on a cron," human triages/answers locally ⇒ **`do -n` (or `do --remote -n`) is sufficient and simpler** (two rungs, no sidecar machinery). CI should drain a whole populated `work/` tree toward done while a human only answers committed question files (the "human is the clock" north star) ⇒ **`advance`** — the win is the surface/apply rungs + the `on: push work/questions/**` trigger, not the auto-pick. One line: **`advance` doesn't simplify PICKING; it adds the rungs and the answer-driven trigger that let CI advance the LIFECYCLE, not just the build.** (Folded 2026-06-12 from `work/observations/do-vs-advance-in-ci-selection-vs-lifecycle.md`; consistent with the `runner-in-ci` PRD's "two distinct concerns" + "do AND advance both belong in CI" notes and ADR `ci-config-policy-and-gate-family`.)

## 3a. Slug-namespace resolution: a PRD and a slice may share a slug

A PRD and a slice **can have the same slug** (e.g. PRD `auto-slice`). `do` spans both namespaces (build a slice OR slice a PRD), so a bare slug is ambiguous. The rule:

| input | resolves to | on collision (both a slice AND a PRD named `<slug>`) |
| --- | --- | --- |
| `<slug>` (bare) | the **slice** | **ERROR** — "ambiguous; use `slice:<slug>` or `prd:<slug>`" |
| `slice:<slug>` | the slice | always unambiguous |
| `prd:<slug>` | the PRD (slice it) | always unambiguous |

- **Bare `<slug>` is HUMAN CONVENIENCE ONLY.** It resolves to the slice, but ONLY after confirming no PRD shares the slug; on a collision it **errors** (loud, immediate, human-resolvable) — it never silently guesses. (So even the bare path does a cheap cross-namespace existence check.)
- **CI / automation / `install-ci`-generated workflows MUST use explicit prefixes** (`do slice:foo` / `do prd:foo`), NEVER bare — because (a) in CI an ambiguity error halts the job, and (b) a bare slug that works today would silently break when a same-named PRD/slice appears later. Explicit prefixes are collision-proof across time.
- **`do`** accepts all three. **Slice-only commands** (`claim`, `start`, `resume`, `complete`, `prompt`, `requeue`, `work-on`) accept bare (= slice) and `slice:` (explicit alias), and **reject `prd:`** with a clear "operates on slices, not PRDs" error.
- This mirrors a distinction the contract ALREADY makes by field: slice `blockedBy` resolves against slices (`work/done/`), PRD `sliceAfter` against PRDs (residence in `work/prd-sliced/` — the folder is the source of truth for sliced-ness, mirroring `blockedBy` → `done/`). The `slice:`/`prd:` prefixes are the command-line form of that same namespace split — one coherent rule, not two.

## 4. The human face — do work yourself (optionally with your AI)

Two sub-modes, by where the work happens:

- **In-place (takes over the current checkout)** — for when you need the repo's real `.env`/keys to test:
  - **`start <slug>`** — claim (if needed) + switch the current checkout to `work/<slug>`. **`--agent`** also launches the configured harness interactively on the prompt (you still `complete`). The headline "begin work here".
  - **`resume <slug>`** — its own verb: re-engage an already-in-progress item in the current checkout. (`start --resume` kept as a hidden alias for muscle memory; the documented surface is `start` = begin, `resume` = continue.)
  - **`complete [<slug>]`** — gate + done-move + commit + rebase + integrate. `--merge`/`--propose`, `--no-switch`; advanced: `--skip-verify` (human-only escape hatch, loud), `--type`, `--message`.
  - **`claim <slug>`** — low-level CAS only (no onboarding). Advanced/plumbing.
  - **`prompt <slug>`** — emit the agent prompt. Advanced/plumbing.
- **Parallel (isolated worktree, doesn't touch your clone):**
  - **`work-on <slug>` / `work-on --remote <r> <slug>`** — claim + create a worktree in the **human area**, and `cd` you in by default (via the shell wrapper; `--print-dir` is that wrapper's plumbing). Auto-`remote add`s an unregistered `--remote`. `--copy <patterns>` copies named gitignored files (e.g. `.env`) into the worktree (copy, not symlink; `--copy-from` in the remote form). **`--agent`** launches the harness. The human counterpart to `do`.

**Symmetry (the coherence test, and it holds):**

|  | one slice/repo | whole registry |
| --- | --- | --- |
| agent does it | `do` (in-place / `--remote` job worktree) | `run` / `run --once` |
| human does it (parallel) | `work-on` | — |
| human does it (in-place) | `start` (+`--agent`) / `resume` | — |

`do` ↔ `work-on` read as "it does it / I work on it", same target resolution (bare = current repo; `--remote` = anywhere). The human has no cross-repo verb (a human works one thing at a time; the runner is the parallel one). Correct.

## 5. Ops / lifecycle

- **`scan`** — cross-repo backlog queue. **Fetches the truth** (the remote is the source of truth in the registry model); on a failed fetch it falls back to last-known and **warns**. (This DROPS the old "scan is always offline" invariant — that was the roots-local model; superseded here.)
- **`status`** — operational dashboard (running/stuck/cleanup). Fetches. Folds in the old `arbiter status`.
- **`requeue <slug>`** (renamed from `return`) — move `needs-attention/ → backlog/` to retry later. The **defer-don't-finish** verb; its pair is `complete` (fixed it → finish) vs `requeue` (giving up/deferring → back to the queue).
- **`gc`** — reap job WORKTREES via the provable predicate (never mirrors). `--force` (requires `--yes`) discards un-saved work — the one genuinely destructive `--force` in the CLI.
- **`verify`** — run the per-repo acceptance gate standalone.

## 6. Mirror freshness (settled)

Mirrors sync **lazily, on every operation that fetches** — there is no push-triggered or background sync (git has no push notification; a webhook would be host-specific, breaking host-agnosticism). Crucially, **every worktree (agent job, human `work-on`, in-place `start`) is cut from a freshly-fetched `main`** — the fetch is baked into worktree creation, so a worktree is never on stale code. `scan`/`status` fetch-first. Freshness = "as of the last command that fetched"; the claim CAS is the truth for contention at the moment of action.

(The two fetch refspecs are load-bearing and must NOT be "simplified" away: `ensureMirror` does a pruning mirror-fetch on first creation; `fetchMirrorMain` does a main-only fetch on reuse, so it never deletes live worktrees' `work/<slug>` branches.)

## 7. Cleanup deltas (flag/name hygiene applied in this pass)

- **`--by` removed** (claim/start/work-on): the `claimed_by` frontmatter field was removed (git history is the claim ledger); the claimer already shows in the claim commit + git committer identity. Reinstate only if `claimed_by` returns.
- **Readiness override = `--ignore-not-ready` only.** Drop the `--force` _spelling_ on claim/start/work-on (it merely overrides a readiness warning). **`--force` is reserved for the genuinely destructive `gc --force`** — different danger levels must not share a flag name.
- **`return` → `requeue`** (clearer; names the defer action).
- **`resume`** is its own verb; `start --resume` a hidden alias.
- **Advanced/plumbing tier** (kept, de-emphasised in help): `claim`, `prompt`, `verify`, `gc`, `remote rm`, and the flags `--skip-verify`/`--type`/`--message`/ `--copy`/`--print-dir`. **Headline tier:** `run`, `do`, `work-on`, `start`, `complete`, `scan`, `status`, `remote add`/`ls`/`find`.

## 8. The deep principle: adopt = skill, execute = command

A clean line the whole surface is checked against, and a reinforcement of ADR §9 (the `work/` contract + claim protocol is a **runner-agnostic protocol**; `agent-runner` is ONE implementation):

- **Adopting the contract** (set up a repo, migrate from another system, the slicing/PRD methodology) is **protocol-layer → a SKILL** (tool-agnostic; anyone can follow it with zero `agent-runner` installed). This is why `to-slices`, `to-prd`, and `setup` (the single onboarding/migration skill) are SKILLS.
- **Executing work** (claim CAS, the `run` loop, `do`, isolation, integration) is **implementation-layer → a COMMAND.**

Corollary for any future _checking/diagnostic_ tooling (e.g. a possible `doctor`): the **core check must stay harness-agnostic** (the contract surface: `work/` folders, `CONTEXT.md`+name, valid config, a registered arbiter, a runnable gate). **Skill _location/discoverability_ is harness-specific** (pi reads `~/.agents/skills/`; another harness reads elsewhere) → it must be **delegated to the harness adapter via the §5 seam**, never hardcoded. The harness seam is the boundary for ALL harness-specific knowledge, not just agent invocation. (A `doctor` command is NOT decided — see the future-items note; until/unless we add it, clear docs listing required vs recommended skills suffice.)

## Reconciliation cadence (mandated by accepting this ADR)

This ADR deliberately makes the current code + some PRDs/slices drift. Resolve in THREE phases, in order:

1. **Reconcile-the-docs (this pass):** this ADR + the CONTEXT rewrite + reshape the affected PRDs/slices to this model — so the spec is coherent BEFORE building.
2. **Build the new system:** slices implementing the new surface (registry/`remote`, `run`/`do` split, renames, in-place isolation strategy, the deltas).
3. **Reconcile-the-code:** apply the drift check (WORK-CONTRACT "Drift is a needs-attention signal") to confirm existing slices/code match the new code, then resume feature work.

## Consequences

- The surface becomes coherent: one registration model, consistent target resolution (`<slug>` = current repo; `--remote` = anywhere), clean agent/human symmetry, `ar-run.sh` dies into `do`, a single deletion sweep.
- It **invalidates assumptions** in `runner-in-ci` (which assumed CI calls `run --once` against a registered remote — wrong; CI = `do`) and `auto-slice` (the `slice <prd>` command is subsumed by `do <prd>` + the `run`/`do` auto-slice step). These need the phase-1 reshape (tracked as observations).
- Future protocol-layer items (the `setup` onboarding/migration skill) and the uncertain `doctor` command are captured separately, NOT built in this pass.
