#!/usr/bin/env bash
#
# claim.sh — atomically claim a work/backlog/<slug>.md item.
#
# Implements the compare-and-swap claim protocol from ../CLAIM-PROTOCOL.md:
# branch off the arbiter's main, `git mv` the item backlog/ -> in-progress/,
# then push that single claim commit to the arbiter's main with a CAS push.
# The arbiter (a remote, by NAME) serializes the ref update, so only one
# concurrent claim of the same slug can win; losers are rejected and told
# whether they lost the item or main merely advanced.
#
# Works with EITHER a real remote (e.g. GitHub) or a local --bare remote
# (offline). It targets the remote by name; the URL is irrelevant here.
#
# Usage:
#   scripts/claim.sh <slug> [--arbiter <remote>] [--by <who>] [--retries N] [--dry-run]
#
# Defaults: --arbiter origin   --by "$(git config user.name || whoami)"   --retries 3
#
# Exit codes:
#   0  claim landed (you now own work/in-progress/<slug>.md on the arbiter's main)
#   1  usage / environment error
#   2  item not claimable (not in backlog, or lost the race to someone else)
#   3  push kept failing after retries (transient/contended — try again later)
#
# After a successful claim, start work on a NEW branch off the updated main:
#   git fetch <arbiter> && git switch -c work/<slug> <arbiter>/main
# and on completion `git mv work/in-progress/<slug>.md work/done/<slug>.md` in
# that work branch's PR/merge.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
note() { echo ">> $*" >&2; }

SLUG=""
ARBITER="origin"
BY=""
RETRIES=3
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --arbiter) ARBITER="${2:?--arbiter needs a value}"; shift 2;;
    --by)      BY="${2:?--by needs a value}"; shift 2;;
    --retries) RETRIES="${2:?--retries needs a value}"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) sed -n '2,40p' "$0"; exit 0;;
    -*)        die "unknown flag: $1";;
    *)         [ -z "$SLUG" ] && SLUG="$1" || die "unexpected arg: $1"; shift;;
  esac
done

[ -n "$SLUG" ] || die "missing <slug>. usage: scripts/claim.sh <slug> [--arbiter remote] [--by who]"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"
git remote get-url "$ARBITER" >/dev/null 2>&1 || die "no git remote named '$ARBITER' (set one, or pass --arbiter)"
[ -n "$BY" ] || BY="$(git config user.name 2>/dev/null || whoami)"

BACKLOG="work/backlog/${SLUG}.md"
INPROGRESS="work/in-progress/${SLUG}.md"
CLAIM_BRANCH="claim/${SLUG}"

# Refuse to run with a dirty tree — the claim must be a clean, isolated commit.
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "working tree has uncommitted changes; commit/stash them before claiming"
fi

ORIG_REF="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
cleanup() {
  # best-effort: return to where we were and drop the throwaway claim branch
  git checkout --quiet "$ORIG_REF" 2>/dev/null || true
  git branch -D "$CLAIM_BRANCH" 2>/dev/null || true
}

attempt() {
  git fetch --quiet "$ARBITER"

  # Is the item still claimable on the arbiter's main?
  if ! git cat-file -e "${ARBITER}/main:${BACKLOG}" 2>/dev/null; then
    if git cat-file -e "${ARBITER}/main:${INPROGRESS}" 2>/dev/null; then
      note "'${SLUG}' is already in-progress on ${ARBITER}/main — someone claimed it. Pick another item."
    else
      note "'${BACKLOG}' not found on ${ARBITER}/main (already done/removed, or wrong slug)."
    fi
    return 2
  fi

  # Fresh claim branch off the latest arbiter main.
  git branch -D "$CLAIM_BRANCH" 2>/dev/null || true
  git checkout --quiet -b "$CLAIM_BRANCH" "${ARBITER}/main"

  # The backlog file must exist in THIS checkout (it does — we verified it on
  # ${ARBITER}/main and branched from there). Make the destination dir exist,
  # then move. A failed move must abort this attempt, not silently continue.
  mkdir -p "$(dirname "$INPROGRESS")"
  git mv "$BACKLOG" "$INPROGRESS" || die "git mv failed for '${BACKLOG}' (unexpected — aborting claim)"

  # Advisory only (NOT the source of truth — folder + history are). Stamp if present.
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if grep -q '^claimed_by:' "$INPROGRESS" 2>/dev/null; then
    # portable in-place edit (BSD/GNU): rewrite the two advisory lines
    tmp="$(mktemp)"
    sed -e "s|^claimed_by:.*$|claimed_by: ${BY}|" -e "s|^claimed_at:.*$|claimed_at: ${TS}|" "$INPROGRESS" >"$tmp"
    mv "$tmp" "$INPROGRESS"
    git add "$INPROGRESS"
  fi

  git commit --quiet -m "claim: ${SLUG} (by ${BY})"

  # Sanity: the claim commit MUST be a real child of the arbiter main we branched
  # from (i.e. it actually changed something). Guards against a no-op claim that
  # would make an "Everything up-to-date" push look like a successful claim.
  base="$(git rev-parse "${ARBITER}/main")"
  head="$(git rev-parse HEAD)"
  [ "$head" != "$base" ] || die "claim commit is a no-op (nothing moved) — aborting"
  [ "$(git rev-parse 'HEAD^')" = "$base" ] || die "claim is not a direct child of ${ARBITER}/main — aborting"

  if [ "$DRY_RUN" -eq 1 ]; then
    note "[dry-run] would: git push ${ARBITER} ${CLAIM_BRANCH}:main --force-with-lease=main:${ARBITER}/main"
    return 0
  fi

  # The atomic compare-and-swap: only fast-forwards main; concurrent claims are rejected.
  # --force-with-lease asserts main hasn't moved since our fetch (CAS), never clobbers.
  # The atomic compare-and-swap. --force-with-lease=main:<base> asserts the
  # arbiter's main is STILL <base> (unchanged since our fetch); the push then
  # fast-forwards main to our claim. If main moved, the lease fails -> rejected.
  if git push "$ARBITER" "${CLAIM_BRANCH}:main" --force-with-lease="main:${base}"; then
    # Verify the arbiter main now points at OUR claim (not merely "up-to-date").
    git fetch --quiet "$ARBITER"
    if [ "$(git rev-parse "${ARBITER}/main")" = "$head" ]; then
      note "CLAIMED '${SLUG}' -> work/in-progress/ on ${ARBITER}/main."
      note "Start work:  git fetch ${ARBITER} && git switch -c work/${SLUG} ${ARBITER}/main"
      return 0
    fi
    note "push reported success but ${ARBITER}/main is not our claim — treating as rejected."
  fi
  return 10  # push rejected / lease failed — caller decides retry vs. give up
}

trap cleanup EXIT

i=0
while :; do
  set +e
  attempt
  rc=$?
  set -e
  case "$rc" in
    0) trap - EXIT; git checkout --quiet "$ORIG_REF" 2>/dev/null || true
       git branch -D "$CLAIM_BRANCH" 2>/dev/null || true
       exit 0;;
    2) exit 2;;                      # not claimable / lost the item — definitive
    10)
       i=$((i+1))
       if [ "$i" -gt "$RETRIES" ]; then
         note "push rejected ${i} times (main is contended). Try again shortly."
         exit 3
       fi
       note "main advanced under us — refetch and retry (${i}/${RETRIES})..."
       # loop: next attempt() re-checks claimability, so if we now LOST the item it returns 2
       sleep 1;;
    *) die "unexpected failure (rc=$rc)";;
  esac
done
