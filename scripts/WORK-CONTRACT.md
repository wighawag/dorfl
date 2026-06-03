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
  done/<slug>.md           # completed (moved here in the work PR)
  out-of-scope/<slug>.md   # durable "won't do" records (lightweight ADR)
  findings/<slug>.md       # review / ground-truth notes (optional, like tasks/findings)
```

**Status is the folder a file lives in — never a frontmatter field.** Claiming /
finishing = moving the file between folders with `git mv`. This is what makes
concurrent updates safe: two agents moving *different* files never conflict.

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
afk: true            # AFK gate (see below). true | false | omitted
blocked_by: []       # list of slugs that must reach done/ first; [] = startable now
covers: []           # optional: user-story numbers (within `prd`) this slice covers
created: 2026-06-03  # date the slice was written
# advisory only — NOT the source of truth for claim state:
claimed_by:          # e.g. agent id / name, set during claim
claimed_at:          # timestamp, set during claim
---
```

### The `afk` gate (boolean, omittable)

`afk` answers ONE question: *may an autonomous runner claim and complete this item
unattended?* It is deliberately a boolean, not an enum, and it may be omitted:

- `afk: true` — explicitly safe to build + integrate unattended.
- `afk: false` — explicitly needs a human (a decision, a review, a judgement
  call). An autonomous runner must NEVER claim it.
- *omitted* — unspecified. Whether a runner may claim it is the **runner's**
  policy decision, not the slice's. A strict-by-default runner skips it; a
  permissive runner may claim it.

This three-state design lets `afk: false` mean "deliberately human-only" (stronger
than silence), distinct from *omitted* meaning "nobody decided — ask the runner".
A consuming runner resolves eligibility as: `afk === true` ⇒ eligible; `afk ===
false` ⇒ never; *omitted* ⇒ depends on the runner's `allowUnspecifiedGate` policy.

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
