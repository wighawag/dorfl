# The `work/` on-disk contract

This is the shared contract between the **to-task** skill (producer) and the **lifecycle** skill (consumer). It is designed to be **conflict-safe for parallel AFK agents**. Every rule below exists to avoid merge conflicts and lost updates.

## Location

`work/` lives **inside the target project repo**, versioned with that repo's code (the same place the `tasks/` convention uses today). Tasks reference that repo's code; AFK work happens in clones/worktrees of that repo.

## Layout — three REGIME umbrellas: notes/ (capture) + tasks/ (build) + briefs/ (brief lifecycle), plus questions/ + protocol/

The top level groups every tree by its GOVERNANCE REGIME, so a reader can tell what a folder MEANS without reading further: `notes/` are capture buckets (do not flow), `tasks/` is the build board (status = folder), `briefs/` is the brief lifecycle (status = folder), and `questions/` + `protocol/` are standalone top-level surfaces.

```
work/
  # ---- notes/ — CAPTURE BUCKETS: NOT status-governed; they do NOT flow/move ----
  notes/
    ideas/<slug>.md        # proposed, pre-brief ideas — EDITABLE, deletable
    observations/<slug>.md # spotted, unverified signals — APPEND-ONLY, deletable
    findings/<slug>.md     # VERIFIED external/domain ground truth — durable

  # ---- tasks/ — the BUILD board: DURABLE status IS the folder; FLOW via `git mv` on `main` ----
  # Task lifecycle (staging → pool → terminal):
  tasks/
    backlog/<slug>.md      # STAGING: a task not yet admitted to the agent pool
                           #   (review-first / untrusted output lands here; a human promotes)
    todo/<slug>.md         # the AGENT POOL: built tasks, grabbable items eligible to claim
    done/<slug>.md         # completed (moved here durably on `main` at integration)
    cancelled/<slug>.md    # the task regime's "won't-proceed" terminal (lightweight ADR);
                           #   the REASON (out-of-scope / superseded by <x> / duplicate /
                           #   abandoned) lives in the item body as `reason:`

  # ---- briefs/ — the BRIEF lifecycle: DURABLE status IS the folder; FLOW via `git mv` on `main` ----
  # Brief lifecycle (staging → pool → tasked / terminal):
  briefs/
    proposed/<slug>.md     # STAGING: a brief not yet admitted to the auto-slice pool
                           #   (untrusted/agent-authored output lands here; a human promotes)
    ready/<slug>.md        # the AUTO-SLICE POOL: briefs eligible to be sliced into tasks
    tasked/<slug>.md       # SLICED, resting briefs — the brief `done/` analogue; the
                           #   SOURCE OF TRUTH for tasked-ness (see note below)
    dropped/<slug>.md      # the brief regime's "won't-proceed" terminal (REASON in the body)

  # ---- questions/ — the "what needs me?" queue, kept TOP-LEVEL (NOT under notes/) ----
  questions/<slug>.md      # surfaced blockers a human must look at — glance-able top-level

  # ---- protocol/ — the propagated protocol docs (kept byte-identical to the source) ----
  protocol/                # WORK-CONTRACT.md, CLAIM-PROTOCOL.md, the templates, VERSION

  # ---- TRANSIENT STATUS + LOCKS: NOT on `main` — on per-item lock refs ----
  # `in-progress` (claimed/building), `needs-attention` (stuck), `slicing` (a brief
  # being sliced), and `advancing` (a tick holding an item) are NOT `main` folders.
  # They collapse into ONE per-item lock on a hidden
  # `refs/agent-runner/lock/<type>-<slug>` ref (ADR `ledger-status-on-per-item-lock-refs`):
  # a two-axis entry `action: implement|slice|advance` × `state: active|stuck`
  # (+ holder/since, reason iff stuck). `in-progress` = lock held active for
  # implement; `needs-attention` = lock held stuck. A human reads in-flight state via
  # `agent-runner status`/`scan` (which read the lock refs), NOT by `ls`-ing a folder.
```

> **The two won't-proceed terminals use DIFFERENT words ON PURPOSE — `tasks/cancelled/` vs `briefs/dropped/` — and it is a CORRECTNESS fix, not taste.** A task and a brief can share a slug, and a single shared bare-slug terminal (`work/dropped/<slug>.md`) would COLLIDE a dropped task and a dropped brief on the same path. Namespacing each regime's terminal under its own umbrella (`tasks/cancelled/<slug>.md`, `briefs/dropped/<slug>.md`) gives each its own slug space, so the collision cannot happen. A dropped OBSERVATION needs no terminal — notes leave by deletion. (Every reader keys by `(umbrella, slug)`, never a bare slug, so `tasks/todo/foo.md` and `briefs/ready/foo.md` legitimately co-exist.)

### Three governance regimes + the substrate split (the key distinctions)

- **Work items' DURABLE positions are the folder** (briefs: `briefs/proposed`/`briefs/ready`/`briefs/tasked`/`briefs/dropped`; tasks: `tasks/backlog`/`tasks/todo`/`tasks/done`/`tasks/cancelled`): **status = the folder**, transitions are `git mv` on `main`, each has one destiny. This is the conflict-safe core for the durable resting records. The ONLY moves ever made on `main` are these durable resting transitions: `tasks/todo → tasks/done`, `briefs/ready → briefs/tasked`, `tasks/todo → tasks/cancelled` (and `briefs/ready → briefs/dropped`). The per-regime terminals (`tasks/cancelled/`, `briefs/dropped/`) are where an item that will not proceed for ANY reason (superseded, out-of-scope, duplicate, abandoned/obsolete) rests, with the REASON in the body (`reason:` line). They are deliberately NAMED differently per regime — see the slug-collision note above.
- **Transient status + locks are NOT on `main`** — they are per-item lock refs (ADR `ledger-status-on-per-item-lock-refs`). `in-progress`/`needs-attention`/`slicing`/`advancing` are lock-ref state, not folders. A work branch cut from `main` therefore inherits NO transient status (this dissolved the old rename/rename rebase-conflict class and retired the `drop-bookkeeping-rebase` machinery). Eligibility/dependency resolution stay OFFLINE on `main` (`blockedBy → tasks/done/`, `briefAfter → briefs/tasked/`); only the operational "what's in flight" view (`status`/`scan`) reads the lock refs.
- **Capture buckets** (`notes/ideas`/`notes/observations`/`notes/findings`) are **NOT work items** and are **exempt from status = folder** — they are _notes_, not units of work. They do not move through statuses; they sit in their bucket, and the folder is the inbox (`ls work/notes/observations/` = the live signal list). They leave only by **deletion** (git history is the archive). A note may _spawn_ work (a task, an idea, an ADR) created independently — the note does not "become" or `git mv` into that work; it is simply deleted once it is no longer a useful signal. **Operational discharge test for a promoted note:** a note is dischargeable (deletable) the moment a **self-contained** artifact carries its signal — verify the spawned task/ADR actually contains the mechanism + fix shape (not just a back-pointer), then delete the note. Do NOT keep it until the spawned work lands in `tasks/done/`: "delete once the task lands" is itself the resolved-but-kept contradiction (the note stops being a live _signal_ the moment it is captured into actionable work, not when that work completes). If the spawned artifact is NOT self-contained, the bug is the artifact (fix it to carry the signal), not a reason to keep the note.

> **Every capture-bucket note and every work item has a DIRECTION and a LIVENESS — never manufacture a backward artifact to look compliant.** Forward artifacts — a `tasks/todo/` task, an _open_ `notes/observations/` signal — describe work that is **pending or currently-signalled**, never the past. So: work that is **already done** does NOT get a task or observation back-filled to narrate it (a `tasks/todo/` task with pre-ticked acceptance criteria is a changelog wearing a spec's shape); completed work is recorded as a `tasks/done/` record landed _with_ the code plus the commit message, owned by whoever does the git transition. And a captured note is LIVE: it leaves the inbox **by deletion** the moment it stops being a live signal — a note annotated "resolved" and kept is a contradiction (there is no `resolved` status; discharge it by deleting it, its lasting product being the task/ADR/commit it spawned). This binds an agent invoked **outside** the runner too: building directly is fine when asked, but do not retroactively mint forward artifacts for it afterward.

### The three capture buckets (different by polarity + mutability)

| Bucket | What | Mutability | Leaves by |
| --- | --- | --- | --- |
| `notes/ideas/` | a _proposed_, pre-brief opportunity ("we might want to build this") | **editable** (refine the proposal in place) | deletion (when built/abandoned) |
| `notes/observations/` | an _observed, unverified_ signal ("I noticed something maybe wrong") | **append-only** (add `## Update` notes; don't rewrite what was seen) | deletion (when no longer a useful signal) |
| `notes/findings/` | _verified external/domain_ ground truth (a reverse-engineered protocol, an external API's real behaviour) | accumulates; durable | rarely — it is reference knowledge |

> **`findings/` is for EXTERNAL/DOMAIN ground truth, NOT internal post-mortems.** A finding is durable knowledge about a _world the software integrates with_ (e.g. a Bluetooth/hardware protocol we reverse-engineered, a third-party API's undocumented behaviour) — it accumulates, it does not "resolve". An _internal_ investigation (why a test flakes, a perf regression) is NOT a finding: it is a transient `notes/observations/` signal that drives a fix task and/or an ADR. **ADRs — the durable _why_ of OUR technical decisions — live in `docs/adr/`** (format: `ADR-FORMAT.md`, alongside this contract), never in `work/notes/findings/`. So: observation = "spotted, unverified"; finding = "verified external ground truth"; ADR = "what WE decided and why".
>
> **Every finding MUST carry a `source:` (provenance) — how, and how _currently_, the finding came to be believed.** A finding is only as true as the source it was derived from, so the source is what makes it _correctable_: if the source is later shown wrong (or stale), the finding can be revised and you can trace _why_ it was believed. There is deliberately **no separate `confidence:` field** — a bare confidence label is redundant at best and misleading at worst ("doc- verified" sounds authoritative until you learn the doc was last touched ten years ago). The honest signal lives IN a rich `source:` string: state _what_ the source is AND _how current_ it is, specifically enough that a reader can judge its weight themselves. Examples (weakest → strongest, by their own description):
>
> - `"derived from reading packages/rocketh-verifier/src/etherscan.ts @ <commit>"` — weakest: it assumes our code is correct, so the finding inherits any bug in it. (A code-derived finding describes the _external behaviour our code assumes_, NOT our code's internal shape — that is `CONTEXT.md`/`docs/`.)
> - `"Etherscan API docs, retrieved 2026-06-09"` — a dated external authority (the date is what stops it silently going stale).
> - `"captured live API response 2026-06-09, trace in <path>"` — strongest.
> - `"told by maintainer @alice, 2026-06"` / `"inferred from the test asserting it at <path>"` — whatever it actually was; write it plainly.
>
> Put `source:` in the finding's frontmatter (see below) and, when the provenance is non-obvious, expand on it in the body. A finding without a source is a `notes/observations/` signal, not a finding.

**For work items, DURABLE status is the folder a file lives in — never a frontmatter field.** Finishing / dropping / tasking-complete = moving the file between durable folders with `git mv` on `main`. This is what makes concurrent durable updates safe: two agents moving _different_ files never conflict. (Transient status — claimed/stuck/being-sliced — is NOT a folder move; it is a per-item lock ref, see above. Capture buckets are exempt too.)

### The brief lifecycle: `briefs/ready/` (pool) → `briefs/tasked/` on `main`; the slicing HOLD is a lock ref

A brief rests in `work/briefs/ready/` (the auto-slice pool) and, when sliced into tasks, moves durably to `work/briefs/tasked/` on `main`. The **folder is the source of truth for tasked-ness**, exactly as `work/tasks/done/` is for tasks (and as `tasks/done/` carries no `done:` marker). Re-slicing a reshaped brief is `work/briefs/tasked/ → work/briefs/ready/` (reopen-to-ready, mirroring `tasks/done/ → tasks/todo/`).

**The slicing HOLD is a per-item lock, NOT a `work/slicing/` folder.** Slicing a brief acquires the unified per-item lock with `action: slice` on `refs/agent-runner/lock/brief-<slug>` (ADR `ledger-status-on-per-item-lock-refs`) — a create-only ref push that is self-arbitrating (winner creates it; a concurrent slicer loses the same CAS definitively, no retry budget), so a brief is never double-sliced. The brief body STAYS in `work/briefs/ready/` while held (it does not move to a `slicing/` folder). On a **successful slice** the release performs the durable `work/briefs/ready/ → work/briefs/tasked/` move on `main` in the SAME runner-owned commit that emits the `tasks/` items, then releases the lock. On an **aborted / unclear** slice the lock is released with no `main` move (the brief already rests in `briefs/ready/`), or the lock is marked `stuck` for a human.

- **Tasked-ness is RESIDENCE in `work/briefs/tasked/` — the FOLDER, the SOLE signal.** There is no `sliced:` frontmatter marker (it was removed in `remove-sliced-marker-step-b`); the folder is canonical. A brief whose lock is held `action: slice` is _being sliced right now_; a brief in `briefs/tasked/` _has been sliced_; a brief in `briefs/ready/` is _to-slice_.
- **Edit a brief when its slice-lock is NOT held.** While the slice lock is held the brief is mid-slicing; edit it before slicing starts or after it lands (in `briefs/ready/` or `briefs/tasked/`), not while the lock is held. (A human on a stale local checkout won't see the durable `git mv` until they fetch — the protocol guarantees no _silent corruption_, not no _human surprise_.)
- **Release fails loud on a concurrent edit (never a silent stale slice).** If the held brief body was edited while the lock was held, the release detects it (the held content no longer matches the snapshot the lock took) and FAILS LOUD: the slicing is stale → re-slice from the edited brief or mark the lock stuck. The release NEVER force-restores over the edit or emits tasks cut from a stale snapshot.
- **The human path needs no lock.** A human slicing locally with no agent running has no contention and may slice on `main` directly — the lock is mandatory for the agent, optional for the human (parallel to "the runner never skips verify; the human may").

### `needs-attention` — the post-claim "stuck" state (the lock `state: stuck`)

An item that was claimed and _attempted_ but could not complete is marked **stuck on its per-item lock** instead of reaching `tasks/done/`. This is the single home for every "couldn't finish, a human must look" outcome — a failed acceptance gate (red tests), a rebase/merge conflict, a task the agent found too ambiguous to build, a timeout, or a rejected review. It is NOT a `main` folder move: the bounce is a CAS amend of the held lock entry `active → stuck` (+ the reason and any agent-surfaced questions on the entry), with NO `main` write. The item's body never moves (it rests in `tasks/todo/`, since claim no longer relocates it).

- **Who marks it:** the runner/human that owns the lock transitions — NOT the build agent (which never touches the lock ref). On a stuck job the runner amends the lock to `state: stuck` with the reason/questions, and SAVES the recoverable work as a wip commit on the kept `work/<type>-<slug>` branch (pushed to the arbiter so it travels cross-machine).
- **Not claimable:** a stuck item's lock is held, so it is not claimable (the create-only acquire loses); it IS surfaced — `agent-runner status`/`scan` read the lock refs and list held (in-progress) + stuck (needs-attention) items with their reasons (this is the "look here" set). `tasks/done/` on `main` and a `stuck` lock may legitimately CO-EXIST (a rebase-conflict bounce of a just-completed item) without corruption.
- **Resolve / return path:** a human resolves the cause then either `resume`s the lock (`stuck → active`, pick the work up again) or `requeue`s it (`stuck → released`; the item is already resting in the pool `tasks/todo/`, so there is no folder bounce). A stuck/orphaned lock is nameable and clearable via `release-lock <item>` (+ a stuck-lock report in `gc --ledger`); there is no liveness heartbeat and no auto-sweep (a human asserts a lock is dead).
- This is a _post-claim_ state. (A separate _pre-claim_ "not ready" state is the STAGING folder `tasks/backlog/` — the position gate — not this.)
- **Branch self-conflicts are gone by construction.** Because NO transient status lands on `main` (a bounce is a lock amend, not a `git mv`), a work branch cut from `main` inherits no `needs-attention`/`slicing`/`advancing` markers, so a continue/rebase is a PLAIN rebase with nothing to drop. The old `drop-bookkeeping-rebase` machinery (and its `Agent-Runner-Bookkeeping: route-to-needs-attention` trailer) existed ONLY to mitigate the inherited-marker rename/rename conflicts that on-`main` transient moves created; it was DELETED once those moves left `main` (ADR `ledger-status-on-per-item-lock-refs`). A genuine content conflict between two real lines of development still aborts → the item is marked stuck.

### Drift is a needs-attention signal (check the doc against reality first)

A brief and a task are **launch snapshots** — they capture intent at creation and are deliberately NOT kept in sync (current truth lives in `docs/adr/` + the code in `tasks/done/`). So by the time you act on one, it MAY have **drifted**: a dependency landed differently than the doc assumed, an ADR superseded a decision the doc relies on, a sibling task changed the seam it builds against. (Real example: the `watch` task predated the ledger-transition seam and still described the old direct-`main` failure-surfacing.)

**Discipline (applies whenever you investigate / slice / claim / build):** before acting, **check the doc against reality** — the code in `tasks/done/`, the relevant ADRs, and sibling tasks it depends on. If you find a discrepancy that would make you build/slice against a false premise, that is a **needs-attention candidate — do NOT silently proceed on the stale spec.** Route it per the item's kind:

- **A TASK that contradicts current reality** → route to needs-attention (mark its lock `state: stuck`) with the discrepancy as the reason (the same mechanism as a red gate), rather than building on a stale assumption. A human reconciles the task, then returns it to the pool `tasks/todo/`. (Building on a stale task produces wrong-but-compiling work — the worst outcome.)
- **A BRIEF that has drifted** (before slicing) → do NOT slice it as-is. Set `needsAnswers: true` on the brief with the discrepancy in its body (or, if it is a small factual correction you are certain of, fix the brief first), so the slicer never emits tasks from a stale spec. A human reconciles, clears the flag, then it is sliced.

The rule is symmetric: _a discrepancy between a doc and reality is not something to paper over — it is exactly the "a human must look" signal `needs-attention` (tasks) / `needsAnswers` (briefs) exists to carry._ Cheap to honour, and it stops drift from silently propagating into built work.

## Conflict-safety rules (non-negotiable)

1. **One file per item.** Never put two work items in one file. Disjoint files merge trivially.
2. **No shared index / manifest.** Do not maintain a `work/INDEX.md`, `work/list.json`, or any file every item touches — it is a guaranteed conflict point. Derive lists on demand with `ls work/tasks/todo/` / `grep`. (Same reasoning as the existing `tasks/README`: "no hand-maintained index — it just goes stale".)
3. **An empty lifecycle folder is OPTIONAL — absence means "empty", never "broken".** The folders in the layout above (`tasks/backlog`/`todo`/`done`/`cancelled`, `briefs/proposed`/`ready`/`tasked`/`dropped`, the `notes/*` buckets) describe the POSITIONS an item MAY rest in, not directories that must all exist at rest. Git does not track empty directories, so a position with no items in it simply has no folder on disk, and a reader/conductor MUST treat a missing lifecycle folder as the empty set (e.g. no `briefs/proposed/` ⇒ "nothing awaiting promotion"), NOT as a misconfigured tree. A folder is CREATED implicitly the first time an item lands in it (the `git mv`/write that places the item), and may VANISH again when its last item leaves. So: never fail, warn, or auto-create-as-a-fixup on a missing lifecycle folder; derive each position's contents on demand (rule 2) and let an empty position be a no-op. (`setup` may scaffold a starter set for ergonomics, but the contract does not REQUIRE their continued existence — emptiness and absence are the same state.)
4. **Status = location, not a field.** See above.
5. **Content-derived slugs, never counters.** Use a URL-safe slug from the title (e.g. "Historical store schema" → `historical-store-schema`). NO monotonic integer IDs — two agents would both grab "next = 43". A short hash or date prefix is fine if disambiguation is needed (`historical-store-schema` or `2026-06-03-historical-store-schema`).
6. **Dependencies by slug, read-only.** `blockedBy: [other-slug]` references other items; an item never writes another item's file. The blocker owns its own status (its folder).
7. **Claim state is the per-item LOCK, never a frontmatter field (and no longer a folder move).** Claiming an item acquires its per-item lock (`refs/agent-runner/lock/<type>-<slug>`, `action: implement`) — a create-only ref push that is self-arbitrating (the loser is definitively told "lost", no retry budget); the body STAYS in `tasks/todo/` (claim writes nothing to `main`, so an agent can claim even on a protected `main`). The holder/since ride the lock entry; `git` (the ref + its parentless commit) holds the authoritative record. There is NO `claimed_by` / `claimed_at` frontmatter, and no `git mv` into an `in-progress/` folder — the claimable predicate is "in the pool `tasks/todo/` on `main` AND no lock held on its ref".
8. **An item MAY carry a co-located `<slug>/` asset sidecar folder.** The item is ALWAYS the `<slug>.md` file (that is its identity and the only thing scanned). When an item needs companion resources — a `.patch`, a mockup image, a diagram, a sample payload — put them in a sibling folder of the SAME slug, `<umbrella>/<slug>/` (e.g. `notes/ideas/my-idea.md` + `notes/ideas/my-idea/fix.patch`). This is safe and disturbs NOTHING because every scanner lists a bucket by `isWorkItemFile` (= name ends in `.md`), so a sidecar folder is silently skipped — it is never mistaken for an item, and `(umbrella, slug)` addressing is unchanged. Rules: the sidecar is OPTIONAL and most items have none; it is OWNED by its `<slug>.md` (the markdown references its assets by relative path, e.g. `[the patch](<slug>/fix.patch)`); it shares the item's lifecycle (when the item is deleted, delete its sidecar too — a note leaves by deletion, and an orphaned sidecar is litter); and it is NOT a second item, so never put another item's `<slug>.md` inside it (that would hide it from scanning). This applies to ANY bucket (`notes/*`, `tasks/*`, `briefs/*`), not just ideas, though ideas are the common case. It does NOT violate rule 1 (one file per ITEM) or rule 2 (no shared index) — the sidecar holds an item's OWN assets, not a manifest over many items.

## Task quality rule — tests must not touch the real environment

A task that makes code **write to a SHARED / GLOBAL location** — a real home/config dir, a system path, a shared service, or an **external tool's managed store** (e.g. another agent's session directory) — MUST, as an acceptance criterion, have its **tests ISOLATE that location** (point it at a temp/scratch dir via the relevant env var or config knob) **AND assert the real one is UNTOUCHED after the run**. State the _mechanism_, not just the outcome: name the env/config lever and note WHERE the path is resolved (in-process vs in a child), because that determines whether overriding a child's env is enough or the test process's own `process.env` must be set.

This is the generalisation of the git-config isolation tests already do (`GIT_CONFIG_GLOBAL=/dev/null`): the same discipline for ANY shared write target. It exists because a task that _moves_ a write into a shared location (e.g. “write sessions to the tool's default dir instead of the worktree”) silently turns previously-isolated tests into ones that pollute — and a malformed fixture in a shared store can crash unrelated tools that read it. (Real incident: session-log test fixtures leaked into a real `~/.pi/agent/sessions/` and crashed a dashboard; see that repo's `work/notes/findings/pi-session-contract.md`.) Corollary: a synthetic fixture written into any store an external tool reads MUST be VALID per that tool's contract (capture the contract as a `notes/findings/` doc).

## Field-naming convention

All frontmatter and config field names are **camelCase** (`humanOnly`, `needsAnswers`, `blockedBy`, `briefAfter`, `autoBuild`) — matching the JSON config and the TypeScript that parses them (1:1 property mapping, no snake↔camel translation layer). No exceptions.

## Frontmatter (YAML)

### Task frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store-schema
brief: historical-store # slug of the work/briefs/ready/<slug>.md this task derives from. REQUIRED iff `covers` is set; OMIT for a self-contained chore/refactor (covers: []).
humanOnly: true # gate axis 1 (DECIDED): a human must drive this. true | omitted. MOST OMIT IT.
needsAnswers: true # gate axis 2 (DISCOVERED): open questions block autonomous work. true | omitted.
blockedBy: [] # list of slugs that must reach tasks/done/ first; [] = startable now
covers: [] # optional: user-story numbers (within `brief`) this task covers
---
```

### Brief frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store
issue: 123 # optional: the issue this brief was spawned from (the surviving thread)
humanOnly: true # optional: a human must drive the SLICING of this brief. true | omitted.
needsAnswers: true # optional: open questions block AUTO-slicing this brief. true | omitted.
briefAfter: [] # optional: brief slugs that must be SLICED first (see below). [] = sliceable now.
# tasked-ness has NO frontmatter marker: it is RESIDENCE in work/briefs/tasked/ (the release transition moves the brief there).
---
```

### Finding frontmatter

A finding (`work/notes/findings/<slug>.md`) is a capture-bucket note (no status flow), but it MUST declare its **provenance** so it stays correctable (see the findings box above):

```yaml
---
title: Human Readable Title
slug: etherscan-verification-api
source: 'derived from packages/rocketh-verifier/src/etherscan.ts @ <commit>' # REQUIRED: what the source is AND how current (a date for external sources). Be specific & honest — there is NO separate confidence field; the source string carries the weight.
---
```

- `source` is **required** — a finding without it is a `notes/observations/` signal, not a finding. State it specifically (a file+commit, a doc URL, a captured trace), so a later "the source was wrong" can revise the finding traceably.
- A **code-derived** finding describes the _external behaviour our code assumes_, never our code's internal architecture (that is `CONTEXT.md` / a `docs/` overview). If you find yourself describing our own package layout, it is not a finding.

### The two autonomy axes: `humanOnly` (decided) × `needsAnswers` (discovered)

The autonomy gate is TWO orthogonal binary fields (both default to omitted = false), present on BOTH tasks and briefs, plus the repo's `autoBuild` policy (see `docs/adr/methodology-and-skills.md` §4, authoritative):

- **`humanOnly: true` — the DECIDED axis (DE-OVERLOADED — see below).** _Should a human drive this, regardless of how complete the spec is?_ A product/design/security/judgement call, or an `AGENTS.md`-type rule. Driven by a decision (in the brief conversation, or the slicer's own judgement). On a BRIEF it means "a human must drive the slicing" (UNCHANGED — no folder substitute); on a TASK it is now NARROWED to the rare "never-for-agents BY NATURE" guard (secrets/release/security) that **survives even when the task resides in the agent pool `work/tasks/todo/`**. Task `humanOnly` is NOT the tool for ordinary "a human should review this before the agent builds it" — that job belongs to POSITION (the runner births the task STAGED in `work/tasks/backlog/`; a human promotes the approved ones into the pool `work/tasks/todo/`). See "Task `humanOnly` is NARROW" below.
- **`needsAnswers: true` — the DISCOVERED axis.** _Are there unresolved questions blocking autonomous progress?_ The spec is incomplete; **the open questions live in the body**. Once answered, the flag is cleared and an agent may proceed.
- They are **orthogonal** — four honest states. e.g. `humanOnly:true, needsAnswers:false` = fully specified but a human must own it; `humanOnly:false, needsAnswers:true` = anyone can do it once the questions are answered.
- **Repo policy `autoBuild`** answers the question the _repo_ owns: _may agents auto-build undeclared items here?_ The build member of the symmetric per-action gate family (`autoBuild`/`autoSlice`/`observationTriage`; the triage gate's old boolean name `autoTriage` is now the 3-state `observationTriage`). Per-repo config key (`.agent-runner.json`), resolved like `integration`: \*\*CLI flag (`--auto-build` / `--no-auto-build`)
  > env (`AGENT_RUNNER_AUTO_BUILD`) > per-repo config > global config > built-in default (`false`)\*\*. (Renamed from the old name `allowAgents`, now fully removed with no alias since there are no external users owed a migration window.)

**Predicate (same shape at both levels):** an item is **auto-eligible** iff `needsAnswers` is not `true` AND `humanOnly` is not `true` AND `autoBuild` is `true`. A human is never bound by it (a human may slice/build a flagged item — the gate binds the agent, like the runner-vs-human stance on `verify`).

(This supersedes the older single `humanOnly`-only gate, which itself replaced the three-state `afk` field + `allowUnspecifiedGate`.)

### Task `humanOnly` is NARROW — POSITION carries "review-first"; `humanOnly` carries "never-by-nature"

Three orthogonal axes, each meaning EXACTLY one thing (governing ADR `placement-is-runner-deterministic-humanonly-is-agent-judgement`):

- **POSITION (folder, runner-deterministic, STRUCTURAL).** Whether a task is in the agent POOL (`work/tasks/todo/`) or in STAGING (`work/tasks/backlog/`) is computed by the runner from unforgeable inputs (the `originTrust` stamp, the per-repo placement policy, explicit operator flags). "A human should review this before an agent acts on it" is encoded HERE — the task is BIRTHED in `work/tasks/backlog/` (not eligible) and a human promotes the approved ones into `work/tasks/todo/`. The agent CREATES only in the staging folder; the runner OWNS every move + promotion.
- **NATURE (`humanOnly`, agent/human judgement, ADVISORY).** Task `humanOnly: true` means "an agent must NEVER auto-take this BY NATURE" — the rare hard case (release/secrets/security/AGENTS.md-rule) that **survives even when the task resides in the pool `work/tasks/todo/`**. The autonomy gate predicate above is exactly this: a `humanOnly: true` task is never agent-claimable, even from `work/tasks/todo/`. Brief `humanOnly` is UNCHANGED (gates auto-slicing; no folder substitute, because the slicer's input is a single brief — it must be flagged in-band).
- **DISCOVERED (`needsAnswers`, agent judgement, ADVISORY).** Unchanged.

Consequences for the slicer heuristic (the `to-task` skill / the slicer review loop):

- For the COMMON "a human should review this task first" case, the slicer does NOT stamp `humanOnly: true` — it lets the runner birth the task STAGED in `work/tasks/backlog/` (the position carries the review-first signal). Stamping `humanOnly` for review was the overloaded reading and is RETIRED.
- The slicer flags `humanOnly: true` on a task ONLY when building THAT task is genuinely never-for-agents-by-nature (release pipeline, secrets handling, hard security boundaries, AGENTS.md prohibitions). If in doubt, leave `humanOnly` off and rely on the position — a human can always refuse to promote.

### Three honest integration modes for slicer output (`do brief:<slug>`)

The slicer-output integration combines `--propose`/`--merge` with the `slicesLandIn` placement default into three explicit, named modes (no new flag; the three modes are the existing combinations made explicit):

| Mode | How to invoke | What lands where | When to use |
| --- | --- | --- | --- |
| **`--propose`** (PR path) | `do brief:<slug> --propose` (or the configured default) | A work branch pushed; a PR opened against `main`. Tasks land in the PR's tree (typically `work/tasks/backlog/`); review is the PR diff. | A repo with a host (GitHub, …) and a PR-based review culture. Code/implementation review ALWAYS uses this path — a diff cannot be folder-gated (brief US #9). |
| **`--merge` + land-in-staging** (PR-free review) | `do brief:<slug> --merge` with `slicesLandIn: backlog` (or `--slices-land-in backlog`) | Tasks land DURABLY on `main` under `work/tasks/backlog/` (the staging folder, NOT eligible). A human promotes the approved ones `work/tasks/backlog/ → work/tasks/todo/`. | A bare / no-host / protected-`main` repo that still wants human review of ledger-file output. Review is a LEDGER POSITION a human moves, not an out-of-band PR. |
| **`--merge` + land-in-pool** (trusted no-review fast path) | `do brief:<slug> --merge` with `slicesLandIn: todo` (or `--slices-land-in todo`) and a trusted origin | Tasks land on `main` directly in the agent POOL `work/tasks/todo/` — immediately eligible for `do` / auto-pick. | A trusted, fast-iteration repo where the slicer's output is trusted to enter the pool without ledger-position review. The runner-deterministic placement precedence still forces STAGING for an untrusted origin (`untrusted-origin-forces-build-propose` style). |

Key rules:

- **Placement is runner-deterministic.** WHICH folder a task lands in is the runner's CALL from the `originTrust` stamp + `slicesLandIn` config + an explicit `--slices-land-in` flag (precedence: explicit-flag > untrusted-forces-staging > configured default > built-in staging). The agent never sets it. (`slicesLandIn` names the SLICE-side pool/staging slots, now `todo`/`backlog`.)
- **Code/implementation review is unchanged** — it stays on the branch/PR path (a code diff cannot be folder-gated). The position gate above is SCOPED to LEDGER-FILE output (slicing); the existing branch-based build review is unaffected.
- **`humanOnly` survives every mode.** A `humanOnly: true` task in the pool is still not agent-claimable — the position gate and the `humanOnly` gate are orthogonal.

### `briefAfter` — brief slicing-order (enforced against `work/briefs/tasked/`, NOT `tasks/done/`)

`briefAfter: [other-brief]` on a brief is **distinct from** task `blockedBy`, and deliberately named differently because it gates a different verb against a different signal:

- **task `blockedBy`** gates **building** a task, resolved against `tasks/done/`.
- **brief `briefAfter`** gates **slicing** a brief, resolved against `work/briefs/tasked/` residence (i.e. the listed briefs must already be sliced — reside in `work/briefs/tasked/` — so this brief's emitted tasks can reference the real slugs of those briefs' tasks in their `blockedBy`). This mirrors `blockedBy` → `tasks/done/` exactly: ordering resolves against folder residence, not a frontmatter marker.

It waits on **tasked-ness (`work/briefs/tasked/`), not `tasks/done/`** on purpose: the reason B waits for A is that B's tasks need A's slugs to _exist_, which happens the moment A is sliced — not when A is fully built. Build-ordering between A's and B's actual work is then expressed where it belongs, in B's individual tasks' `blockedBy` (against `tasks/done/`). Enforced for the auto-slicer (it skips a brief whose `briefAfter` briefs do not yet reside in `work/briefs/tasked/`); a human may slice anyway.

### The `brief` link (required _when `covers` is set_)

`brief` names the source document this task was sliced from — the slug of a `work/briefs/ready/<slug>.md` in the same repo. Its load-bearing job is to make `covers` unambiguous: `covers: [4]` means nothing without knowing _which_ brief's story 4. So the requirement tracks that job:

- **`brief` is REQUIRED iff `covers` is non-empty.** Any task that points into brief user stories MUST name the brief those numbers belong to (a task spanning multiple briefs names its primary one in `brief` and references the others in prose).
- **`brief` MAY be omitted for a self-contained task** — a refactor, chore, build fix, or dependency bump that derives from no brief and covers no user stories (`covers: []`). Such a task MUST instead carry a clear, standalone _What to build_ + _Prompt_ (it is its own source of truth). This is **in contract** — not all work is feature work; only _feature_ work flows from a brief.

(Consequence, by design: a brief-less chore task is part of no brief's completion set — the `issue-to-brief` "brief complete?" query counts only `brief:<slug>` tasks — which is correct, since a chore is not part of any feature's traceability.)

The body uses [task-template.md](task-template.md): What to build (end-to-end), Acceptance criteria (checkboxes), Blocked by (prose mirror of frontmatter), and a **Prompt** section — a self-contained instruction block that can be pasted into a fresh agent context (the existing `tasks/` convention), so an AFK agent needs nothing but the file to start.
