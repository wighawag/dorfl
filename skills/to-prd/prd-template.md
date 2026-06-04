---
title: <Human Readable Title>
slug: <url-safe-slug>
created: <YYYY-MM-DD>
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.
> (The technical-detail sections below are trimmed by `to-slices` once the work
> is sliced — they move into slices/ADRs and this PRD settles to its durable
> framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The problem the user faces, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A LONG, numbered list — the heart of the PRD. Format:

1. As a <actor>, I want <feature>, so that <benefit>.

Cover all aspects of the feature, extensively.

### Human-only considerations (prose guidance, not a machine field)

Which user stories / areas will likely need a HUMAN (a product, design, security,
or judgement call) rather than an unattended agent? Note them here in prose. This
GUIDES the slicer to set `humanOnly: true` on the covering slices — the
authoritative flag lives on the slice, never as a parsed field here. (Omit this
subsection if everything is straightforwardly agent-buildable.)

## Implementation Decisions

Decisions made at launch (modules to build/modify, interfaces, architectural
choices, schema, API contracts, specific interactions). No file paths or code
snippets (they go stale) — except a decision-encoding snippet from a prototype
(state machine, reducer, schema, type shape), trimmed to the decision-rich part.

> Trimmed at slice-time: this detail moves into the slices (what to build) and,
> where it's a durable rationale, into an ADR (`docs/adr/`). It is here only to
> seed the slicing.

## Testing Decisions

What makes a good test (external behaviour, not implementation details); which
modules/seams will be tested; prior art in the codebase.

> Also trimmed at slice-time (moves into slices' acceptance criteria / an ADR).

## Out of Scope

What is deliberately not being done (and, where useful, where it lives instead —
e.g. an incubating idea in `work/ideas/`).

## Further Notes

Anything else worth recording at launch.
