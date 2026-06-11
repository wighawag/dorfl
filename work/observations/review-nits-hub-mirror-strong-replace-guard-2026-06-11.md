---
title: review-gate non-blocking nits for 'hub-mirror-strong-replace-guard' (Gate 2 approve)
date: 2026-06-11
status: open
slug: hub-mirror-strong-replace-guard
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'hub-mirror-strong-replace-guard' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: widening the guard from transport-mismatch to any project-identity collision also tightens the bulk `remote find` discovery path (cli.ts ~line 2229), which now skips an already-registered project under a DIFFERENT key where the old transport-only guard might have admitted a same-transport collision. ReplaceWouldStrandWorkError extends RegistryError so it is caught and skipped there too — but that path never passes force, so only the (benign) POLICY block can fire. Intended?
  (This is a cross-surface effect the slice did not call out explicitly. It is the correct, safe behaviour (skip-with-message rather than fork), but it changes what `remote find --yes` adds in a multi-key-per-project setup. The inline comment there still reads 'The transport guard still applies', which is now stale terminology for the project-identity guard.)
- Ratify the REPLACE ordering: on a safe `--force`, the prior sibling mirror is remoteRm'd (rmSync of the bare mirror dir) BEFORE ensureMirror creates the new one. If ensureMirror failed mid-way (e.g. the new arbiter URL is unreachable), the project would be left with neither the old nor the new mirror registered. The data-loss guard guarantees no un-pushed WORK is lost (every worktree is clean+reachable first), so this is a re-registration inconvenience, not data loss — but the window exists.
  (An alternative would be create-then-swap (provision new, then remove old) so a failed clone leaves the old mirror intact. Given the data-loss predicate already ran, the practical blast radius is small; flagging for the human to ratify the delete-first choice rather than block.)
- Awareness: this slice widens the consequence of projectIdFromKey's last-two-segments ('org/name' tail) identity. Two genuinely-different projects that share the same trailing 'group/repo' under different parent paths (e.g. self-hosted gitlab.example.com/teamA/svc vs gitlab.example.com/teamB/svc) collapse to the same projectId and would now be treated as the same project — blocked by default, and replaceable under --force. The data-loss guard still prevents work loss, and this tail-collision property pre-dates this slice (the cheap guard used it too), but the surface it now gates (destructive REPLACE) is larger.
  (projectIdFromKey (registry.ts ~line 91) returns segments.slice(-2). Not introduced here, but the slice escalates its stakes from 'block second transport' to 'offer destructive replace'. No action required unless self-hosted deep-path arbiters are in scope; raised so the human is aware of the inherited collision model.)
