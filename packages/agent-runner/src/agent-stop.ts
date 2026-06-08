import {runAsync} from './git.js';
import {JOB_RECORD_FILENAME} from './workspace.js';

/**
 * **The build-agent → runner REPORTING CHANNEL** (slice `agent-stop-signal`).
 *
 * A build agent reports back to the runner on ONE channel: its FINAL OUTPUT
 * (`LaunchResult.output`, captured as `agent.output`). This module defines the
 * two machine-recognisable verdicts an agent can raise on that channel and the
 * deterministic backstop the runner uses when the agent stopped without one:
 *
 *   1. A HARD **STOP** sentinel ({@link STOP_SENTINEL_OPEN} … {@link
 *      STOP_SENTINEL_CLOSE}): the slice DRIFTED / is ambiguous / rests on a stale
 *      premise, so the agent could not build it. The runner routes the item to
 *      `work/needs-attention/` (the agent's reason VERBATIM) and SKIPS the
 *      acceptance gate + the Gate-2 review (a clean STOP is not a build that
 *      changed nothing). See {@link parseStopSentinel}.
 *   2. A SOFT **`## Decisions`** block ({@link extractDecisionsBlock}): the agent
 *      PROCEEDED but made a non-obvious in-scope decision the slice did not
 *      specify (a cross-slice interaction / a new error/refusal / a user-visible
 *      default). This does NOT stop the build — it just makes the choice visible
 *      for Gate-2 + the human to ratify (it rides the same `agent.output` → PR-body
 *      path the propose-mode summary uses).
 *
 * The sentinel form is documented IN-BAND next to the existing "STOP and report"
 * instruction in the CLAIM-PROTOCOL wrapper (`skills/to-slices/CLAIM-PROTOCOL.md`)
 * so the agent emits the EXACT shape this module parses — the same "agent edits,
 * runner does git" in-band discipline the rest of the protocol uses.
 */

/** The exact opening marker line of the STOP sentinel block. */
export const STOP_SENTINEL_OPEN = '=== SLICE-STOP ===';
/** The exact closing marker line of the STOP sentinel block. */
export const STOP_SENTINEL_CLOSE = '=== END SLICE-STOP ===';

/** A parsed STOP verdict raised by the build agent on its output channel. */
export interface StopSentinel {
	/**
	 * The human-readable STOP reason from INSIDE the block (the specific drift
	 * report). Recorded VERBATIM as the needs-attention reason. Trimmed; never
	 * empty (a sentinel with an empty body still yields a default reason — see
	 * {@link parseStopSentinel}).
	 */
	reason: string;
}

/**
 * Detect the STOP sentinel in an agent's final output and extract its reason.
 *
 * The sentinel is a line `{@link STOP_SENTINEL_OPEN}` followed by the reason prose
 * and a closing `{@link STOP_SENTINEL_CLOSE}` line. The markers must each be on
 * their OWN line (leading/trailing whitespace tolerated) so a passing mention of
 * the marker inside ordinary prose does not trip it. The agent may surround the
 * block with other prose; we read the FIRST complete block.
 *
 * Returns `undefined` when no complete sentinel block is present (the common
 * case: a normal build, a `## Decisions`-only report, or an empty result). When a
 * block is present but its body is empty, the reason degrades to a stable default
 * so the runner still routes honestly.
 */
export function parseStopSentinel(
	output: string | undefined,
): StopSentinel | undefined {
	if (output === undefined || output === '') {
		return undefined;
	}
	const lines = output.replace(/\r\n/g, '\n').split('\n');
	let open = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === STOP_SENTINEL_OPEN) {
			open = i;
			break;
		}
	}
	if (open === -1) {
		return undefined;
	}
	let close = -1;
	for (let i = open + 1; i < lines.length; i++) {
		if (lines[i].trim() === STOP_SENTINEL_CLOSE) {
			close = i;
			break;
		}
	}
	if (close === -1) {
		return undefined; // an unterminated marker is not a complete sentinel.
	}
	const reason = lines
		.slice(open + 1, close)
		.join('\n')
		.trim();
	return {
		reason:
			reason === ''
				? 'the agent raised a SLICE-STOP with no reason (the slice could not be ' +
					'built as written — re-scope or re-claim).'
				: reason,
	};
}

/** The heading that opens the soft `## Decisions` block in an agent's output. */
const DECISIONS_HEADING = '## Decisions';

/**
 * Extract the body of the soft `## Decisions` block from an agent's final output:
 * the prose under a `## Decisions` heading, up to the next `## ` heading or EOF,
 * trimmed. Returns `undefined` when the agent reported no such block (the common
 * case). This is purely informational — it NEVER blocks the build; it is surfaced
 * for review (it already rides the `agent.output` → PR-body path; the caller may
 * also fold it into the review-nits observation).
 */
export function extractDecisionsBlock(
	output: string | undefined,
): string | undefined {
	if (output === undefined || output === '') {
		return undefined;
	}
	const lines = output.replace(/\r\n/g, '\n').split('\n');
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === DECISIONS_HEADING) {
			start = i + 1;
			break;
		}
	}
	if (start === -1) {
		return undefined;
	}
	const body: string[] = [];
	for (let i = start; i < lines.length; i++) {
		if (/^##\s/.test(lines[i])) {
			break;
		}
		body.push(lines[i]);
	}
	const text = body.join('\n').trim();
	return text === '' ? undefined : text;
}

/**
 * The DETERMINISTIC backstop for the STOP sentinel: did the agent leave NO source
 * change at all? An `agent.ok` run that changed NOTHING is NEVER a successful
 * build — treat it as an implicit STOP/no-op and route to needs-attention WITHOUT
 * paying for the gate + Gate-2, even when the agent stopped without (or with a
 * malformed) sentinel.
 *
 * The check has TWO independent signals; the build is empty IFF BOTH say "no
 * source change":
 *
 *   1. **The WORKING TREE** (the primary signal, the common FRESH-build path). At
 *      this point in the pipeline (after the agent returns, BEFORE the gate /
 *      done-move) the runner has committed nothing of the agent's work — for a
 *      FRESH build the work branch HEAD is still the CLAIM commit, so the agent's
 *      output sits ENTIRELY in the WORKING TREE (tracked modifications OR
 *      brand-new untracked files; the agent does no git):
 *        - tracked modifications: `git status --porcelain` reports any modified/
 *          added/deleted TRACKED path;
 *        - untracked files: `--porcelain` also lists `??` untracked paths (a new
 *          source file the agent created), which a `git diff` would MISS.
 *
 *   2. **SOURCE COMMITS on the branch ahead of `<arbiter>/main`** (the additional
 *      condition that honours a `requeue` CONTINUE-FROM-TIP). The working-tree-only
 *      assumption — "HEAD is still the claim commit" — is FALSE for a `requeue`
 *      keep+continue: the kept `work/<slug>` branch's prior work is a chain of
 *      COMMITTED commits ahead of main, with a legitimately CLEAN working tree.
 *      Such a continue is NOT a no-op, so we ALSO ask: does any commit in
 *      `git rev-list <arbiter>/main..HEAD` touch a NON-`work/` path? If so the
 *      branch carries real source work and the build is NOT empty, even though the
 *      current session's working tree is clean.
 *
 * TWO things are filtered out of BOTH signals so they do not read as a build: the
 * `work/` ledger (the runner's own claim move, the ONLY thing in the tree — and
 * the ONLY thing the claim commit touches — on a clean STOP) and the runner's own
 * `.agent-runner-job.json` record (a job-worktree leaves one — the SAME line
 * `gc`'s `isWorktreeClean` filters). The build is empty IFF nothing else remains
 * in EITHER signal. Best-effort: a plumbing failure in EITHER check is treated as
 * NON-empty (the safe direction — never short-circuit a genuine build by mistake).
 *
 * `arbiter` (already threaded for call-site symmetry) is used by signal 2 to
 * resolve `<arbiter>/main`; we fetch it first (mirroring the integration band) so
 * the remote-tracking ref exists / is current even in a bare-mirror job worktree.
 */
export async function isWorkBranchDiffEmpty(params: {
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
	const {cwd, arbiter, env} = params;
	const status = await runAsync(
		'git',
		['status', '--porcelain', '--', '.', ':(exclude)work'],
		cwd,
		{env},
	);
	if (status.status !== 0) {
		return false; // plumbing error ⇒ treat as NON-empty (the safe direction).
	}
	// Each porcelain line is `XY <path>` (path from column 3). Drop the runner's
	// own job-record line (a job worktree leaves it) — the SAME exclusion `gc`'s
	// `isWorktreeClean` applies — so only genuine source changes remain.
	const remaining = status.stdout
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line !== '')
		.filter((line) => line.slice(3).trim() !== JOB_RECORD_FILENAME);
	if (remaining.length > 0) {
		return false; // the working tree carries source change ⇒ a real build.
	}
	// Working tree is clean. It is STILL a real build if the branch carries source
	// COMMITS ahead of `<arbiter>/main` (a `requeue` continue-from-tip). Only when
	// there are none is this a genuine no-op.
	return !(await hasSourceCommitsAhead({cwd, arbiter, env}));
}

/**
 * Does the work branch have at least one commit in `<arbiter>/main..HEAD` that
 * touches a NON-`work/`, non-job-record path? Fetches `<arbiter>/main` first
 * (mirroring the integration band) so the ref resolves even in a bare-mirror job
 * worktree. Best-effort / SAFE direction: any plumbing failure (the fetch, the
 * rev-list, an unresolvable ref) reads as TRUE ("has source") — the same
 * never-short-circuit-a-genuine-build stance the working-tree check takes, so an
 * unknown can never collapse a real continue-from-tip into a no-op.
 */
async function hasSourceCommitsAhead(params: {
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
	const {cwd, arbiter, env} = params;
	// Refresh `<arbiter>/main` so the range resolves (a bare-mirror job worktree
	// has no fetch refspec; a regular clone gets the same harmless explicit ref).
	const fetched = await runAsync(
		'git',
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
		],
		cwd,
		{env},
	);
	if (fetched.status !== 0) {
		return true; // could not refresh the ref ⇒ NON-empty (safe direction).
	}
	// Count the commits in `<arbiter>/main..HEAD` that touch a path OTHER than the
	// `work/` ledger and the runner's own job record — the SAME two exclusions the
	// working-tree check applies, expressed as pathspecs so `--count` only counts
	// commits with genuine source change. A claim-commit-only branch (claim touches
	// `work/` only) counts 0; a continue-from-tip with prior source commits counts >0.
	const revList = await runAsync(
		'git',
		[
			'rev-list',
			'--count',
			`${arbiter}/main..HEAD`,
			'--',
			'.',
			':(exclude)work',
			`:(exclude)${JOB_RECORD_FILENAME}`,
		],
		cwd,
		{env},
	);
	if (revList.status !== 0) {
		return true; // could not compute the range ⇒ NON-empty (safe direction).
	}
	const count = Number.parseInt(revList.stdout.trim(), 10);
	if (!Number.isFinite(count)) {
		return true; // unparseable ⇒ NON-empty (safe direction).
	}
	return count > 0;
}

/** The needs-attention reason for the deterministic empty-diff backstop. */
export function emptyDiffStopReason(slug: string): string {
	return (
		`the agent produced no source change building '${slug}' (empty diff vs the ` +
		'arbiter main); treating as a no-op/stop — re-scope or re-claim.'
	);
}
