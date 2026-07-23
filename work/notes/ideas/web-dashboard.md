---
title: 'Web dashboard over the CLI (read-only first)'
slug: web-dashboard
type: idea
status: incubating
---

# Web dashboard (pre-SPEC / incubating idea)

> This is a **pre-SPEC idea**, not a committed north-star. It is captured here so it is not lost. It is NOT ready to slice: no SPEC describes it yet, and the maintainer decided it is not the right time. When it ripens, promote it to a `work/spec/<slug>.md` (a thin, durable north-star), then slice against that.
>
> The lifecycle tier this sits in: **`work/ideas/` (incubating) -> `work/spec/` (committed north-star) -> `work/backlog/` (slices) -> `work/done/`.** Nothing traces to an idea; slices trace to PRDs.

> RELATED (2026-06-07): `work/ideas/chat-driven-idea-to-product.md` is the CONTROL + conversation surface this read-only dashboard explicitly deferred (it runs agents / mutates git from web requests, and adds an idea→SPEC chat bootstrap). This dashboard is its read-only sibling; that idea consciously revisits the same "no web control surface" boundary noted below.

## The rough thought

A web dashboard layered on top of the existing CLI surfaces (`scan`, `status`) to see, at a glance and across all watched repos:

- the cross-repo work queue (what `scan` shows: backlog items grouped by who can take them, eligibility),
- live/failed/retained jobs (what `status` shows),
- and especially the **needs-attention** items with their reason (red gate, rebase conflict, ambiguous slice, timeout, review veto) AND the agent's surfaced message/questions, so a human can see what is stuck and why.

## Open questions to resolve before it becomes a SPEC

- **Read-only vs control surface.** Strong lean: FIRST CUT IS READ-ONLY (a view over `scan`/`status`). A control surface (claim/complete/retry/resolve from the browser) mutates git / runs agents from web requests — much bigger, security- laden; defer.
- **Daemon vs on-demand.** `watch` is deliberately a bounded session, not a daemon (and the original SPEC listed "no long-lived daemon/service" and "no web UI / HTTP control surface" as out of scope). A dashboard implies a served process or a regenerated snapshot. Decide: an `dorfl dashboard` that serves current state on demand (reading `work/` dirs + job records live) vs an always-on server. Lean: on-demand served, not a daemon.
- **Relationship to needs-attention surfacing.** The dashboard's value depends on needs-attention reasons + agent messages being RECORDED (in job records) so they can be displayed. That recording is a prerequisite (see the CLI `status` in `agent-workspaces`, and a likely dedicated needs-attention surfacing slice).
- **Does it reverse a locked scope decision?** The original SPEC explicitly scoped OUT a web UI / HTTP control surface. Promoting this to a SPEC means consciously revisiting that boundary (read-only first softens it).

## Why not now

Maintainer call: not the right time. The CLI loop (claim/start/verify/complete) and the autonomous substrate come first; a dashboard is most valuable once needs-attention surfacing exists to display.
