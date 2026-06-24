---
title: an `approve`/`land` runner verb seamed over the git-host provider (approve-with-comment, fallback comment+merge) — so the conductor stops reaching around the runner to raw `gh`
slug: approve-verb-seamed-over-host-provider
type: idea
status: incubating
---

# `approve` — land a reviewed branch THROUGH the provider seam, not raw `gh`

> Captured 2026-06-11 from a design chat about `drive-backlog`. The conductor's
> Gate-3 merge step shells out to `gh pr comment` + `gh pr merge` DIRECTLY (skill
> golden rule 4 + step 4c), which (a) hardcodes GitHub and (b) bypasses the
> runner's provider + identity wiring. The skill itself already flags this — step
> 4c's "PROVIDER ASSUMPTION" note anticipates "a likely future `dorfl`
> command, e.g. an `approve`/`land` verb". This is that idea, sharpened. NOT built.

## The signal

`drive-backlog` is the ONE skill that leans on the runner CLI directly, and for
the BUILD step it does the right thing — it calls `dorfl do`, which runs
the whole claim→build→gate→PR flow through the runner (provider-agnostic,
identity-aware). But for the final APPROVE+MERGE step it reaches AROUND the
runner and calls `gh` itself:

```sh
gh pr comment <n> --body-file …      # the verdict
gh pr merge <n> --squash --delete-branch
```

That is the only part of the conductor's loop the runner doesn't own. Two costs:

1. **GitHub-hardcoded.** `gh` only exists for a GitHub arbiter. A non-GitHub or
   local `--bare` arbiter has no `gh` at all, so this step simply doesn't port —
   even though the runner ALREADY has a provider abstraction (`ReviewProvider` in
   `integrator.ts`, with `GitHubProvider` / `NoneProvider`) that the build path
   uses to stay provider-agnostic.
2. **Reaches around the runner.** Because it's a raw `gh` call from the skill, it
   runs under whatever ambient `gh` auth the shell has — outside the runner's
   `identityEnv()` wrapping that every runner-spawned `git`/`gh` goes through.

## The idea

Add a runner verb — `approve` (or `land`) — that takes a reviewed branch/PR + a
verdict body and lands it, **seamed over the git-host provider** exactly like
`openRequest` / `postPRComment` already are. The skill's step 4c then becomes a
single `dorfl approve …` instead of two raw `gh` calls.

**The approve mechanics live INSIDE the provider** (a new sibling method on
`ReviewProvider`, next to `openRequest` + `postPRComment`):

- **Attempt approve-with-comment first** — the native "review + APPROVE" action
  (`gh pr review --approve --body …`), which records a real review approval, not
  just a comment.
- **Fall back to comment + merge** — when approve-with-comment is refused. The
  KNOWN refusal (skill golden rule 4): GitHub rejects `gh pr review --approve` on
  a PR whose commits are under YOUR OWN identity. So the fallback posts the
  verdict as a `gh pr comment` and then `gh pr merge`s — today's behaviour,
  preserved as the degrade path.
- **`none` provider degrades** like the rest of the seam (no API → surface the
  verdict text in the result `instruction`, never lose it — ADR §6).

## Why the provider is the right home

`integrator.ts`'s `ReviewProvider` already models exactly this surface:
`openRequest` writes the PR creation body, `postPRComment` writes a follow-up
comment. An approve/land method is the THIRD verb on the same "act on the review
request" seam — same shape, same degrade contract (never throw; degrade to
instruction text), same place GitHub-specific `gh` knowledge is already
quarantined. Putting it there means non-GitHub providers can implement their own
approve/merge, and `none` degrades gracefully — the skill stops needing to know
the arbiter is GitHub.

## `approve` is the FIRST of an authenticated-verb FAMILY

The moment `approve` exists, the same logic applies to every OTHER authenticated
host-provider / git action a conductor or an in-conversation agent needs:
`commit`, `push`, generic `gh`-write actions (comment, label, close), etc. The
real concept is not "an approve verb" — it is **a family of authenticated runner
verbs** that runs an action THROUGH the runner's provider + identity wiring,
instead of the caller reaching for raw `git`/`gh`. `approve` is just the first
and most-needed member (it unblocks `drive-backlog`'s merge step). The verb
FAMILY and WHO it runs as is the companion idea
`assistant-identity-and-authenticated-verbs`; THIS note is the provider-seam
mechanics of the approve member specifically.

## The identity payoff is a SIDE EFFECT, not the motive

Moving this into the runner makes the comment/merge run through `identityEnv()`
for free — but that is NOT the reason to do it, and it interacts with a real
question about WHO should be acting (see the companion idea
`assistant-identity-and-authenticated-verbs`). The PRIMARY motive HERE is
provider-agnosticism: get the GitHub `gh` knowledge out of the skill and behind
the seam that already exists. The identity question (should approve run as the
bot, the human, or a distinct assistant identity?) is SEPARATE and is decided by
which identity the verb family is wired to — handled in that companion idea, not
here.

## See also

- `assistant-identity-and-authenticated-verbs` — the verb FAMILY this is the
  first member of, the `assistant` identity it runs as, and the skill-redirect
  that makes agents USE it instead of raw `git`/`gh`.
- `command-prefix-by-actor-type` — the human/agent/assistant actor split this
  verb participates in at the naming layer.

## Open questions before a PRD

- **Verb name + scope.** `approve` (just records approval/comment) vs `land`
  (approve + merge + delete-branch) vs both. The skill needs approve+merge in one
  go, so a single verb that does the whole landing is the ergonomic target — but
  name it for what it does.
- **Where does it sit in the human/agent command split?** It is conceptually a
  HUMAN/conductor verb (the second-party approval of the bot's work), which bears
  on the identity question and on `command-prefix-by-actor-type`.
- **Input surface.** By slice slug (`approve slice:<slug>`, runner resolves the
  PR from the branch) vs by raw PR number/url. Slug-native matches the rest of
  the runner; PR-number is what `gh` wants. Probably resolve slug→branch→PR
  internally so the skill stays slug-native.
- **`--merge` mode (no PR).** In direct-integration mode there is no PR to
  approve — `approve` should no-op / degrade cleanly there (the verdict goes to
  the slice/observation, as the skill already notes).
