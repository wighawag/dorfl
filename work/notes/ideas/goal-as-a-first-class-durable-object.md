---
title: 'A GOAL as a first-class durable object (a `pursue-goal` skill): one goal tracked across many sessions, the conversation as live tracker, the tree as memory'
slug: goal-as-a-first-class-durable-object
type: idea
status: incubating
---

# A goal as a first-class durable object (pre-spec / incubating idea)

> Captured 2026-09-22 from the design conversation that produced the `one-shot` skill. This is a **pre-spec idea**, NOT a committed direction: it was explicitly deferred ("to be designed later") when `one-shot` took the name. The one thing it must survive is the conceptual question in the last section, which may well kill it.

## The signal

Designing `one-shot` surfaced an axis none of the three conductors covers.

- **`drive-tasks`** drives a READY BOARD, one task at a time, via the CLI. Scope: the board.
- **`orchestrate`** surveys the WHOLE tree and batches the judgement residue to a human who is sitting there. Scope: everything, one sitting.
- **`one-shot`** takes ONE goal through spec, task, build and land in a single unattended pass, deciding the reversible calls itself and recording them. Scope: one goal, one pass.

What none of them holds is a goal that OUTLIVES a session: an ambition worked at over days, across many sittings, some unattended and some supervised, where the useful question on any given morning is "where is this goal, what moved, what is it waiting on?" Today the only durable answer is folder residence across the whole tree, which is the answer for the PROJECT, not for one goal within it. The conversation that holds the goal is exactly the thing that does not survive: it is compacted, interrupted and eventually gone.

The axis is DURATION plus IDENTITY, not autonomy. That is what makes it a separate idea from `one-shot` rather than a mode of it, and it is why it should not be a flag on the skill we just shipped.

## The rough shape

A `pursue-goal` skill whose defining property is that it is RESUMABLE: the conversation is the live tracker while it exists, and the tree is the memory when it does not. A new session on an existing goal re-derives the state map from files, reports what moved since last time, and continues.

`one-shot` already prototypes the mechanism, which is the cheap part of this idea and is now in the tree ready to be judged:

- The goal rests in `work/notes/ideas/<goal-slug>.md` (the contract's bucket for a proposed pre-spec opportunity), holding the goal paragraph, the done-when, the scope boundary and the decisions the human made at kickoff.
- It deliberately does NOT list the specs or tasks it spawned, because a file every item touches is the shared index conflict-safety rule 2 forbids, and a hand-maintained child list is stale within the hour.
- Each spawned spec carries a `Goal: <goal-slug>` line in its BODY, and the goal's state is derived on demand by `grep` plus folder residence.

## Open questions

1. **Does the `Goal:` body line hold up?** It is the least-tested idea in `one-shot`. A body line is greppable, needs no protocol change, and cannot collide with the frontmatter parser, but it is unvalidated and invisible to every existing reader. The alternative is a real `goal:` frontmatter field on the spec, which is a PROTOCOL CHANGE and must be proposed as one, never quietly started. Whichever is chosen, it is the same decision for both skills, so this idea owns it.
2. **Is a goal a work ITEM or a NOTE?** As a note it is exempt from status-is-the-folder, leaves by deletion, and costs the contract nothing. As an item it would need its own regime, its own terminal, and a slug space, which is a large addition for one concept.
3. **What is the honest terminal for an ABANDONED goal?** A note leaves by deletion, but a goal abandoned halfway has already spawned specs and tasks that outlive it, and deleting the note silently orphans their `Goal:` lines. Is that acceptable (the specs stand on their own) or does it want a `reason:` the way `tasks/cancelled/` and `specs/dropped/` do?
4. **Does progress against a done-when want a mechanism?** The adjacent idea `goal-driven-bounded-loop` holds a borrowed one (in-band progress markers, monotonic-stall detection). If a goal ever needs a progress READING, that idea is where the mechanism lives; this idea should consume it rather than invent a second one.
5. **Does it compose with `one-shot` or replace its kickoff?** The obvious composition is that `pursue-goal` owns the goal object and `one-shot` is one unattended pass AGAINST an existing goal, which would make `one-shot`'s kickoff a special case of "create the goal". Attractive, but it re-opens a skill that just shipped, so it needs the fit question below answered first.

## The fit question that may kill it (read this before building anything)

**Do specs already compose into goals, making a goal object redundant?** The contract's existing answer to "an ambition too big for one spec" is a CHAIN: split by confidence tier, order with `taskedAfter:`, and reframe the uncertain head as an EXPLORATION spec whose done is confidence plus a build plan. That chain already spans sessions, already survives compaction, and already has durable status via folder residence. If the chain is the goal, then a goal object adds a second way to say the same thing, which is precisely the concept-duplication the review protocol's conceptual-coherence lens exists to catch: a new named concept that overlaps an existing one, at a layer that may be wrong.

The honest case FOR a distinct goal object is that a spec chain records the DECOMPOSITION but not the INTENT: nothing in the tree says "these five specs exist because the human asked for X, and X is done when Y". The case AGAINST is that the intent could just live in the head spec of the chain, at no new cost.

That question should be settled BEFORE any spec is written. If the answer is "the chain is enough", the right outcome is to delete this note and keep the `Goal:` line as a small convenience in `one-shot`, not to build a skill.

## Related

- **`skills/one-shot/SKILL.md`** — where the mechanism above is already written down and running.
- **`work/notes/ideas/goal-driven-bounded-loop.md`** — the borrowed Maestro mechanism (progress self-assessment, stall detection, halt marker). Different layer: that is a LOOP mechanism, this is an ARTIFACT identity. They would compose, and its own unresolved "does a goal loop fight spec-first?" caveat applies here too.
- **`work/notes/ideas/chat-driven-idea-to-product.md`** — a conversational control surface over the advance loop. If a goal object ever exists, that is the thing such a UI would render.
