#!/usr/bin/env bash
#
# ar-run.sh — drive ONE work slice through the full loop, by hand.
#
#   claim+onboard (start) -> generate prompt -> run agent (pi -p) -> gate+integrate
#   (complete) -> tidy the local work branch.
#
# This is the MANUAL equivalent of what `agent-runner run --once` will automate
# (claim -> isolated agent -> acceptance gate -> integrate). It runs in this repo
# (the monorepo whose `packages/agent-runner` implements the commands).
#
# Usage:
#   ./ar-run.sh <slug> [--propose]
#
#     <slug>      the backlog item to run (must be eligible / claimable)
#     --propose   integrate in propose mode (push a branch + open review) instead
#                 of the default `merge` (direct to main). Use propose for work you
#                 want to review before it lands; merge for trusted/low-risk work.
#
# Safety: this is the autonomous loop run by hand. The acceptance gate inside
# `complete` (verify) is the trust boundary — a red gate means the work is NOT
# integrated and is left for you. `--propose` keeps a human review step.
#
# Notes:
# - A child process cannot cd your parent shell, so this is a SCRIPT (its internal
#   cd affects only itself) — execute it, don't source it.
# - The CLI is invoked via `node packages/agent-runner/dist/cli.js` (not a global
#   `agent-runner` binary, which may not be on PATH). Override with AR_CLI=...
#   Requires a built dist (`pnpm -r build`). `pi` must be on PATH; `pi -p` runs
#   non-interactively and exits — it prints little, so a long run can look idle.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# How to invoke the agent-runner CLI (overridable; defaults to the built dist).
AR_CLI="${AR_CLI:-node $REPO/packages/agent-runner/dist/cli.js}"

slug=""
integration="merge"
while [ $# -gt 0 ]; do
	case "$1" in
		--propose) integration="propose"; shift ;;
		--merge) integration="merge"; shift ;;
		-h|--help) sed -n '2,40p' "$0"; exit 0 ;;
		-*) echo "unknown flag: $1" >&2; exit 1 ;;
		*) [ -z "$slug" ] && slug="$1" || { echo "unexpected arg: $1" >&2; exit 1; }; shift ;;
	esac
done
[ -n "$slug" ] || { echo "usage: ./ar-run.sh <slug> [--propose]" >&2; exit 1; }

cd "$REPO"

# Refuse on a dirty tree — start/claim need a clean tree, and we don't want to
# entangle unrelated changes with the slice.
if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "error: working tree is dirty — commit/stash before running a slice." >&2
	exit 1
fi

echo ">> [1/4] claim + onboard: $slug"
$AR_CLI start "$slug" || { echo "error: start/claim failed (lost the race? not eligible?)." >&2; exit 2; }

echo ">> [2/4] run agent on the slice (pi -p; quiet while it works)…"
$AR_CLI prompt | pi -p || { echo "error: agent run (pi -p) failed." >&2; exit 3; }

echo ">> [3/4] gate + integrate ($integration)…"
# complete runs the acceptance gate; on red it does NOT integrate and leaves the
# item for you (eventually -> needs-attention). It also deletes the local work
# branch when the work is provably on the arbiter.
$AR_CLI complete --integration "$integration" || {
	echo "error: complete failed (red gate? rebase conflict?). The slice was NOT" >&2
	echo "       integrated; resolve it (it stays in work/in-progress/)." >&2
	exit 4
}

echo ">> [4/4] done."
# Belt-and-suspenders branch tidy (until complete auto-deletes per the
# complete-integration-flag slice): drop the local work branch if it's fully
# merged. Harmless no-op if complete already removed it.
git switch main --quiet 2>/dev/null || true
git branch -d "work/$slug" 2>/dev/null || true

echo ">> ✓ '$slug' completed via '$integration'."
