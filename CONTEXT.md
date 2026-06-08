# CONTEXT — agent-runner domain language

The domain glossary for `agent-runner`. Agents and skills should use THIS
vocabulary when naming modules, tests, and discussing the system — it is the
shared language. Architectural rationale lives in `docs/adr/` (decisions); product
framing lives in `work/prd/`.

## What agent-runner is

A small TS/Node CLI that discovers, schedules, and runs work across many repos —
both as a guided **human loop** and as an unattended **autonomous runner** — on
top of a file-based `work/` contract and an atomic claim protocol. It is built by
dogfooding itself (it tracks its own work in its own `work/`).

## Core domain terms

- **work/ contract** — the on-disk system this consumes (defined in the
  `to-slices` skill): one markdown file per item, **status = the folder
  it lives in** (never a field). See that skill's `WORK-CONTRACT.md`.
- **slice** — one buildable work item: a tracer-bullet vertical slice, a markdown
  file `work/backlog/<slug>.md`. Has frontmatter: `slug`, `prd`, `humanOnly`
  (usually omitted), `needsAnswers` (usually omitted), `blockedBy`, `covers`.
  (All field names are camelCase — see WORK-CONTRACT.md.)
- **PRD** — a north-star doc in `work/prd/<slug>.md` a slice's `prd:` field points
  at. (The launch/framing doc; may be a hand-off snapshot.) Frontmatter: `slug`,
  `issue` (optional), `humanOnly`/`needsAnswers` (the slicing gate), `sliceAfter`
  (PRD slicing-order). Sliced-ness is RESIDENCE in `work/prd-sliced/` — there is no
  `sliced:` frontmatter marker (it was removed in `remove-sliced-marker-step-b`);
  see *PRD lifecycle* below.
- **ADR** — a decision record in `docs/adr/<slug>.md` (the *why* of OUR technical
  choices; durable). The substrate decisions are in
  `docs/adr/execution-substrate-decisions.md` (§1–§12). Carries a **`status:`**
  frontmatter (`proposed | accepted | superseded`): a **`proposed`** ADR captures
  the *deciding* stage — a VERIFIED problem + options, not yet decided (the step
  between an unverified `observations/` note and an `accepted` decision). Slug-
  named + sectioned (a deliberate house deviation from Matt's sequential
  numbering; see `docs/adr/methodology-and-skills.md` §5a/§5b).
- **capture buckets** — the THREE note-types under `work/` that are NOT work items
  and are **exempt from status=folder** (they don't flow/move; the folder is the
  inbox; they leave only by deletion): **`ideas/`** (proposed, pre-PRD;
  *editable*), **`observations/`** (spotted, unverified signals; *append-only*),
  **`findings/`** (*verified external/domain* ground truth — e.g. a
  reverse-engineered protocol; durable). Distinct from an ADR (what WE decided)
  and from an observation (internal “spotted, unverified” — NOT a finding). See
  WORK-CONTRACT.md.
- **slug** — content-derived, URL-safe id of an item (never a counter).
- **status (lifecycle)** — the folder: `backlog/` (claimable) → `in-progress/`
  (claimed) → `done/` (completed), or → `needs-attention/` (stuck) or
  `out-of-scope/`. Transitions are `git mv`.
- **autonomy gate (two axes)** — TWO orthogonal binary fields on slices AND PRDs
  (both default omitted = false): **`humanOnly`** (the DECIDED axis — *a human
  must drive this regardless of spec completeness*) and **`needsAnswers`** (the
  DISCOVERED axis — *unresolved questions block autonomous progress; the
  questions live in the body*). Orthogonal to lifecycle status. On a PRD they gate
  *slicing*; on a slice they gate *building*. (Supersedes the single-`humanOnly`
  gate, which replaced the three-state `afk` field.)
- **allowAgents policy** (`allowAgents`, per-repo) — *may agents claim undeclared
  items in this repo?* Default `false`; resolved like `integration`: flag
  (`--allow-agents`/`--no-allow-agents`) > per-repo > global > default.
- **blockedBy / eligibility** — an item is **agent-claimable** iff `needsAnswers`
  is not `true` AND `humanOnly` is not `true` AND `allowAgents` is `true`; it is
  **eligible now** iff also every `blockedBy` slug is present in the SAME repo's
  `work/done/`. Deps never cross repos.
- **PRD lifecycle (folders)** — a PRD flows through the SAME folder state machine
  as a slice, minus `done/`: **`work/prd/`** (ready to slice) → **`work/slicing/`**
  (the held LOCK, being sliced) → **`work/prd-sliced/`** (sliced, resting). The
  FOLDER is the SOLE source of truth for sliced-ness, exactly as `done/` is for
  slices (there is no `sliced:` frontmatter marker — it was removed in
  `remove-sliced-marker-step-b`; the release transition records sliced-ness purely
  by moving the PRD into `work/prd-sliced/`).
  Re-slice = `work/prd-sliced/ → work/prd/` (reopen-to-ready, mirroring
  `done/ → backlog/`).
- **sliceAfter** (`sliceAfter`, PRD-only) — PRD slugs that must already be
  **sliced** (resolved against `work/prd-sliced/` residence, mirroring
  `blockedBy` → `done/`) before the auto-slicer may slice this PRD — so its emitted
  slices can reference the real slugs of those PRDs' slices in `blockedBy`. Distinct
  verb/signal from slice `blockedBy` (which gates *building*, against `done/`).
- **needs-attention** — the post-claim **stuck** state (`work/needs-attention/`):
  a claimed item that couldn't finish (red gate, conflict, ambiguity, timeout,
  rejected review). The runner `git mv`s it here with a reason; a human resolves
  and moves it back to `backlog/`. Folder-native surfacing (no labels). (ADR §12.)

## Claim & integration terms

- **arbiter** — the single git remote whose `main` ref serialises claims (GitHub,
  or a local `--bare` repo). Default remote name `origin`.
- **claim (CAS)** — atomically moving an item `backlog → in-progress` by pushing a
  micro-commit to the arbiter's `main` with `--force-with-lease`; the first push
  wins, losers get exit 2 and pick another item. Implemented by `claim.sh`
  (portable bootstrap) and `agent-runner claim` (the in-process version). This
  direct-`main` write is the **current (only) strategy behind the
  ledger-transition seam** (`docs/adr/claim-ledger-vs-protected-main.md`): the
  three `work/` transitions (claim / complete / needs-attention) route through the
  write seam, so a future strategy *could* differ — but today there is one, and it
  writes `main` exactly as described.
- **work branch** — `work/<slug>`, branched off the latest arbiter `main`, where a
  slice is built.
- **integration mode** — how finished work lands: **`propose`** (push a branch +
  request review; the default) or **`merge`** (direct to main, opt-in for
  trusted/low-risk repos). Resolved at integrate-time: flag > per-repo > global >
  `propose`. Never `--force` to main. (ADR §6, §11.)
- **verify (the gate)** — the per-repo acceptance command (`agent-runner verify`,
  e.g. `pnpm -r build && test && format:check`). The deterministic trust boundary:
  authoritative & non-skippable for the autonomous runner; default-on but
  `--skip-verify` for the human `complete`. (ADR §8.)

## Execution-substrate terms

- **job** — one claimed item being processed (there is NO long-lived "agent"
  identity; the unit is the job). (ADR §1.)
- **hub mirror** — one bare mirror per repo under `~/.agent-runner/repos/<key>.git`
  (the shared `repo-mirror` primitive); cheap shared object store.
- **worktree** — a job's isolated working tree off the hub mirror, under
  `~/.agent-runner/work/<work-id>/`, on branch `work/<slug>`. (ADR §2.)
- **human worktree** (`work-on`) — the HUMAN counterpart of a job worktree: an
  isolated worktree off the hub mirror on `work/<slug>`, but checked out under a
  **human-friendly** root (`humanWorktreesDir`, e.g. `~/worktrees/<key>/<slug>/`)
  so a person can edit several slices in parallel. Deliberately NOT under
  `~/.agent-runner/` (the agents' area) — so it never carries a human's secrets
  into an agent context. Two forms (`work-on <slug>` in-repo, `work-on <remote>
  <slug>` anywhere): the ONLY difference is the worktree's LOCATION — both claim
  the slug and branch off the freshly-fetched `<arbiter>/main` (same claim, same
  starting commit). `--copy <patterns>` copies named gitignored files (copy, not
  symlink; `--copy-from` required in the remote form) with a security notice. A
  binary can't `cd` your shell, so it prints the path + a `cd` hint; `--print-dir`
  emits the path only, for a shell wrapper:
  `work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; }`.
- **humanWorktreesDir** — config root for human worktrees, prompted + saved on
  first use (sensible suggestion, no silent default; chosen to NOT share a prefix
  with code dirs so shell tab-completion never collides). Never `~/.agent-runner/`.
- **work-id** — flat, deterministic key for a job:
  `<host-...>__<org>__<name>__<slug>` (the repo key with `.`→`-`, then the slug).
- **repo key** — hierarchical `host/org/name` with `.`→`-` per segment
  (`github-com/wighawag/agent-runner`).
- **deletion predicate** — a job worktree is removed only when its work is
  **provably on the arbiter** (clean tree AND branch tip reachable on the
  arbiter); otherwise retained (a retained worktree is a needs-attention signal).
  `gc` re-applies it. (ADR §4.)
- **harness seam** — pluggable interface for launching a job's agent and reporting
  liveness. Adapters: `null` (shells out to `agentCmd`, PID-only liveness) and
  **`pi`** (invokes the pi CLI with the work-agent prompt; liveness from PID + a
  pointer to the pi session dir/log). Selected via the `harness` config; jobs'
  liveness is resolved per-record to the owning adapter (`resolveHarness`).
  Liveness from the harness, **never filesystem mtime**. (ADR §5.)
- **integration seam** — `Integrator` with modes (`merge`/`propose`) × providers
  (`github` via `gh`, `none` = push + open-manually). Push is the safety-bearing
  action. (ADR §6.)

## The faces (commands) — see `docs/adr/command-surface-and-journeys.md`

Organised by two axes: **target** (the registry / one repo) × **doer** (agent /
human). The full model + rationale is the ADR; this is the glossary view.

- **Registry (what gets watched):** **`remote add <url> [--local]`** (register a
  target → create its hub mirror; `--local` = a `--bare` arbiter), `remote rm`,
  `remote ls`, **`remote find <folder>`** (discover `work/`-participating repos,
  toggle-add). The registered set IS the set of hub mirrors — there is no `roots`
  or `remotes` config field. Key = `host/org/name`; `remote add` guards against
  registering one project under two transports.
- **Autonomous — agent does it:**
  - **`run`** — the cross-repo, **parallel** daemon: scan the registry, claim up
    to `maxParallel`, run agents concurrently in job worktrees, integrate, loop
    forever (future service). **`run --once`** = one tick (debug/test the daemon;
    NOT the CI path).
  - **`do`** — the per-repo, in-place **worker**: claim+build+integrate in ONE
    repo, then exit. `do <slug>` / `do <prd>` (slice it) / `do` (auto-pick) /
    `do <slug>…` / `do -n <x>`; `--propose` (default) / `--merge`. **This is the
    CI command.** In a checkout it works in-place; `do --remote <r>` materialises a
    hub mirror + job worktree in the agents' area.
- **Human — do work yourself (optionally with your AI):**
  - **In-place** (takes over the current checkout, for when you need its real
    `.env`): **`start <slug>`** (claim + switch; `--agent` launches the harness)
    → build → **`complete`** (gate + done-move + integrate). **`resume <slug>`**
    re-engages an in-progress item. `claim`/`prompt` are low-level.
  - **Parallel** (isolated worktree, doesn't touch your clone): **`work-on
    <slug>` / `work-on --remote <r> <slug>`** — claim + worktree in the **human
    area**, `cd`s you in; `--copy` brings gitignored files (e.g. `.env`),
    `--agent` launches the harness. The human counterpart to `do`.
- **Ops:** **`scan`** (cross-repo queue — fetches the truth, warns+falls back
  offline), **`status`** (running/stuck/cleanup dashboard), **`requeue <slug>`**
  (needs-attention → backlog; the defer-don't-finish verb), **`gc`** (reap job
  worktrees, never mirrors), **`verify`** (run the gate standalone).

## Invariants (do not relitigate — see ADRs)

- The **runner owns all git-state transitions**; the build agent only writes code
  and gets the gate green (stated in-band in the agent prompt).
- **Status = folder, never a field** (conflict-safety). One file per item; no
  shared index; content slugs, never counters.
- Conflicts: **rebase-or-abort, never auto-resolve** → needs-attention. (ADR §10.)
- **Storage areas map onto the doer axis:** agent execution → agents' area
  (`~/.agent-runner/`, hub mirrors + job worktrees); a human doing the work →
  human area (`humanWorktreesDir`, never under `~/.agent-runner/`). The
  secrets-isolation boundary. (`command-surface-and-journeys` §2.)
- **adopt = skill, execute = command:** adopting the contract (setup, migrate,
  the slicing/PRD methodology) is protocol-layer (a SKILL, runner-agnostic);
  executing work (claim, `run`, `do`, integration) is implementation-layer (a
  command). Reinforces ADR §9. (`command-surface-and-journeys` §8.)
- **`scan`'s offline guarantee is RETIRED:** in the registry model the remote is
  the source of truth, so `scan`/`status` fetch-first (warn + fall back offline).
  (Supersedes the older roots-local "scan is always offline" framing.)

## Coherence (a first-class quality)

**Consistency and conceptual coherence are a stated quality of this project**, not a
nicety. THIS glossary + the ADRs are the single source of truth for what each term
means. A new flag / config key / status / verb / named concept MUST NOT silently
re-mean an existing term, mean two different things in two places, sit at the wrong
conceptual layer, or duplicate an existing concept under a new name. Before adding a
concept, check it against this glossary + the ADRs + the code; if it conflicts,
re-means, or overlaps, REUSE or RENAME rather than fork (or surface it). This is
enforced by the `review` skill's **conceptual-coherence lens** and the Gate-2 review
prompt, and prevented up-front by the CLAIM-PROTOCOL coherence check. Rationale: a
muddled concept that compiles is far more expensive than the question — every later
artifact that reuses the muddled term inherits the debt (the `autoSlice`-gated-the-
VERB-not-the-SELECTION miss is the worked example;
`work/findings/autoslice-gate-conflates-verb-autonomy-and-review-loop.md`).

## House style

pnpm monorepo (CLI in `packages/agent-runner/`), `type: module`, NodeNext, tsc,
prettier (tabs + single quotes), vitest, `commander`. Tests mirror the `claim.sh`
verification: throwaway git repos + a local `--bare` arbiter. Acceptance gate is
`pnpm -r build && pnpm -r test && pnpm -r format:check` (see `AGENTS.md`).
