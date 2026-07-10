---
title: Chat-driven "idea → product" web app — a control + conversation surface over the advance-loop engine (server-side; browser is a thin client)
slug: chat-driven-idea-to-product
type: idea
status: incubating
---

# Chat-driven idea → product (pre-SPEC / incubating idea)

> This is a **pre-SPEC idea**, not a committed north-star. Captured 2026-06-07 from a design conversation so it is not lost. It is NOT ready to slice: no SPEC describes it, and the maintainer explicitly said "not interested to build it right now" — the value of the conversation was probing **dorfl's capabilities** and **what (if anything) the engine itself would need**.
>
> Lifecycle tier: **`work/ideas/` (incubating) → `work/spec/` (committed north-star) → `work/backlog/` (slices) → `work/done/`.** Nothing traces to an idea; slices trace to PRDs.

## The rough thought

A web app shaped as a **chat box + a side preview**: a user types a first message (an idea), and the system advances it from idea → SPEC → slices → built product, with the human's ONLY job being to **answer the questions dorfl surfaces**, rendered as chat messages. The "side preview" was a for-instance (it could be a diff view, a file tree, or — for a web product target — the actually-built artifact served live); a web app is one interesting target among several.

It is, in one line: **a conversational CONTROL + ANSWER surface over the autonomous advance loop** — the chat is the human-in-the-loop seam, the engine does everything else.

## Relationship to the two ideas it sits between (read these first)

This idea is the natural FRONTEND of one existing idea and the deferred CONTROL half of another:

- **`work/ideas/advance-loop-question-answer-protocol.md` — the ENGINE.** That idea is precisely "advance `work/` items toward ready, emit question files when judgement is needed, consume the human's answers on later passes." This chat app is a RENDERER for that engine's question/answer SIDECAR (`work/questions/<type>-<slug>.md`)
  - `needs-attention`: surface each open question as a chat message, write the human's reply back as the answer. The advance engine is the substrate; the chat is one face of it. **Do not design a parallel question mechanism — reuse the advance sidecar contract** (the same "one protocol, two drivers" rule that idea states).
- **`work/ideas/web-dashboard.md` — the READ-ONLY view it extends into CONTROL.** The dashboard idea is a read-only view over `scan`/`status`/`needs-attention`, and it EXPLICITLY DEFERRED a "control surface (claim/complete/retry/resolve from the browser) — mutates git / runs agents from web requests — much bigger, security- laden." THIS idea is exactly that deferred control surface, plus the conversational idea→SPEC bootstrap on the front. So promoting this consciously revisits the "no web UI / HTTP control surface" boundary the original SPEC locked out (same caveat the dashboard idea records).

## What dorfl already gives this for free

- **State-in-git ⇒ a nearly stateless backend.** Each user's project is a repo with a `work/` tree on an arbiter; "the product so far" IS the repo. The server runs `dorfl` against it; there is no app-side state machine to keep in sync.
- **The lifecycle IS a question-surfacing loop.** `spec → slices → backlog → in-progress → needs-attention → done` already means "advance autonomously until judgement is needed, then stop and surface." The chat is a different render of `needs-attention` + the advance-loop sidecar.
- **`status`/`scan` already enumerate what is stuck + why** (the dashboard idea's point). The chat backend is largely "render those as messages."
- **`requeue --message <handoff note>` already exists** (PR #6) — that is the answer-INGEST primitive ("apply the human's reply back to the item + continue"). The advance loop's apply-rung generalizes it; for a first cut the existing `requeue --message` is the lever.
- **Resumability + inspectability are free** — the user can leave and return; the repo holds everything.

## Why the browser cannot run dorfl (settled in the conversation)

The maintainer floated "could it run fully in the browser (isomorphic-git + IndexedDB)?" and then self-corrected to "server-side is fine, a demo is fine." Recording WHY, so it is not re-litigated:

- **dorfl shells out to the `git` BINARY and to `gh`,** everywhere (`runAsync('git', …)`), not to a JS git API. Porting to isomorphic-git would mean re-plumbing every git call behind a new seam AND reimplementing what isomorphic-git does not cover — notably the interactive-rebase / `GIT_SEQUENCE_EDITOR` trick in `rebaseDroppingNeedsAttentionSurface`, `--force-with-lease`, etc. No isomorphic-git equivalent for that.
- **The agent harness cannot run in a browser at all** — the whole point is launching pi/Claude as a SUBPROCESS inside a checkout. No subprocess, no filesystem checkout, no model launch.
- **Conclusion: server-side dorfl, browser is a thin client.** A demo is the right scope.

## What dorfl itself would likely need (the actual point of the discussion)

The gaps are all about **machine-consumability / event flow**, because today the runner is built for a human at a terminal:

1. **Structured / JSON event output — the #1 thing.** Every lifecycle signal goes through `note(…)` → stderr PROSE, and `status` prints for a terminal. A web backend wants JSON events (`claimed`, `gate-green`, `review-approve`, `needs-attention: <reason>`, `done`) and ideally a stream. Today you would scrape prose or poll `status` + diff the `work/` tree. **This is the one capability worth adding to dorfl ITSELF (not the app)**, because every web integration — not just this one — will want it. (Substrate hint: `output.ts` exists and the harness already captures the AGENT's final output; what is missing is structured emission of the RUNNER's own lifecycle events.)
2. **Questions as a clean API, not freeform markdown.** A `needs-attention` reason is prose; to put it in a chat and collect a TYPED answer you want the question as DATA + a typed ingest path for the reply. The advance-loop sidecar (`id`, `question`, `context`, `answered`, `answer`) is exactly this shape — so this need is largely SUBSUMED by building the advance loop. Until then, `status` + `requeue --message` is the scrape-y stopgap.
3. **idea → SPEC → slices automation.** `to-spec` / `to-slices` are SKILLS a human invokes in a session, not `dorfl` subcommands. The very first hop (chat message → SPEC) needs an automated agent launch. The `auto-slice` / advance-loop work already moves slicing into the runner (`do prd:<slug>`); the idea→SPEC hop is the remaining bootstrap. The app's server CAN launch an agent with `to-spec` directly via the harness, but it is outside the current command surface.
4. **Multi-USER orchestration + isolation.** `run` does cross-repo FLEET execution (close to what a server wants), and worktree isolation (ADR §2/§3) helps within a project — but isolating one USER's runs from another's (resource limits, fair scheduling, no starvation) is the APP's job, not dorfl's.

## Where each piece belongs (scope fence)

- **dorfl (the engine):** structured/JSON event output (#1). Everything else it needs for THIS app is the advance-loop work, captured separately.
- **The advance loop (its own idea/SPEC):** the typed question/answer protocol (#2) and the autonomous idea-pool draining. This app is a FRONTEND of it, not a reason to build a second question mechanism.
- **The app layer (beside dorfl, not inside it):** the chat UI, the side preview / live artifact serving, idea→SPEC launch glue, and multi-user orchestration (#3 glue + #4). Sits BESIDE the runner.

## Open questions to resolve before it becomes a SPEC

- **Sequencing vs the advance loop.** This is most coherent AFTER the advance-loop engine + its question sidecar exist (then the chat is a thin renderer). Built before, the app would have to invent the question protocol the advance idea already designed — duplicating it. Strong lean: **advance-loop first, this app as its frontend.** Confirm.
- **Does it reverse a locked scope decision?** Like the dashboard idea, the original SPEC scoped OUT a web UI / HTTP control surface. This is a CONTROL surface (runs agents / mutates git from web requests) — the heavier, security-laden half the dashboard idea deferred. Promotion is a conscious revisit of that boundary.
- **Demo vs product.** Maintainer framing was "a demo is fine." A demo (single user, one project, server-side, structured events rendered to chat) is a tractable SPEC; a multi-user product (#4) is much larger. Lean: demo first.
- **Auth / blast radius.** Running agents + mutating git from web requests is the security surface the dashboard idea flagged. Even a demo needs a clear story (trusted single-user demo vs anything exposed).

## Why not now

Maintainer call: not the right time — the conversation's goal was to probe dorfl's fit and gaps, not to build. It also depends on the advance-loop engine (its natural substrate) and on structured event output (the one engine change it implies). When it ripens, sequence it AFTER advance-loop and promote to `work/spec/<slug>.md` (a thin north-star), consciously revisiting the "no web control surface" boundary, then slice against that.
