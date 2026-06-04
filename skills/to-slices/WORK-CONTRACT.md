# The `work/` on-disk contract

This is the shared contract between the **slices** skill (producer) and the
**lifecycle** skill (consumer). It is designed to be **conflict-safe for parallel
AFK agents**. Every rule below exists to avoid merge conflicts and lost updates.

## Location

`work/` lives **inside the target project repo**, versioned with that repo's code
(the same place the `tasks/` convention uses today). Slices reference that repo's
code; AFK work happens in clones/worktrees of that repo.

## Layout — status IS the folder

```
work/
  prd/<slug>.md            # PRDs / design docs (the source material to slice)
  backlog/<slug>.md        # sliced, grabbable items — NOT yet claimed
  in-progress/<slug>.md    # claimed (moved here via `git mv` during claim)
  needs-attention/<slug>.md # claimed + attempted but STUCK — bounced back for a human
  done/<slug>.md           # completed (moved here in the work PR)
  out-of-scope/<slug>.md   # durable "won't do" records (lightweight ADR)
  findings/<slug>.md       # review / ground-truth investigation notes (optional)
```

> **`findings/` vs ADRs.** `work/findings/` is for *investigation / ground-truth
> notes* tied to work items. **Architectural Decision Records (ADRs) — the durable
> *why* of technical choices — live in `docs/adr/`** (the conventional location
> that common engineering skills read), NOT in `work/findings/`. Keep the two
> distinct: a finding is "what we observed"; an ADR is "what we decided and why".

**Status is the folder a file lives in — never a frontmatter field.** Claiming /
finishing = moving the file between folders with `git mv`. This is what makes
concurrent updates safe: two agents moving *different* files never conflict.

### `needs-attention/` — the post-claim "stuck" state

An item that was claimed (`in-progress/`) and *attempted* but could not complete
is moved to `work/needs-attention/<slug>.md` instead of `done/`. This is the
single home for every "couldn't finish, a human must look" outcome — a failed
acceptance gate (red tests), a rebase/merge conflict, a slice the agent found too
ambiguous to build, a timeout, or a rejected review. It is the folder-native form
of surfacing: there are no labels and no status field (rule 3) — the item simply
*moves*, exactly like the done-move.

- **Who moves it:** the runner/human that owns git transitions — NOT the build
  agent (which does no git). On a stuck job the runner writes the **reason** (and
  any questions the agent surfaced) into the file body, then
  `git mv work/in-progress/<slug>.md work/needs-attention/<slug>.md` and commits
  it like any other transition.
- **Not claimable:** `needs-attention/` items are NOT eligible (a `scan`/runner
  skips them for claiming) but ARE surfaced (a human/`status` lists them with
  their reason — this folder IS the "look here" set).
- **Return path:** once the human resolves the cause (clarifies the slice,
  resolves the conflict, fixes the env), the item is `git mv`'d **back to
  `backlog/`** to be re-claimed (or work resumes on its branch directly). It must
  not rot in `needs-attention/`.
- This is a *post-claim* state. (A separate *pre-claim* "not ready to be claimed
  yet" state is intentionally NOT added for now: under-specified items simply
  should not be written into `backlog/` until they are ready. Revisit only if a
  genuine intake-triage need appears.)

## Conflict-safety rules (non-negotiable)

1. **One file per item.** Never put two work items in one file. Disjoint files
   merge trivially.
2. **No shared index / manifest.** Do not maintain a `work/INDEX.md`,
   `work/list.json`, or any file every item touches — it is a guaranteed conflict
   point. Derive lists on demand with `ls work/backlog/` / `grep`. (Same reasoning
   as the existing `tasks/README`: "no hand-maintained index — it just goes
   stale".)
3. **Status = location, not a field.** See above.
4. **Content-derived slugs, never counters.** Use a URL-safe slug from the title
   (e.g. "Historical store schema" → `historical-store-schema`). NO monotonic
   integer IDs — two agents would both grab "next = 43". A short hash or date
   prefix is fine if disambiguation is needed (`historical-store-schema` or
   `2026-06-03-historical-store-schema`).
5. **Dependencies by slug, read-only.** `blockedBy: [other-slug]` references
   other items; an item never writes another item's file. The blocker owns its own
   status (its folder).
6. **Claim state is the folder + git history, never a frontmatter field.** Who
   claimed an item and when is recorded authoritatively by the `git mv` into
   `in-progress/` and its commit (`claim: <slug> (by <who>)`). There is NO
   `claimed_by` / `claimed_at` frontmatter — it would only duplicate what git
   already holds and tempt agents to coordinate on a non-authoritative field.

## Field-naming convention

All frontmatter and config field names are **camelCase** (`humanOnly`,
`needsAnswers`, `blockedBy`, `sliceAfter`, `allowAgents`) — matching the JSON
config and the TypeScript that parses them (1:1 property mapping, no snake↔camel
translation layer). No exceptions.

## Frontmatter (YAML)

### Slice frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store-schema
prd: historical-store    # REQUIRED: slug of the work/prd/<slug>.md this slice derives from
humanOnly: true      # gate axis 1 (DECIDED): a human must drive this. true | omitted. MOST OMIT IT.
needsAnswers: true   # gate axis 2 (DISCOVERED): open questions block autonomous work. true | omitted.
blockedBy: []        # list of slugs that must reach done/ first; [] = startable now
covers: []           # optional: user-story numbers (within `prd`) this slice covers
---
```

### PRD frontmatter

```yaml
---
title: Human Readable Title
slug: historical-store
issue: 123           # optional: the issue this PRD was spawned from (the surviving thread)
humanOnly: true      # optional: a human must drive the SLICING of this PRD. true | omitted.
needsAnswers: true   # optional: open questions block AUTO-slicing this PRD. true | omitted.
sliceAfter: []       # optional: PRD slugs that must be SLICED first (see below). [] = sliceable now.
sliced: 2026-06-03   # set by to-slices after the one-time trim; marks the PRD launched-and-sliced.
---
```

### The two autonomy axes: `humanOnly` (decided) × `needsAnswers` (discovered)

The autonomy gate is TWO orthogonal binary fields (both default to omitted =
false), present on BOTH slices and PRDs, plus the repo's `allowAgents` policy
(see `docs/adr/methodology-and-skills.md` §4, authoritative):

- **`humanOnly: true` — the DECIDED axis.** *Should a human drive this,
  regardless of how complete the spec is?* A product/design/security/judgement
  call, or an `AGENTS.md`-type rule. Driven by a decision (in the PRD conversation,
  or the slicer's own judgement). On a PRD it means "a human must drive the
  slicing"; on a slice it means "a human must drive the build".
- **`needsAnswers: true` — the DISCOVERED axis.** *Are there unresolved questions
  blocking autonomous progress?* The spec is incomplete; **the open questions live
  in the body**. Once answered, the flag is cleared and an agent may proceed.
- They are **orthogonal** — four honest states. e.g. `humanOnly:true,
  needsAnswers:false` = fully specified but a human must own it; `humanOnly:false,
  needsAnswers:true` = anyone can do it once the questions are answered.
- **Repo policy `allowAgents`** answers the question the *repo* owns: *may agents
  claim undeclared items here?* Per-repo config key (`.agent-runner.json`),
  resolved like `integration`: **CLI flag (`--allow-agents` / `--no-allow-agents`)
  > per-repo config > global config > built-in default (`false`)**.

**Predicate (same shape at both levels):** an item is **auto-eligible** iff
`needsAnswers` is not `true` AND `humanOnly` is not `true` AND `allowAgents` is
`true`. A human is never bound by it (a human may slice/build a flagged item — the
gate binds the agent, like the runner-vs-human stance on `verify`).

(This supersedes the older single `humanOnly`-only gate, which itself replaced the
three-state `afk` field + `allowUnspecifiedGate`.)

### `sliceAfter` — PRD slicing-order (enforced against `sliced:`, NOT `done/`)

`sliceAfter: [other-prd]` on a PRD is **distinct from** slice `blockedBy`, and
deliberately named differently because it gates a different verb against a
different signal:

- **slice `blockedBy`** gates **building** a slice, resolved against `done/`.
- **PRD `sliceAfter`** gates **slicing** a PRD, resolved against the `sliced:`
  marker (i.e. the listed PRDs must already be sliced — so this PRD's emitted
  slices can reference the real slugs of those PRDs' slices in their `blockedBy`).

It waits on **`sliced:`, not `done/`** on purpose: the reason B waits for A is that
B's slices need A's slugs to *exist*, which happens the moment A is sliced — not
when A is fully built. Build-ordering between A's and B's actual work is then
expressed where it belongs, in B's individual slices' `blockedBy` (against `done/`).
Enforced for the auto-slicer (it skips a PRD whose `sliceAfter` PRDs aren't yet
sliced); a human may slice anyway.

### The `prd` link (required)

`prd` names the source document this slice was sliced from — the slug of a
`work/prd/<slug>.md` in the same repo. It is **required** so that `covers`
(user-story numbers) is never ambiguous when a repo holds more than one PRD:
`covers: [4]` means nothing without knowing *which* PRD's story 4. A slice that
spans multiple PRDs names its primary one in `prd` and may reference the others
in prose. (Ad-hoc slices with no PRD are out of contract — write a short
`work/prd/<slug>.md` first; that is the source of truth `covers` points into.)

The body uses [slice-template.md](slice-template.md): What to build (end-to-end),
Acceptance criteria (checkboxes), Blocked by (prose mirror of frontmatter), and a
**Prompt** section — a self-contained instruction block that can be pasted into a
fresh agent context (the existing `tasks/` convention), so an AFK agent needs
nothing but the file to start.
