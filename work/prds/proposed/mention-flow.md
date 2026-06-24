---
title: mention-flow - an @dorfl conversational front-door (advise first, dispatch verbs later)
slug: mention-flow
humanOnly: true
needsAnswers: true
taskedAfter: [runner-in-ci, issue-intake]
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

<!-- open-questions -->
<!--
  TRANSIENT BLOCK — stripped by the apply rung on full resolution.
  While the spec has unresolved questions blocking autonomous tasking:
    1. Set `needsAnswers: true` in the frontmatter above.
    2. List the questions under the `## Open questions` heading below.
    3. Clear the flag (and let apply strip this block) once they are answered.
  Delete the whole fenced block — markers and all — if the prd launches fully resolved.
-->

## Open questions

1. **Bare-mention default intent.** When the body is just `@dorfl` with no instruction, what is the default? Proposed: advise/summarise the issue or thread (matching the interactive default of comparable tools), NOT "ask the user what they want". Confirm or override.
2. **Flow B confirmation model.** When a TRUSTED mentioner says `@dorfl file a task` / `@dorfl fix this`, does the dispatch fire IMMEDIATELY, or does `@dorfl` always PROPOSE-and-wait-for-a-thumbs-up first? Proposed: dispatch may fire immediately for a trusted mentioner when the resolved integration mode is itself non-merging (i.e. it would open a PR / write to a staging pool anyway, so the human checkpoint is still ahead); anything that would land on `main` always asks first. Confirm the exact line.
3. **Mention authorisation floor.** Who may summon `@dorfl` AT ALL (as distinct from who may make it MUTATE)? Proposed: the advisory flow (Flow A) is open to anyone who can comment (it only posts a comment); a configurable allow-list governs whether bot accounts may summon it. Mirrors the `allowed_bots` / `allowed_non_write_users` posture of comparable actions. Confirm whether advisory should also be gateable to write-collaborators-only for a private/locked-down repo.
4. **Trigger phrase configurability + collision.** The phrase defaults to the brand base (`@dorfl`) and is configurable. Confirm the config key name and that a repo may set a different phrase (e.g. to avoid colliding with an unrelated `@dorfl` GitHub account that the maintainer does not own — the account-ownership constraint recorded in Further Notes).

<!-- /open-questions -->

## Problem Statement

Today every autonomous capability is reached by an explicit CLI verb (`do`, `advance`, `intake`, `gc`) wired to a CI trigger. The only issue-thread-native front-door is `intake`, and it does exactly one thing: turn an issue into a `work/` artifact (task / prd) or refuse (ask / bounce). There is no way for a human on a thread to simply *address the agent* — "@dorfl, what do you think of this?", "@dorfl, is this a real bug?", "@dorfl, summarise where this PR stands", "@dorfl, if this is worth doing, file a task" — and get a useful response without forcing the interaction through the issue→artifact transform.

Comparable tools (e.g. Claude's GitHub action) expose this as an `@mention` in a comment: a configurable trigger phrase the workflow detects, optionally backed by a GitHub App for identity. Crucially, that `@mention` is NOT a GitHub primitive — it is a string the workflow greps for in the event payload (`contains(comment.body, '@claude')`), exactly the kind of detection `intake.yml` already does. So the front-door is cheap to add; the design questions are about what the agent DOES once summoned, and how trust composes when a public commenter can summon it.

I want a conversational front-door — `@dorfl` in an issue/PR comment — that, by default, **advises** (reads context, posts an answer, writes nothing) and that can, as an explicit and trust-gated action, **dispatch the existing verbs** (file a task, slice a prd, build, reap) by triggering their workflows. The agent stays the mouth; the existing verbs stay the hands.

## Solution

Add `@dorfl` as a distinct issue/PR-thread conversation — NOT a second spelling of `intake`. From the user's perspective:

- **Mention `@dorfl` in a comment (or issue body) with a question/instruction.** A CI workflow detects the configurable trigger phrase and invokes a new conversational entry point.
- **Default behaviour is advisory (Flow A): the agent reads the issue/PR + thread (and, where useful, repo context), then posts a reply.** It writes nothing to `work/`, opens no PR, changes no git state. Advice is just a comment, so it carries none of the merge/trust risk of the autonomous paths.
- **On an explicit, recognised instruction, the agent may RECOMMEND dispatching a verb (Flow B), and the runner — not the agent — performs the dispatch**, subject to the SAME merge-vs-propose + author-trust policy `runner-in-ci` already defines. "@dorfl file a task for this" from a trusted maintainer can fan out to `intake`/`do`; from an untrusted commenter it can at most PROPOSE (never auto-land on `main`).
- **It is a conversation, so it resumes safely across turns** without going deaf: a new `@dorfl` mention always re-engages, and the agent never loops on its own replies.
- **Identity is the existing `config.identity`** (which already defaults to the name `dorfl`): `@dorfl` replies/commits appear as the configured bot, App-optional. The trigger PHRASE (`@dorfl`) is decoupled from whatever GitHub ACCOUNT actually posts, so the maintainer not owning the `dorfl` GitHub username does not block any of this.

The keystone deliverable is **Flow A (advisory, write-nothing)**, because it reuses the read side of machinery that already exists and sidesteps the entire trust-to-merge problem. Flow B (verb dispatch) and PR-surface support are later, separable slices that lean on `runner-in-ci`'s trust policy.

## User Stories

1. As a maintainer, I want to mention `@dorfl` in an issue comment and get a useful reply (answer, opinion, summary) posted back to the thread, so I can consult the agent without filing or transforming anything.
2. As a contributor, I want `@dorfl` to answer a question about the codebase/architecture in the thread I'm already in, so I get help in context.
3. As a maintainer, I want `@dorfl` with no instruction (a bare mention) to do a sensible default (summarise/advise on the current issue or PR), so the lightest-weight interaction still works.
4. As a maintainer, I want `@dorfl`'s advisory replies to write NOTHING to `work/`, open no PR, and change no git state, so summoning it on a public thread is risk-free.
5. As a maintainer, I want `@dorfl` to be a DISTINCT conversation from `intake` — its own resumption markers, its own non-terminal semantics — so a thread that `intake` already transformed (stamped `created`/`bounced`) can still hold an `@dorfl` conversation, and an `@dorfl` reply never accidentally drives intake's triage (or vice versa).
6. As a maintainer, I want a new `@dorfl` mention to ALWAYS re-engage the conversation, and `@dorfl` to NEVER loop on its own replies, so the conversation resumes correctly turn after turn.
7. As a maintainer, I want the trigger phrase to be CONFIGURABLE (default the brand base, `@dorfl`), so I can change it to avoid colliding with an unrelated GitHub account or to match my own branding.
8. As a maintainer, I want `@dorfl` to be able to RECOMMEND and (when authorised) DISPATCH the existing verbs — "file a task", "slice this prd", "look at this", "reap merged branches" — so the conversational front-door becomes a human-friendly way to drive the verb set, not a sixth bespoke capability.
9. As a maintainer, I want any MUTATING dispatch `@dorfl` performs to obey the EXISTING merge-vs-propose + author-trust policy (`runner-in-ci`): an untrusted mentioner can at most cause a PROPOSE (a PR / a staging-pool write), never an auto-merge to `main`; the fully-gateless path is a loud, non-default opt-in, so opening the conversational front-door does not open a new privilege-escalation path.
10. As a maintainer, I want the AGENT to only DRAFT (the reply text + a recommended action); the RUNNER owns every side-effect (posting the comment, and any verb dispatch), so the in-band agent/runner boundary the build/intake paths keep is preserved here too.
11. As a maintainer, I want `@dorfl` to dispatch other workflows via GitHub's real primitives (`workflow_dispatch` / `repository_dispatch`) rather than an invented mechanism, so the dispatch path is observable, permission-scoped, and standard.
12. As a maintainer, I want `@dorfl` to work on PULL REQUESTS too (PR comments, review comments) — at least advisorily — so I can ask it to summarise/critique a PR; I accept that PR-thread resumption inherits the documented edit-blind / lock-lossy caveats until those are fixed engine-side.
13. As a maintainer, I want `@dorfl` replies/commits to appear under the configured `config.identity` bot (App-optional), with the trigger phrase decoupled from the posting account, so identity and triggering stay orthogonal and not owning the `dorfl` GitHub account is not a blocker.
14. As a maintainer, I want a configurable authorisation FLOOR for who may summon `@dorfl` at all (separate from who may make it mutate), with conservative defaults, so a public repo is not abusable.

### Autonomy notes (the two gate axes — set the frontmatter flags accordingly)

- **`humanOnly: true` (DECIDED):** like `runner-in-ci` and `issue-intake`, this PRD lands CI workflows + an issue-front-door trust surface and composes with `runner-in-ci`'s author-trust policy. A human should drive the TASKING. As with `runner-in-ci`, this does NOT propagate to the slices — a pure advisory entry point with a stubbed-seam test may well be agent-buildable; the workflow-writing / trust-policy slices will lean `humanOnly`. That is `to-slices`' per-slice call.
- **`needsAnswers: true` (DISCOVERED):** four open questions block autonomous tasking (above). They are genuine forks (default intent, the dispatch confirmation line, the summon floor, the phrase config), not cosmetic — tasking on a guess would cut the wrong slices.

## Implementation Decisions

(Made with the maintainer. Do not relitigate.)

- **`@dorfl` is its own conversation, NOT a second `intake`.** It gets its OWN marker namespace (the brand-derived token, e.g. `${brand.base}:mention`, exactly as `intake` uses `${brand.base}:intake`), so the two conversations never collide and neither inherits the other's resumption/terminal semantics. This is load-bearing: intake's triage SKIPS a thread once it stamps a TERMINAL `created`/`bounced` marker (`intake-triage.ts`, branch 2), so reusing intake's namespace would make a transformed thread go deaf to `@dorfl`.
- **Reuse the MACHINERY, not the VOCABULARY.** The `IssueProvider` seam (read + `postIssueComment`), the hidden-HTML-comment marker primitive, the `seen=<ids>` watermark, and the deterministic pre-decision triage are all flow-agnostic and are REUSED. What is NOT reused is intake's transform-shaped marker vocabulary (`ask|bounced|created`) and its terminal split — the advisory flow needs a NON-TERMINAL kind (e.g. `advised`) so the thread never goes deaf and a new mention always re-engages.
- **Flow A (advisory) writes nothing.** It uses ONLY the read methods + `postIssueComment`. No integration, no claim CAS, no placement resolver, no merge-vs-propose derivation — because nothing autonomous happens downstream. This is the keystone slice precisely because it sidesteps the whole trust-to-merge surface.
- **Flow B (dispatch) routes through the EXISTING trust policy.** The advisory agent DRAFTS a reply + an optional recommended action; the RUNNER decides whether/how to dispatch using `runner-in-ci`'s merge-vs-propose + author-trust resolver (the same one whose author-trust axis is the open `needsAnswers` in `runner-in-ci`). A mention is a NEW value on that PRD's already-identified "request channel" axis (command vs every-issue), not new trust plumbing. Untrusted mentioner ⇒ propose-only; fully-gateless ⇒ loud opt-in.
- **Dispatch uses GitHub-native `workflow_dispatch` / `repository_dispatch`** (both already named as supported triggers in `runner-in-ci`), OR a direct in-job verb invocation for cheap actions. The runner owns the dispatch; the agent never shells a verb.
- **Identity is `config.identity` (defaults to `dorfl`), App-optional.** The trigger phrase is a configurable string defaulting to the brand base, decoupled from the posting account. A custom GitHub App (branded one-click install + CI-re-trigger on the bot's commits) is a SEPARATE, later concern and is OUT OF SCOPE here.
- **The CI job never edits `.github/workflows/**`** (inherits `runner-in-ci` US #9): the mention workflow requests no `workflows` permission and cannot rewrite its own triggers. It needs `issues: write` (post the reply) and, for Flow B, whatever the DISPATCH target needs (which is the dispatched workflow's concern, not this job's).
- **The intent ROUTER is the genuinely new logic.** Unlike intake's fixed four-way classify, `@dorfl` turns open-ended mention text into an intent (`advise` default, or `dispatch <verb>`). It is the conceptual heart and the main testable seam (a stubbed router → dispatcher, mirroring intake's stubbed-verdict → dispatcher discipline).

## Testing Decisions

- **Mirror intake's seam discipline.** The decision/router is the testable seam: inject a CANNED intent (no model/network) and assert the dispatch — exactly as `intake`'s tests inject a canned verdict and assert the four-outcome dispatch. The router's JUDGEMENT is not unit-tested (like intake's prompt judgement is not); only the dispatch.
- **Stub the `IssueProvider`** (in-memory issue/thread, recorded comments) — the same stub style `intake-lone-task-review.test.ts` / `close-job.test.ts` already use. No `gh`, no network.
- **Marker isolation is a behavioural test:** an `@dorfl` reply must NOT be seen by intake's triage and intake's markers must NOT re-engage `@dorfl`; assert the two namespaces are disjoint and a terminal intake marker does not silence `@dorfl`.
- **Workflow artifacts** (the generated mention workflow + its trigger-phrase detection + permissions) are tested by generating into a `--fake` dir and asserting structure, reusing the `install-ci` / `intake-trigger-template` validator style (presence/shape assertions over raw YAML, no live Actions run).
- **The advisory flow's write-nothing guarantee is a test:** assert Flow A performs zero git ops and no `work/` writes (only a `postIssueComment`).

## Out of Scope

- **A custom Dorfl GitHub App** (branded one-click install, dedicated bot account, CI-re-trigger on the bot's commits). Orthogonal identity/distribution concern; `config.identity` covers the engineering need. Its own later PRD. (Account-ownership constraint noted below.)
- **The merge-vs-propose + author-trust RESOLVER itself.** That is `runner-in-ci`'s open `needsAnswers`; this PRD CONSUMES it (adding the "command" request-channel value) and must `taskedAfter`/`blockedBy` the slice that lands it. It does not re-implement trust.
- **The verbs `@dorfl` dispatches** (`intake`/`do`/`advance`/`gc`). Built/owned elsewhere; this PRD only TRIGGERS them.
- **Flow C (implement → produce a PR).** Conceptually just Flow B with the heaviest verb and strictest gate; deferred until A and B exist.
- **Fixing the intake edit-blind / lock-lossy resumption gap.** Documented in `runner-in-ci`'s slice-readiness notes; the engine fix is intake's. PR-surface `@dorfl` (US #12) inherits the caveat until then.
- **Non-GitHub providers.** GitHub first; the `IssueProvider` seam keeps others possible without a rewrite.

## Further Notes

- **Account-ownership constraint (recorded):** the maintainer does NOT own the `dorfl` GitHub account (owned by an inactive third party); they own `dorfl-agent`. This does NOT block the feature: the trigger phrase `@dorfl` is just a string the workflow greps and need not resolve to any account; the posting bot can be backed by `dorfl-agent` or a future App named with an available slug. The mismatch ("type `@dorfl`, replies come from `dorfl-agent[bot]`") is cosmetic and common. Open question 4 keeps the phrase configurable so a repo can avoid the dormant account entirely.
- **Why advisory-first is the right keystone:** it is the read side of everything that already ships and carries none of the autonomous-mutation trust burden, so it delivers the headline UX ("address the agent on a thread") at minimal risk and seeds the marker/triage isolation that Flow B then builds on.
- **Prior art to read at slicing time:** `src/intake.ts` (decision→dispatch shape, the agent-drafts/runner-acts boundary), `src/intake-marker.ts` + `src/intake-triage.ts` + `src/intake-event.ts` (the resumption machinery to reuse, the vocabulary NOT to reuse), `src/issue-provider.ts` (the seam), `src/identity.ts` (the bot identity, default name `dorfl`), `src/intake-trigger-template.ts` + `install-ci-github.ts` (the trigger-workflow generator + validator to mirror), and `runner-in-ci`'s merge-vs-propose + author-trust policy (the trust resolver to consume).
- **Comparable reference:** the `anthropics/claude-code-action` shape — configurable `trigger_phrase` (default `@claude`) decoupled from `bot_name` (`claude[bot]`), `allowed_bots` / `allowed_non_write_users` summon gates, and an auto-detected interactive (mention) vs automation (prompt) mode — is the closest external prior art for the front-door UX and the summon-trust posture.
- Slice this PRD with `to-slices`. Natural first slice: **Flow A advisory** (read seam + a non-terminal `advised` marker + the intent router's `advise` default + a `--fake`-tested mention workflow), then **Flow B dispatch** (`taskedAfter` the `runner-in-ci` author-trust slice), then **PR-surface** support (the url-keyed comment seam, inheriting the resumption caveat).
