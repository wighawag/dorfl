#!/usr/bin/env bash
#
# ar-run.sh — drive ONE work slice through the full loop, by hand.
#
#   claim+onboard (start) -> generate prompt -> run agent (pi -p) -> gate+integrate
#   (complete) -> tidy the local work branch.
#
# SUPERSEDED BY `agent-runner do <slug>` (the in-place worker — THE CI COMMAND).
# As of the `do-in-place` slice, `do <slug>` IS this script, in code: it refuses
# on a dirty tree, then composes start -> (autonomous prompt-fed harness run) ->
# complete IN THE CURRENT CHECKOUT, then exits. `do --propose` (the default) is
# the documented equivalent of `./ar-run.sh <slug> --propose`; `do --merge`
# matches `--merge`. (`do` additionally surfaces a stuck run ON THE ARBITER main,
# which this script does not — a strict improvement for unattended/CI use.)
#
# This script is KEPT (not deleted) as the maintainer's live, battle-tested
# manual driver while `do` proves out and the rest of phase 2 lands; removing it
# is a maintainer-owned follow-up cleanup, not an automatic side-effect. Prefer
# `agent-runner do <slug>` for new use.
#
# This is the MANUAL equivalent of what `agent-runner do <slug>` now automates
# (claim -> isolated agent -> acceptance gate -> integrate). It runs in this repo
# (the monorepo whose `packages/agent-runner` implements the commands).
#
# Usage:
#   ./ar-run.sh <slug> [--propose] [--watch]
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
watch=0
while [ $# -gt 0 ]; do
	case "$1" in
		--propose) integration="propose"; shift ;;
		--merge) integration="merge"; shift ;;
		--watch) watch=1; shift ;;
		-h|--help) sed -n '2,44p' "$0"; exit 0 ;;
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

RAWLOG="/tmp/ar-run-${slug}.jsonl"
if [ "$watch" -eq 1 ]; then
	command -v jq >/dev/null || { echo "error: --watch needs jq." >&2; exit 1; }
	echo ">> [2/4] run agent (watching; raw log -> $RAWLOG)…"
	# json mode streams a live event log: save raw, and surface the high-signal
	# events (tool calls + assistant messages + lifecycle). PIPESTATUS[1] is pi's
	# exit code (tee/jq must not mask it).
	# `set +e` around the pipeline so our explicit PIPESTATUS check runs even when
	# pi exits non-zero (otherwise `set -e` would abort before we can report).
	set +e
	$AR_CLI prompt | pi -p --mode json \
		| tee "$RAWLOG" \
		| jq -rc '
			if .type=="tool_start" then "\u001b[36m▶ " + (.tool // "tool") + "\u001b[0m"
			elif .type=="message_end" and .message.role=="assistant"
				then ((.message.content[]? | select(.type=="text") | .text) // empty)
			elif .type=="agent_end" then "\u001b[32m✓ agent finished\u001b[0m"
			else empty end' 2>/dev/null
	rc=${PIPESTATUS[1]}
	set -e
	[ "$rc" -eq 0 ] || { echo "error: agent run (pi -p --mode json) failed (rc=$rc)." >&2; exit 3; }
else
	echo ">> [2/4] run agent on the slice (pi -p; quiet — use --watch to stream)…"
	$AR_CLI prompt | pi -p || { echo "error: agent run (pi -p) failed." >&2; exit 3; }
fi

echo ">> [3/4] gate + integrate ($integration)…"
# complete runs the acceptance gate; on red it does NOT integrate and leaves the
# item for you (eventually -> needs-attention). It also deletes the local work
# branch when the work is provably on the arbiter.
$AR_CLI complete "--$integration" || {
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
