---
name: capture-signal
description: "Record a noticed signal into the file-based work/ contract before it evaporates — routing it to the RIGHT bucket (observations / findings / ideas / docs/adr / needs-attention). Use the MOMENT you notice something worth remembering that is off the current task's path: a spotted discrepancy or drift (docs vs code), a recurring tool/process failure, surprising external/domain behaviour, a 'we should note this' / 'isn't that worth capturing?' moment, an out-of-scope opportunity, or a decision worth recording. Also use when the user says to capture/record/note something, or asks 'shouldn't that be an observation?'. The trigger is NOTICING, not being asked — a description in CONTEXT.md is not enough to fire this reflex; this skill is."
---

# capture-signal

Turn a noticed signal into a durable file in the `work/` contract, in the **right bucket**, immediately — so it is not lost to the conversation. Capturing beats losing: do not agonise over the perfect bucket; pick the best fit and write it.

The bucket _definitions_ are authoritative in `to-slices`'s [WORK-CONTRACT.md](work/protocol/WORK-CONTRACT.md) (the repo-local protocol copy setup writes; read it if unsure) — this skill is the **routing reflex + the discipline**, not a restatement of the contract.

## When this fires (the trigger is NOTICING)

The hard part is not _how_ to write the note — it is _remembering to_ at the moment a signal appears. Fire this skill when, mid-task, you notice any of:

- a **discrepancy / drift** (a doc contradicts the code; a slice/PRD assumes something no longer true; a dependency landed differently than assumed);
- a **recurring tool/process failure** (the same error twice — yours or the system's; a wasted-round-trip pattern);
- **surprising external/domain behaviour** you had to learn (an API's real behaviour, a protocol quirk) — verified ground truth;
- an **out-of-scope idea/opportunity** ("we could also…") that would derail the current task;
- a **decision** you/the user just made and reasoned through;
- the user nudging: "shouldn't that be captured / an observation?".

If you catch yourself _narrating_ a signal in prose ("interesting — X keeps happening") instead of _recording_ it, that is the trigger. Record it.

## Route to the right bucket

| The signal is… | Bucket | Mutability |
| --- | --- | --- |
| spotted, **unverified** ("I noticed maybe-X") — INCLUDING agent/harness **conduct** signals | `work/observations/<slug>.md` | append-only |
| **verified external/domain** ground truth (a real API/protocol behaviour) | `work/findings/<slug>.md` | accumulates |
| a **proposed** enhancement, pre-PRD ("we might build X") | `work/ideas/<slug>.md` | editable |
| a **decision WE made** + its why | `docs/adr/<slug>.md` | durable |
| a **claimed item that got stuck** (gate red, conflict, ambiguity) | `work/needs-attention/<slug>.md` (via the runner's move) | folder-native |

Tie-breakers:

- **observation vs finding:** internal "spotted, unverified" → observation; only _verified external/domain_ truth → finding. An internal investigation is an observation (it may spawn a fix slice / an ADR), NOT a finding. **A finding MUST carry a `source:` (provenance)** — what the source is AND how current (a captured trace, a _dated_ external spec, or the code you read). A would-be finding with no source is really an `observation`. Describing OUR OWN code is never a finding (→ `CONTEXT.md`/`docs/`); a finding records the _external_ world we integrate with.
- **observation vs ADR:** "I spotted X" → observation; "we DECIDED X because Y" → ADR.
- **agent/harness conduct signals** (e.g. "the agent kept misusing a tool"): these are not repo-domain signals, but **capture > lose** — put them in `observations/` and **flag in the note that it is a conduct signal, not a domain signal** so a future reader does not hunt for a code bug. (Include refs: the offending tool calls, `file:line`, or commit.)

## Discipline (from WORK-CONTRACT.md — honour, don't relitigate)

- **Content-derived slug**, never a counter (`agent-skipped-edit-skill`, not `note-3`).
- **Frontmatter:** `title`, `type` (`observation`/`finding`/`idea`), `status` (`spotted`/`incubating`), and a `spotted:`/`created:` date. **For a `finding`, also `source:` (REQUIRED provenance: what the source is + how current; no separate confidence field)** — see WORK-CONTRACT.md findings box.
- **`observations/` are APPEND-ONLY** — add an `## Update` block; don't rewrite what was first seen.
- **Capture buckets do NOT flow** (they are not work items / status≠folder); they leave only by deletion once no longer useful. A note may _spawn_ work (a slice, an ADR) created separately — the note is not `git mv`'d into it.
- **Make it actionable:** state what was seen, where (refs/`file:line`/commit), and why it matters — enough that a future reader (or you) can act without the conversation.
- **Do NOT auto-commit** when firing standalone in an interactive session — write the file, report the path, leave it for the maintainer (per the repo's git etiquette). (EXCEPTION: when a conductor/autonomous caller — e.g. `drive-backlog` / `orchestrate` — captures the note as part of a run that commits its own observations, it commits this note too and reports it; the no-auto-commit default is for the standalone interactive reflex.)

## Anti-pattern this skill exists to prevent

Knowing what observations _are_ (a glossary entry in CONTEXT.md) does NOT make you _record_ one at the right moment — that is a reflex, not a fact. If you find you described a signal but never wrote it down, you hit the anti-pattern. Write the file.
