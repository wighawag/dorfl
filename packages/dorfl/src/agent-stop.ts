import {runAsync} from './git.js';
import {JOB_RECORD_FILENAME} from './workspace.js';

/**
 * **The build-agent → runner REPORTING CHANNEL** (task `agent-stop-signal`).
 *
 * A build agent reports back to the runner on ONE channel: its FINAL OUTPUT
 * (`LaunchResult.output`, captured as `agent.output`). This module defines the
 * two machine-recognisable verdicts an agent can raise on that channel and the
 * deterministic backstop the runner uses when the agent stopped without one:
 *
 *   1. A HARD **STOP** sentinel ({@link STOP_SENTINEL_OPEN} … {@link
 *      STOP_SENTINEL_CLOSE}): the task DRIFTED / is ambiguous / rests on a stale
 *      premise, so the agent could not build it. The runner routes the item to
 *      `work/needs-attention/` (the agent's reason VERBATIM) and SKIPS the
 *      acceptance gate + the Gate-2 review (a clean STOP is not a build that
 *      changed nothing). See {@link parseStopSentinel}.
 *   2. A SOFT **`## Decisions`** block ({@link extractDecisionsBlock}): the agent
 *      PROCEEDED but made a non-obvious in-scope decision the task did not
 *      specify (a cross-task interaction / a new error/refusal / a user-visible
 *      default). This does NOT stop the build — it just makes the choice visible
 *      for Gate-2 + the human to ratify (it rides the same `agent.output` → PR-body
 *      path the propose-mode summary uses).
 *
 * The sentinel form is documented IN-BAND next to the existing "STOP and report"
 * instruction in the CLAIM-PROTOCOL wrapper (`skills/setup/protocol/CLAIM-PROTOCOL.md`)
 * so the agent emits the EXACT shape this module parses — the same "agent edits,
 * runner does git" in-band discipline the rest of the protocol uses.
 */

/** The exact opening marker line of the STOP sentinel block. */
export const STOP_SENTINEL_OPEN = '=== TASK-STOP ===';
/** The exact closing marker line of the STOP sentinel block. */
export const STOP_SENTINEL_CLOSE = '=== END TASK-STOP ===';

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
				? 'the agent raised a TASK-STOP with no reason (the task could not be ' +
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
 * `.dorfl-job.json` record (a job-worktree leaves one — the SAME line
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
	if (await hasUncommittedSourceChanges({cwd, env})) {
		return false; // the working tree carries source change ⇒ a real build.
	}
	// Working tree is clean. It is STILL a real build if the branch carries source
	// COMMITS ahead of `<arbiter>/main` (a `requeue` continue-from-tip). Only when
	// there are none is this a genuine no-op.
	return !(await hasSourceCommitsAhead({cwd, arbiter, env}));
}

/**
 * The WORKING-TREE-DIRTY predicate (the first half of {@link
 * isWorkBranchDiffEmpty}): does the working tree carry any uncommitted source
 * change — tracked modifications, deletions, OR brand-new untracked files —
 * outside `work/` and outside the runner's `.dorfl-job.json` record?
 *
 * This is a **best-effort** check in the SAFE direction (a git plumbing failure
 * reads as TRUE: "dirty" / "has source") so an unknown can never short-circuit a
 * genuine build by mistake.
 *
 * Two consumers share this seam, so they NEVER drift on what "the agent left
 * uncommitted source work in the tree" means:
 *
 *   - {@link isWorkBranchDiffEmpty} (the STOP backstop): empty IFF this is FALSE
 *     AND `<arbiter>/main..HEAD` has no source commits.
 *
 *   - `complete.ts`'s stranded-done auto-recover gate (task
 *     `recover-autodetect-gated-on-nothing-to-commit`): on the autonomous path,
 *     `committedRecovery` (the folder-shape stranded-done auto-detect) fires only
 *     when this is FALSE. A dirty tree on a done-stranded branch means the agent
 *     produced new uncommitted work THIS run (a CONTINUE, not a finished strand),
 *     so the recover must NOT mis-fire and silently discard it.
 *
 * DELIBERATELY NOT used at the complete.ts gate point: (1) the core's
 * `nothingStaged` (`git diff --cached --quiet`) — that is INDEX-only and reads
 * empty BEFORE the core's later `git add -A`, so it would miss the agent's
 * unstaged edits; (2) the FULL `isWorkBranchDiffEmpty` — its commits-ahead half
 * is true for a GENUINE FINISHED STRAND too (the kept tip carries source commits
 * ahead of main), which would wrongly block the legitimate recover.
 */
export async function hasUncommittedSourceChanges(params: {
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
	const {cwd, env} = params;
	// Count ANY uncommitted tracked change (mods, deletions, untracked), dropping
	// ONLY the runner's own `.dorfl-job.json` record (a job worktree leaves it).
	//
	// It does NOT exclude `work/`: a `work/` change is frequently the GENUINE
	// DELIVERABLE of a task (extend an idea, transcribe a `## Decisions` block into a
	// done-record, ratify in a protocol doc, author an ADR-note). Excluding `work/`
	// wholesale mis-classified every DOCS-ONLY task as an empty-diff no-op and
	// FALSE-bounced completed, correct work (observation
	// `runner-empty-diff-false-positive-bounces-completed-work-2026-07-09`). The
	// old exclusion existed for a claim BOOKKEEPING commit that touched `work/`
	// only — but the per-item-lock claim writes NOTHING (`claim-cas.ts`: "there is
	// NO claim commit"), so the exclusion now only over-drops real deliverables.
	// Genuine bookkeeping is excluded by TRAILER at the commits-ahead check, not by
	// path here (the working tree carries no bookkeeping — the agent's edits are
	// its deliverable).
	const status = await runAsync('git', ['status', '--porcelain'], cwd, {env});
	if (status.status !== 0) {
		return true; // plumbing error ⇒ treat as DIRTY (the safe direction).
	}
	// Each porcelain line is `XY <path>` (path from column 3).
	const remaining = status.stdout
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line !== '')
		.filter((line) => line.slice(3).trim() !== JOB_RECORD_FILENAME);
	return remaining.length > 0;
}

/**
 * Does the work branch have at least one GENUINE-WORK commit in
 * `<arbiter>/main..HEAD` (a commit that is NOT a runner bookkeeping commit,
 * identified by its `Dorfl-Bookkeeping` trailer)? Fetches `<arbiter>/main` first
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
	// Enumerate the commits in `<arbiter>/main..HEAD` and count those that carry
	// GENUINE work — i.e. NOT a runner BOOKKEEPING commit. A bookkeeping commit is
	// identified by its recorded `Dorfl-Bookkeeping` trailer (task
	// `identify-bookkeeping-commits-by-trailer-not-rendered-todo-text`), NOT by a
	// `work/` path: a `work/` change is frequently the real deliverable of a
	// docs/protocol/observation task, so a path-based `:(exclude)work` here
	// FALSE-bounced completed docs-only work (observation
	// `runner-empty-diff-false-positive-bounces-completed-work-2026-07-09`). Read
	// each commit's sha + bookkeeping trailer via plumbing (NUL-delimited, one
	// record per commit); a commit with a non-empty `Dorfl-Bookkeeping` trailer is
	// bookkeeping and does not count; any other commit is genuine work.
	// Per commit: its sha + its `Dorfl-Bookkeeping` trailer value, NUL-delimited
	// then a record separator, so we can inspect each commit's files too.
	const log = await runAsync(
		'git',
		[
			'log',
			'--format=%H%x00%(trailers:key=Dorfl-Bookkeeping,valueonly)%x1e',
			`${arbiter}/main..HEAD`,
		],
		cwd,
		{env},
	);
	if (log.status !== 0) {
		return true; // could not compute the range ⇒ NON-empty (safe direction).
	}
	const records = log.stdout
		.split('\x1e')
		.map((r) => r.trim())
		.filter((r) => r !== '');
	for (const record of records) {
		const [sha, bookkeepingTrailer = ''] = record.split('\0');
		// A bookkeeping-trailered commit is not genuine work.
		if (bookkeepingTrailer.trim() !== '') {
			continue;
		}
		// A commit whose ONLY touched path is the runner's own job-record is
		// bookkeeping too (no trailer, but not the agent's deliverable).
		const files = await runAsync(
			'git',
			['show', '--name-only', '--format=', sha],
			cwd,
			{env},
		);
		const touched =
			files.status === 0
				? files.stdout
						.split('\n')
						.map((p) => p.trim())
						.filter((p) => p !== '')
				: [];
		const jobRecordOnly =
			touched.length > 0 && touched.every((p) => p === JOB_RECORD_FILENAME);
		if (jobRecordOnly) {
			continue;
		}
		// A non-bookkeeping commit that touches real files ⇒ genuine work.
		return true;
	}
	return false;
}

/** The needs-attention reason for the deterministic empty-diff backstop. */
export function emptyDiffStopReason(slug: string): string {
	return (
		`the agent produced no source change building '${slug}' (empty diff vs the ` +
		'arbiter main); treating as a no-op/stop — re-scope or re-claim.'
	);
}
