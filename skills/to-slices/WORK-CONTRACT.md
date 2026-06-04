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
5. **Dependencies by slug, read-only.** `blocked_by: [other-slug]` references
   other items; an item never writes another item's file. The blocker owns its own
   status (its folder).
6. **`claimed_by` / `claimed_at` are ADVISORY only.** They may be stamped into
   frontmatter during a claim for human readability, but they are NEVER the source
   of truth for whether something is claimed — the folder + git history are. Two
   agents must never rely on reading/writing this field to coordinate.

## Frontmatter (YAML)

```yaml
---
title: Human Readable Title
slug: historical-store-schema
prd: historical-store    # REQUIRED: slug of the work/prd/<slug>.md this slice derives from
humanOnly: true      # autonomy gate (see below). true | omitted. MOST SLICES OMIT IT.
blocked_by: []       # list of slugs that must reach done/ first; [] = startable now
covers: []           # optional: user-story numbers (within `prd`) this slice covers
created: 2026-06-03  # date the slice was written
# advisory only — NOT the source of truth for claim state:
claimed_by:          # e.g. agent id / name, set during claim
claimed_at:          # timestamp, set during claim
---
```

### The `humanOnly` gate (binary, omittable) + the repo's `allowAgents` policy

The autonomy gate is split across TWO places (see `docs/adr/methodology-and-skills.md`
§4, authoritative):

- **Slice field `humanOnly: true`** answers ONE question the *slice* owns: *is
  this a human-only item — a product/design/security/judgement call that an agent
  must never auto-claim?* It is binary: `humanOnly: true` or **omitted**. MOST
  SLICES OMIT IT — an omitted gate means "undeclared", NOT "forbidden". It is the
  ONLY autonomy field on a slice and it is authoritative.
- **Repo policy `allowAgents`** answers the question the *repo* owns: *may agents
  claim undeclared (not `humanOnly`) slices here?* It is a per-repo config key
  (`.agent-runner.json`), resolved like `integration`: **CLI flag
  (`--allow-agents` / `--no-allow-agents`) > per-repo config > global config >
  built-in default (`false`)**.

A consuming runner resolves eligibility as: **agent-claimable iff `humanOnly` is
not `true` AND `allowAgents` is `true`**. `humanOnly: true` is never agent-
claimable regardless of policy. A strict-by-default repo (no `allowAgents`) lets
agents claim nothing automatically; a repo that opts in via `allowAgents: true`
lets agents claim any slice that is not `humanOnly: true`.

(This replaces the older three-state `afk: true|false|omitted` field + the
`allowUnspecifiedGate` runner policy.)

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
