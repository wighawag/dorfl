# The `work/` on-disk contract

This is the shared contract between the **slices** skill (producer) and the **lifecycle** skill (consumer). It is designed to be **conflict-safe for parallel AFK agents**. Every rule below exists to avoid merge conflicts and lost updates.

## Location

`work/` lives **inside the target project repo**, versioned with that repo's code (the same place the `tasks/` convention uses today). Slices reference that repo's code; AFK work happens in clones/worktrees of that repo.

## Layout — two categories: WORK ITEMS (status = folder) + CAPTURE BUCKETS (notes)

```
work/
  # ---- WORK ITEMS: DURABLE status IS the folder; they FLOW via `git mv` on `main` ----
  # PRD lifecycle (staging → pool → sliced):
  pre-prd/<slug>.md        # STAGING: a PRD not yet admitted to the auto-slice pool
                           #   (untrusted/agent-authored output lands here; a human promotes)
  prd/<slug>.md            # the AUTO-SLICE POOL: PRDs eligible to be sliced
  prd-sliced/<slug>.md     # SLICED, resting PRDs — the PRD `done/` analogue; the
                           #   SOURCE OF TRUTH for sliced-ness (see note below)
  # Slice lifecycle (staging → pool → terminal):
  pre-backlog/<slug>.md    # STAGING: a slice not yet admitted to the agent pool
                           #   (review-first / untrusted output lands here; a human promotes)
  backlog/<slug>.md        # the AGENT POOL: sliced, grabbable items eligible to claim
  done/<slug>.md           # completed (moved here durably on `main` at integration)
  dropped/<slug>.md        # durable "won't-proceed" records (lightweight ADR);
                           #   generic terminal — the REASON
                           #   (out-of-scope / superseded by <x> / duplicate /
                           #   abandoned) lives in the item body as `reason:`

  # ---- TRANSIENT STATUS + LOCKS: NOT on `main` — on per-item lock refs ----
  # `in-progress` (claimed/building), `needs-attention` (stuck), `slicing` (a PRD
  # being sliced), and `advancing` (a tick holding an item) are NO LONGER `main`
  # folders. They collapse into ONE per-item lock on a hidden
  # `refs/agent-runner/lock/<type>-<slug>` ref (ADR `ledger-status-on-per-item-lock-refs`):
  # a two-axis entry `action: implement|slice|advance` × `state: active|stuck`
  # (+ holder/since, reason iff stuck). `in-progress` = lock held active for
  # implement; `needs-attention` = lock held stuck. A human reads in-flight state via
  # `agent-runner status`/`scan` (which read the lock refs), NOT by `ls`-ing a folder.

  # ---- CAPTURE BUCKETS: NOT status-governed; they do NOT flow/move ----
  ideas/<slug>.md          # proposed, pre-PRD ideas — EDITABLE, deletable
  observations/<slug>.md   # spotted, unverified signals — APPEND-ONLY, deletable
  findings/<slug>.md       # VERIFIED external/domain ground truth — durable
```

> **`backlog/` is the agent POOL today; `pre-backlog/` is its STAGING pre-pool (position-gate STEP-A, landed). A later, separate rename (`folder-taxonomy-reorg-and-rename`, STEP-B) will rename `backlog → todo` and `pre-backlog → backlog` — a pure constants/`git mv` flip with no behaviour change. Until that lands, read "the pool" as `backlog/`.**

### Two governance regimes + the substrate split (the key distinctions)

- **Work items' DURABLE positions are the folder** (`pre-prd`/`prd`/`prd-sliced`; `pre-backlog`/`backlog`/`done`/`dropped`): **status = the folder**, transitions are `git mv` on `main`, each has one destiny. This is the conflict-safe core for the durable resting records. The ONLY moves ever made on `main` are these durable resting transitions: `backlog → done`, `prd → prd-sliced`, `backlog → dropped`. `dropped/` is the generic terminal that GENERALISES the previous `out-of-scope/`: an item that will not proceed for ANY reason (superseded, out-of-scope, duplicate, abandoned/obsolete) rests there with the REASON in the body (`reason:` line).
- **Transient status + locks are NOT on `main`** — they are per-item lock refs (ADR `ledger-status-on-per-item-lock-refs`). `in-progress`/`needs-attention`/`slicing`/`advancing` are lock-ref state, not folders. A work branch cut from `main` therefore inherits NO transient status (this dissolved the old rename/rename rebase-conflict class and retired the `drop-bookkeeping-rebase` machinery). Eligibility/dependency resolution stay OFFLINE on `main` (`blockedBy → done/`, `sliceAfter → prd-sliced/`); only the operational "what's in flight" view (`status`/`scan`) reads the lock refs.
- **Capture buckets** (`ideas`/`observations`/`findings`) are **NOT work items** and are **exempt from status = folder** — they are _notes_, not units of work. They do not move through statuses; they sit in their bucket, and the folder is the inbox (`ls work/observations/` = the live signal list). They leave only by **deletion** (git history is the archive). A note may _spawn_ work (a slice, an idea, an ADR) created independently — the note does not "become" or `git mv` into that work; it is simply deleted once it is no longer a useful signal. **Operational discharge test for a promoted note:** a note is dischargeable (deletable) the moment a **self-contained** artifact carries its signal — verify the spawned slice/ADR actually contains the mechanism + fix shape (not just a back-pointer), then delete the note. Do NOT keep it until the spawned work lands in `done/`: "delete once the slice lands" is itself the resolved-but-kept contradiction (the note stops being a live _signal_ the moment it is captured into actionable work, not when that work completes). If the spawned artifact is NOT self-contained, the bug is the artifact (fix it to carry the signal), not a reason to keep the note.

> **Every capture-bucket note and every work item has a DIRECTION and a LIVENESS — never manufacture a backward artifact to look compliant.** Forward artifacts — a `backlog/` slice, an _open_ `observations/` signal — describe work that is **pending or currently-signalled**, never the past. So: work that is **already done** does NOT get a slice or observation back-filled to narrate it (a backlog slice with pre-ticked acceptance criteria is a changelog wearing a spec's shape); completed work is recorded as a `done/` record landed _with_ the code plus the commit message, owned by whoever does the git transition. And a captured note is LIVE: it leaves the inbox **by deletion** the moment it stops being a live signal — a note annotated "resolved" and kept is a contradiction (there is no `resolved` status; discharge it by deleting it, its lasting product being the slice/ADR/commit it spawned). This binds an agent invoked **outside** the runner too: building directly is fine when asked, but do not retroactively mint forward artifacts for it afterward.

### The three capture buckets (different by polarity + mutability)

| Bucket | What | Mutability | Leaves by |
| --- | --- | --- | --- |
| `ideas/` | a _proposed_, pre-PRD opportunity ("we might want to build this") | **editable** (refine the proposal in place) | deletion (when built/abandoned) |
| `observations/` | an _observed, unverified_ signal ("I noticed something maybe wrong") | **append-only** (add `## Update` notes; don't rewrite what was seen) | deletion (when no longer a useful signal) |
| `findings/` | _verified external/domain_ ground truth (a reverse-engineered protocol, an external API's real behaviour) | accumulates; durable | rarely — it is reference knowledge |

> **`findings/` is for EXTERNAL/DOMAIN ground truth, NOT internal post-mortems.** A finding is durable knowledge about a _world the software integrates with_ (e.g. a Bluetooth/hardware protocol we reverse-engineered, a third-party API's undocumented behaviour) — it accumulates, it does not "resolve". An _internal_ investigation (why a test flakes, a perf regression) is NOT a finding: it is a transient `observations/` signal that drives a fix slice and/or an ADR. **ADRs — the durable _why_ of OUR technical decisions — live in `docs/adr/`** (format: `ADR-FORMAT.md`, alongside this contract), never in `work/findings/`. So: observation = "spotted, unverified"; finding = "verified external ground truth"; ADR = "what WE decided and why".
>
> **Every finding MUST carry a `source:` (provenance) — how, and how _currently_, the finding came to be believed.** A finding is only as true as the source it was derived from, so the source is what makes it _correctable_: if the source is later shown wrong (or stale), the finding can be revised and you can trace _why_ it was believed. There is deliberately **no separate `confidence:` field** — a bare confidence label is redundant at best and misleading at worst ("doc- verified" sounds authoritative until you learn the doc was last touched ten years ago). The honest signal lives IN a rich `source:` string: state _what_ the source is AND _how current_ it is, specifically enough that a reader can judge its weight themselves. Examples (weakest → strongest, by their own description):
>
> - `"derived from reading packages/rocketh-verifier/src/etherscan.ts @ <commit>"` — weakest: it assumes our code is correct, so the finding inherits any bug in it. (A code-derived finding describes the _external behaviour our code assumes_, NOT our code's internal shape — that is `CONTEXT.md`/`docs/`.)
> - `"Etherscan API docs, retrieved 2026-06-09"` — a dated external authority (the date is what stops it silently going stale).
> - `"captured live API response 2026-06-09, trace in <path>"` — strongest.
> - `"told by maintainer @alice, 2026-06"` / `"inferred from the test asserting it at <path>"` — whatever it actually was; write it plainly.
>
> Put `source:` in the finding's frontmatter (see below) and, when the provenance is non-obvious, expand on it in the body. A finding without a source is an `observations/` signal, not a finding.

**For work items, DURABLE status is the folder a file lives in — never a frontmatter field.** Finishing / dropping / slicing-complete = moving the file between durable folders with `git mv` on `main`. This is what makes concurrent durable updates safe: two agents moving _different_ files never conflict. (Transient status — claimed/stuck/being-sliced — is NOT a folder move; it is a per-item lock ref, see above. Capture buckets are exempt too.)

### The PRD lifecycle: `prd/` (pool) → `prd-sliced/` on `main`; the slicing HOLD is a lock ref

A PRD rests in `work/prd/` (the auto-slice pool) and, when sliced, moves durably to `work/prd-sliced/` on `main`. The **folder is the source of truth for sliced-ness**, exactly as `work/done/` is for slices (and as `done/` carries no `done:` marker). Re-slicing a reshaped PRD is `work/prd-sliced/ → work/prd/` (reopen-to-ready, mirroring `done/ → backlog/`).

**The slicing HOLD is a per-item lock, NOT a `work/slicing/` folder.** Slicing a PRD acquires the unified per-item lock with `action: slice` on `refs/agent-runner/lock/prd-<slug>` (ADR `ledger-status-on-per-item-lock-refs`) — a create-only ref push that is self-arbitrating (winner creates it; a concurrent slicer loses the same CAS definitively, no retry budget), so a PRD is never double-sliced. The PRD body STAYS in `work/prd/` while held (it does not move to a `slicing/` folder). On a **successful slice** the release performs the durable `work/prd/ → work/prd-sliced/` move on `main` in the SAME runner-owned commit that emits the backlog slices, then releases the lock. On an **aborted / unclear** slice the lock is released with no `main` move (the PRD already rests in `prd/`), or the lock is marked `stuck` for a human.

- **Sliced-ness is RESIDENCE in `work/prd-sliced/` — the FOLDER, the SOLE signal.** There is no `sliced:` frontmatter marker (it was removed in `remove-sliced-marker-step-b`); the folder is canonical. A PRD whose lock is held `action: slice` is _being sliced right now_; a PRD in `prd-sliced/` _has been sliced_; a PRD in `prd/` is _to-slice_.
- **Edit a PRD when its slice-lock is NOT held.** While the slice lock is held the PRD is mid-slicing; edit it before slicing starts or after it lands (in `prd/` or `prd-sliced/`), not while the lock is held. (A human on a stale local checkout won't see the durable `git mv` until they fetch — the protocol guarantees no _silent corruption_, not no _human surprise_.)
- **Release fails loud on a concurrent edit (never a silent stale slice).** If the held PRD body was edited while the lock was held, the release detects it (the held content no longer matches the snapshot the lock took) and FAILS LOUD: the slicing is stale → re-slice from the edited PRD or mark the lock stuck. The release NEVER force-restores over the edit or emits slices cut from a stale snapshot.
- **The human path needs no lock.** A human slicing locally with no agent running has no contention and may slice on `main` directly — the lock is mandatory for the agent, optional for the human (parallel to "the runner never skips verify; the human may").

### `needs-attention` — the post-claim "stuck" state (the lock `state: stuck`)

An item that was claimed and _attempted_ but could not complete is marked **stuck on its per-item lock** instead of reaching `done/`. This is the single home for every "couldn't finish, a human must look" outcome — a failed acceptance gate (red tests), a rebase/merge conflict, a slice the agent found too ambiguous to build, a timeout, or a rejected review. It is NOT a `main` folder move: the bounce is a CAS amend of the held lock entry `active → stuck` (+ the reason and any agent-surfaced questions on the entry), with NO `main` write. The item's body never moves (it rests in `backlog/`, since claim no longer relocates it).

- **Who marks it:** the runner/human that owns the lock transitions — NOT the build agent (which never touches the lock ref). On a stuck job the runner amends the lock to `state: stuck` with the reason/questions, and SAVES the recoverable work as a wip commit on the kept `work/<slug>` branch (pushed to the arbiter so it travels cross-machine).
- **Not claimable:** a stuck item's lock is held, so it is not claimable (the create-only acquire loses); it IS surfaced — `agent-runner status`/`scan` read the lock refs and list held (in-progress) + stuck (needs-attention) items with their reasons (this is the "look here" set). `done` on `main` and a `stuck` lock may legitimately CO-EXIST (a rebase-conflict bounce of a just-completed item) without corruption.
- **Resolve / return path:** a human resolves the cause then either `resume`s the lock (`stuck → active`, pick the work up again) or `requeue`s it (`stuck → released`; the item is already resting in the pool `backlog/`, so there is no folder bounce). A stuck/orphaned lock is nameable and clearable via `release-lock <item>` (+ a stuck-lock report in `gc --ledger`); there is no liveness heartbeat and no auto-sweep (a human asserts a lock is dead).
- This is a _post-claim_ state. (A separate _pre-claim_ "not ready" state is the STAGING folder `pre-backlog/` — the position gate — not this.)
- **Branch self-conflicts are gone by construction.** Because NO transient status lands on `main` (a bounce is a lock amend, not a `git mv`), a work branch cut from `main` inherits no `needs-attention`/`slicing`/`advancing` markers, so a continue/rebase is a PLAIN rebase with nothing to drop. The old `drop-bookkeeping-rebase` machinery (and its `Agent-Runner-Bookkeeping: route-to-needs-attention` trailer) existed ONLY to mitigate the inherited-marker rename/rename conflicts that on-`main` transient moves created; it was DELETED once those moves left `main` (ADR `ledger-status-on-per-item-lock-refs`). A genuine content conflict between two real lines of development still aborts → the item is marked stuck.

### Drift is a needs-attention signal (check the doc against reality first)

A PRD and a slice are **launch snapshots** — they capture intent at creation and are deliberately NOT kept in sync (current truth lives in `docs/adr/` + the code in `done/`). So by the time you act on one, it MAY have **drifted**: a dependency landed differently than the doc assumed, an ADR superseded a decision the doc relies on, a sibling slice changed the seam it builds against. (Real example: the `watch` slice predated the ledger-transition seam and still described the old direct-`main` failure-surfacing.)

**Discipline (applies whenever you investigate / slice / claim / build):** before acting, **check the doc against reality** — the code in `done/`, the relevant ADRs, and sibling slices it depends on. If you find a discrepancy that would make you build/slice against a false premise, that is a **needs-attention candidate — do NOT silently proceed on the stale spec.** Route it per the item's kind:

- **A SLICE that contradicts current reality** → route to `needs-attention/` with the discrepancy as the reason (the same mechanism as a red gate), rather than building on a stale assumption. A human reconciles the slice, then returns it to `backlog/`. (Building on a stale slice produces wrong-but-compiling work — the worst outcome.)
- **A PRD that has drifted** (before slicing) → do NOT slice it as-is. Set `needsAnswers: true` on the PRD with the discrepancy in its body (or, if it is a small factual correction you are certain of, fix the PRD first), so the slicer never emits slices from a stale spec. A human reconciles, clears the flag, then it is sliced.

The rule is symmetric: _a discrepancy between a doc and reality is not something to paper over — it is exactly the "a human must look" signal `needs-attention` (slices) / `needsAnswers` (PRDs) exists to carry._ Cheap to honour, and it stops drift from silently propagating into built work.

## Conflict-safety rules (non-negotiable)

1. **One file per item.** Never put two work items in one file. Disjoint files merge trivially.
2. **No shared index / manifest.** Do not maintain a `work/INDEX.md`, `work/list.json`, or any file every item touches — it is a guaranteed conflict point. Derive lists on demand with `ls work/backlog/` / `grep`. (Same reasoning as the existing `tasks/README`: "no hand-maintained index — it just goes stale".)
3. **Status = location, not a field.** See above.
4. **Content-derived slugs, never counters.** Use a URL-safe slug from the title (e.g. "Historical store schema" → `historical-store-schema`). NO monotonic integer IDs — two agents would both grab "next = 43". A short hash or date prefix is fine if disambiguation is needed (`historical-store-schema` or `2026-06-03-historical-store-schema`).
5. **Dependencies by slug, read-only.** `blockedBy: [other-slug]` references other items; an item never writes another item's file. The blocker owns its own status (its folder).
6. **Claim state is the per-item LOCK, never a frontmatter field (and no longer a folder move).** Claiming an item acquires its per-item lock (`refs/agent-runner/lock/<type>-<slug>`, `action: implement`) — a create-only ref push that is self-arbitrating (the loser is definitively told "lost", no retry budget); the body STAYS in `backlog/` (claim writes nothing to `main`, so an agent can claim even on a protected `main`). The holder/since ride the lock entry; `git` (the ref + its parentless commit) holds the authoritative record. There is NO `claimed_by` / `claimed_at` frontmatter, and no `git mv` into an `in-progress/` folder — the claimable predicate is "in the pool `backlog/` on `main` AND no lock held on its ref".

## Slice quality rule — tests must not touch the real environment

A slice that makes code **write to a SHARED / GLOBAL location** — a real home/config dir, a system path, a shared service, or an **external tool's managed store** (e.g. another agent's session directory) — MUST, as an acceptance criterion, have its **tests ISOLATE that location** (point it at a temp/scratch dir via the relevant env var or config knob) **AND assert the real one is UNTOUCHED after the run**. State the _mechanism_, not just the outcome: name the env/config lever and note WHERE the path is resolved (in-process vs in a child), because that determines whether overriding a child's env is enough or the test process's own `process.env` must be set.

This is the generalisation of the git-config isolation tests already do (`GIT_CONFIG_GLOBAL=/dev/null`): the same discipline for ANY shared write target. It exists because a slice that _moves_ a write into a shared location (e.g. “write sessions to the tool's default dir instead of the worktree”) silently turns previously-isolated tests into ones that pollute — and a malformed fixture in a shared store can crash unrelated tools that read it. (Real incident: session-log test fixtures leaked into a real `~/.pi/agent/sessions/` and crashed a dashboard; see that repo's `work/findings/pi-session-contract.md`.) Corollary: a synthetic fixture written into any store an external tool reads MUST be VALID per that tool's contract (capture the contract as a `findings/` doc).

## Field-naming convention

All frontmatter and config field names are **camelCase** (`humanOnly`, `needsAnswers`, `blockedBy`, `sliceAfter`, `autoBuild`) — matching the JSON config and the TypeScript that parses them (1:1 property mapping, no snake↔camel translation layer). No exceptions.

## Frontmatter (YAML)

### Slice frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store-schema
prd: historical-store # slug of the work/prd/<slug>.md this slice derives from. REQUIRED iff `covers` is set; OMIT for a self-contained chore/refactor (covers: []).
humanOnly: true # gate axis 1 (DECIDED): a human must drive this. true | omitted. MOST OMIT IT.
needsAnswers: true # gate axis 2 (DISCOVERED): open questions block autonomous work. true | omitted.
blockedBy: [] # list of slugs that must reach done/ first; [] = startable now
covers: [] # optional: user-story numbers (within `prd`) this slice covers
---
```

### PRD frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store
issue: 123 # optional: the issue this PRD was spawned from (the surviving thread)
humanOnly: true # optional: a human must drive the SLICING of this PRD. true | omitted.
needsAnswers: true # optional: open questions block AUTO-slicing this PRD. true | omitted.
sliceAfter: [] # optional: PRD slugs that must be SLICED first (see below). [] = sliceable now.
# sliced-ness has NO frontmatter marker: it is RESIDENCE in work/prd-sliced/ (the release transition moves the PRD there).
---
```

### Finding frontmatter

A finding (`work/findings/<slug>.md`) is a capture-bucket note (no status flow), but it MUST declare its **provenance** so it stays correctable (see the findings box above):

```yaml
---
title: Human Readable Title
slug: etherscan-verification-api
source: 'derived from packages/rocketh-verifier/src/etherscan.ts @ <commit>' # REQUIRED: what the source is AND how current (a date for external sources). Be specific & honest — there is NO separate confidence field; the source string carries the weight.
---
```

- `source` is **required** — a finding without it is an `observations/` signal, not a finding. State it specifically (a file+commit, a doc URL, a captured trace), so a later "the source was wrong" can revise the finding traceably.
- A **code-derived** finding describes the _external behaviour our code assumes_, never our code's internal architecture (that is `CONTEXT.md` / a `docs/` overview). If you find yourself describing our own package layout, it is not a finding.

### The two autonomy axes: `humanOnly` (decided) × `needsAnswers` (discovered)

The autonomy gate is TWO orthogonal binary fields (both default to omitted = false), present on BOTH slices and PRDs, plus the repo's `autoBuild` policy (see `docs/adr/methodology-and-skills.md` §4, authoritative):

- **`humanOnly: true` — the DECIDED axis (DE-OVERLOADED — see below).** _Should a human drive this, regardless of how complete the spec is?_ A product/design/security/judgement call, or an `AGENTS.md`-type rule. Driven by a decision (in the PRD conversation, or the slicer's own judgement). On a PRD it means "a human must drive the slicing" (UNCHANGED — no folder substitute); on a SLICE it is now NARROWED to the rare "never-for-agents BY NATURE" guard (secrets/release/security) that **survives even when the slice resides in the agent pool `work/backlog/`**. Slice `humanOnly` is NOT the tool for ordinary "a human should review this before the agent builds it" — that job belongs to POSITION (the runner births the slice STAGED in `work/pre-backlog/`; a human promotes the approved ones into the pool `work/backlog/`). See "Slice `humanOnly` is NARROW" below.
- **`needsAnswers: true` — the DISCOVERED axis.** _Are there unresolved questions blocking autonomous progress?_ The spec is incomplete; **the open questions live in the body**. Once answered, the flag is cleared and an agent may proceed.
- They are **orthogonal** — four honest states. e.g. `humanOnly:true, needsAnswers:false` = fully specified but a human must own it; `humanOnly:false, needsAnswers:true` = anyone can do it once the questions are answered.
- **Repo policy `autoBuild`** answers the question the _repo_ owns: _may agents auto-build undeclared items here?_ The build member of the symmetric per-action gate family (`autoBuild`/`autoSlice`/`observationTriage`; the triage gate's old boolean name `autoTriage` is now the 3-state `observationTriage`). Per-repo config key (`.agent-runner.json`), resolved like `integration`: \*\*CLI flag (`--auto-build` / `--no-auto-build`)
  > env (`AGENT_RUNNER_AUTO_BUILD`) > per-repo config > global config > built-in default (`false`)\*\*. (Renamed from the old name `allowAgents`, now fully removed with no alias since there are no external users owed a migration window.)

**Predicate (same shape at both levels):** an item is **auto-eligible** iff `needsAnswers` is not `true` AND `humanOnly` is not `true` AND `autoBuild` is `true`. A human is never bound by it (a human may slice/build a flagged item — the gate binds the agent, like the runner-vs-human stance on `verify`).

(This supersedes the older single `humanOnly`-only gate, which itself replaced the three-state `afk` field + `allowUnspecifiedGate`.)

### Slice `humanOnly` is NARROW — POSITION carries "review-first"; `humanOnly` carries "never-by-nature"

Three orthogonal axes, each meaning EXACTLY one thing (governing ADR `placement-is-runner-deterministic-humanonly-is-agent-judgement`):

- **POSITION (folder, runner-deterministic, STRUCTURAL).** Whether a slice is in the agent POOL (`work/backlog/`) or in STAGING (`work/pre-backlog/`) is computed by the runner from unforgeable inputs (the `originTrust` stamp, the per-repo placement policy, explicit operator flags). "A human should review this before an agent acts on it" is encoded HERE — the slice is BIRTHED in `work/pre-backlog/` (not eligible) and a human promotes the approved ones into `work/backlog/`. The agent CREATES only in the staging folder; the runner OWNS every move + promotion.
- **NATURE (`humanOnly`, agent/human judgement, ADVISORY).** Slice `humanOnly: true` means "an agent must NEVER auto-take this BY NATURE" — the rare hard case (release/secrets/security/AGENTS.md-rule) that **survives even when the slice resides in the pool `work/backlog/`**. The autonomy gate predicate above is exactly this: a `humanOnly: true` slice is never agent-claimable, even from `work/backlog/`. PRD `humanOnly` is UNCHANGED (gates auto-slicing; no folder substitute, because the slicer's input is a single PRD — it must be flagged in-band).
- **DISCOVERED (`needsAnswers`, agent judgement, ADVISORY).** Unchanged.

Consequences for the slicer heuristic (the `to-slices` skill / the slicer review loop):

- For the COMMON "a human should review this slice first" case, the slicer does NOT stamp `humanOnly: true` — it lets the runner birth the slice STAGED in `work/pre-backlog/` (the position carries the review-first signal). Stamping `humanOnly` for review was the overloaded reading and is RETIRED.
- The slicer flags `humanOnly: true` on a slice ONLY when building THAT slice is genuinely never-for-agents-by-nature (release pipeline, secrets handling, hard security boundaries, AGENTS.md prohibitions). If in doubt, leave `humanOnly` off and rely on the position — a human can always refuse to promote.

### Three honest integration modes for slicer output (`do prd:<slug>`)

The slicer-output integration combines `--propose`/`--merge` with the `slicesLandIn` placement default into three explicit, named modes (no new flag; the three modes are the existing combinations made explicit):

| Mode | How to invoke | What lands where | When to use |
| --- | --- | --- | --- |
| **`--propose`** (PR path) | `do prd:<slug> --propose` (or the configured default) | A work branch pushed; a PR opened against `main`. Slices land in the PR's tree (typically `work/pre-backlog/`); review is the PR diff. | A repo with a host (GitHub, …) and a PR-based review culture. Code/implementation review ALWAYS uses this path — a diff cannot be folder-gated (PRD US #9). |
| **`--merge` + land-in-staging** (PR-free review) | `do prd:<slug> --merge` with `slicesLandIn: pre-backlog` (or `--slices-land-in pre-backlog`) | Slices land DURABLY on `main` under `work/pre-backlog/` (the staging folder, NOT eligible). A human promotes the approved ones `work/pre-backlog/ → work/backlog/`. | A bare / no-host / protected-`main` repo that still wants human review of ledger-file output. Review is a LEDGER POSITION a human moves, not an out-of-band PR. |
| **`--merge` + land-in-pool** (trusted no-review fast path) | `do prd:<slug> --merge` with `slicesLandIn: backlog` (or `--slices-land-in backlog`) and a trusted origin | Slices land on `main` directly in the agent POOL `work/backlog/` — immediately eligible for `do` / auto-pick. | A trusted, fast-iteration repo where the slicer's output is trusted to enter the pool without ledger-position review. The runner-deterministic placement precedence still forces STAGING for an untrusted origin (`untrusted-origin-forces-build-propose` style). |

Key rules:

- **Placement is runner-deterministic.** WHICH folder a slice lands in is the runner's CALL from the `originTrust` stamp + `slicesLandIn` config + an explicit `--slices-land-in` flag (precedence: explicit-flag > untrusted-forces-staging > configured default > built-in staging). The agent never sets it.
- **Code/implementation review is unchanged** — it stays on the branch/PR path (a code diff cannot be folder-gated). The position gate above is SCOPED to LEDGER-FILE output (slicing); the existing branch-based build review is unaffected.
- **`humanOnly` survives every mode.** A `humanOnly: true` slice in the pool is still not agent-claimable — the position gate and the `humanOnly` gate are orthogonal.

### `sliceAfter` — PRD slicing-order (enforced against `work/prd-sliced/`, NOT `done/`)

`sliceAfter: [other-prd]` on a PRD is **distinct from** slice `blockedBy`, and deliberately named differently because it gates a different verb against a different signal:

- **slice `blockedBy`** gates **building** a slice, resolved against `done/`.
- **PRD `sliceAfter`** gates **slicing** a PRD, resolved against `work/prd-sliced/` residence (i.e. the listed PRDs must already be sliced — reside in `work/prd-sliced/` — so this PRD's emitted slices can reference the real slugs of those PRDs' slices in their `blockedBy`). This mirrors `blockedBy` → `done/` exactly: ordering resolves against folder residence, not a frontmatter marker.

It waits on **sliced-ness (`work/prd-sliced/`), not `done/`** on purpose: the reason B waits for A is that B's slices need A's slugs to _exist_, which happens the moment A is sliced — not when A is fully built. Build-ordering between A's and B's actual work is then expressed where it belongs, in B's individual slices' `blockedBy` (against `done/`). Enforced for the auto-slicer (it skips a PRD whose `sliceAfter` PRDs do not yet reside in `work/prd-sliced/`); a human may slice anyway.

### The `prd` link (required _when `covers` is set_)

`prd` names the source document this slice was sliced from — the slug of a `work/prd/<slug>.md` in the same repo. Its load-bearing job is to make `covers` unambiguous: `covers: [4]` means nothing without knowing _which_ PRD's story 4. So the requirement tracks that job:

- **`prd` is REQUIRED iff `covers` is non-empty.** Any slice that points into PRD user stories MUST name the PRD those numbers belong to (a slice spanning multiple PRDs names its primary one in `prd` and references the others in prose).
- **`prd` MAY be omitted for a self-contained slice** — a refactor, chore, build fix, or dependency bump that derives from no PRD and covers no user stories (`covers: []`). Such a slice MUST instead carry a clear, standalone _What to build_ + _Prompt_ (it is its own source of truth). This is **in contract** — not all work is feature work; only _feature_ work flows from a PRD.

(Consequence, by design: a PRD-less chore slice is part of no PRD's completion set — the `issue-to-prd` "PRD complete?" query counts only `prd:<slug>` slices — which is correct, since a chore is not part of any feature's traceability.)

The body uses [slice-template.md](slice-template.md): What to build (end-to-end), Acceptance criteria (checkboxes), Blocked by (prose mirror of frontmatter), and a **Prompt** section — a self-contained instruction block that can be pasted into a fresh agent context (the existing `tasks/` convention), so an AFK agent needs nothing but the file to start.
