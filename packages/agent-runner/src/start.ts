import {performClaim} from './claim-cas.js';
import {ledgerWrite} from './ledger-write.js';
import {runAsync, type RunResult} from './git.js';

/**
 * `agent-runner start [<slug>]` — the human convenience that claims a slice (only
 * if necessary) and onboards the human onto its work branch in their CURRENT
 * checkout. It is a thin sequencer over the `claim` CAS (claim-cas.ts): it never
 * reimplements or weakens the claim, and it creates the work branch ONLY after a
 * claim provably lands.
 *
 * The decision of WHAT to do is made on the item's current FOLDER on
 * `<arbiter>/main` — never on the advisory `claimed_by` frontmatter field
 * (WORK-CONTRACT rule 6: the folder + git history are the source of truth).
 *
 *   work/backlog/<slug>.md     → claim it; on a winning claim, switch to
 *                                work/<slug> off the arbiter. On a lost/contended
 *                                claim, behave exactly like `claim`: user
 *                                restored, NO work branch, exit code propagated.
 *   work/in-progress/<slug>.md → already claimed. Refuse by default with a clear
 *                                message; with --resume, switch to work/<slug>
 *                                off the arbiter WITHOUT claiming (the human
 *                                explicitly asserts ownership).
 *   work/needs-attention/<slug>.md → stuck (a runner bounced it). Print the
 *                                recorded reason, transition it back to
 *                                in-progress THROUGH the write seam (which in
 *                                mode M clears the `main` surface via the reverse
 *                                move), then switch onto work/<slug>. UNGUARDED
 *                                (no --resume): a stuck item is up-for-grabs, so a
 *                                human can just pick it up with no manual move.
 *   work/done/<slug>.md or absent → refuse (nothing to start).
 *
 * It is harness-agnostic: it lands the human on the work branch and gets out of
 * the way. It launches no agent/editor.
 *
 * Exit codes:
 *   0  on the work branch (claimed-and-switched, or resumed)
 *   1  usage / environment error, or a refusal (in-progress without --resume,
 *      done/absent, no slug + not on a work/<slug> branch)
 *   2  lost the race (propagated from `claim`)
 *   3  contended (propagated from `claim`)
 */

export type StartOutcome =
	| 'started' // claimed a backlog item and switched to its work branch
	| 'resumed' // switched to an in-progress item's work branch (--resume)
	| 'resolved' // picked up a stuck needs-attention item (surface cleared)
	| 'refused' // refused (in-progress without --resume, done/absent, or not-ready)
	| 'lost' // claim lost the race (propagated from claim)
	| 'contended' // claim push kept being rejected (propagated from claim)
	| 'usage-error'; // usage / environment problem

export interface StartOptions {
	/** The slug to start. If omitted, inferred from a `work/<slug>` branch. */
	slug?: string;
	/** The working clone/checkout to onboard the human into. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/** Assert ownership of an already-in-progress item (switch without claiming). */
	resume?: boolean;
	/**
	 * Override the readiness guard (`--force` / `--ignore-not-ready`): claim a slice
	 * with an unmet `blockedBy` anyway, and silence the `needsAnswers` warning —
	 * loudly. Forwarded to the claim CAS's human-path guard.
	 */
	override?: boolean;
	/** Advisory claimer id forwarded to the claim CAS. */
	by?: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface StartResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: StartOutcome;
	/** The work branch the user landed on, when one was created/switched-to. */
	branch?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

const DEFAULT_ARBITER = 'origin';

/** Raised for usage/environment errors (exit 1, outcome 'usage-error'). */
class StartUsageError extends Error {}

/**
 * Raised for a deliberate REFUSAL (exit 1, outcome 'refused') — distinct from a
 * usage/environment error. Used when the item exists but start declines to act
 * (an in-progress item without --resume). The decision is folder-based.
 */
class StartRefusal extends Error {}

/** The folder a work item currently lives in on the arbiter's main. */
type Folder = 'backlog' | 'in-progress' | 'needs-attention' | 'done' | 'absent';

/**
 * Run the start ritual. Never throws for the expected lost/contended/refused
 * cases — those are returned with the appropriate exit code. Usage/environment
 * problems and refusals surface as exit 1.
 */
export async function performStart(
	options: StartOptions,
): Promise<StartResult> {
	const note = options.note ?? (() => {});
	try {
		return await runStart(options, note);
	} catch (err) {
		if (err instanceof StartRefusal) {
			return {exitCode: 1, outcome: 'refused', message: err.message};
		}
		if (err instanceof StartUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runStart(
	options: StartOptions,
	note: (m: string) => void,
): Promise<StartResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new StartUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new StartUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}

	// Resolve the slug: explicit wins; otherwise infer from a `work/<slug>` branch.
	const slug = options.slug || (await inferSlugFromBranch(cwd, env));
	if (!slug) {
		throw new StartUsageError(
			'missing <slug> and the current branch is not a work/<slug> branch. ' +
				'usage: agent-runner start [<slug>] [--arbiter remote] [--resume]',
		);
	}

	// Folder on the arbiter's main is the source of truth (NOT claimed_by).
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const folder = await folderOnArbiterMain(slug, arbiter, cwd, env);

	switch (folder) {
		case 'backlog':
			return startFromBacklog({
				slug,
				arbiter,
				cwd,
				env,
				by: options.by,
				override: options.override ?? false,
				note,
			});
		case 'in-progress':
			return startFromInProgress({
				slug,
				arbiter,
				cwd,
				env,
				resume: options.resume ?? false,
				note,
			});
		case 'needs-attention':
			return startFromNeedsAttention({slug, arbiter, cwd, env, note});
		case 'done':
			throw new StartUsageError(
				`'${slug}' is already done on ${arbiter}/main — nothing to start.`,
			);
		case 'absent':
			throw new StartUsageError(
				`'${slug}' is not present on ${arbiter}/main (no backlog/in-progress item — wrong slug?).`,
			);
	}
}

/**
 * Backlog → claim via the CAS, and ONLY on a winning claim (exit 0) switch to
 * the work branch. A lost (exit 2) / contended (exit 3) claim is propagated
 * verbatim: the user is left exactly as `claim` left them, with NO work branch.
 */
async function startFromBacklog(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	by: string | undefined;
	override: boolean;
	note: (m: string) => void;
}): Promise<StartResult> {
	const {slug, arbiter, cwd, env, by, override, note} = params;

	// The human-path readiness guard lives in the claim CAS (so both `claim` and
	// `start` inherit it): an unmet `blockedBy` is refused (exit 1, 'not-ready')
	// unless overridden; a `needsAnswers` slice warns but still claims.
	const claim = await performClaim({
		slug,
		cwd,
		arbiter,
		by,
		env,
		humanPath: true,
		override,
		note,
	});
	if (claim.exitCode !== 0) {
		// not-ready (1) / lost (2) / contended (3) / usage (1): behave exactly like
		// `claim`. Create no work branch; propagate the exit code and outcome. A
		// readiness refusal surfaces as 'refused' (a deliberate decline), distinct
		// from a usage/environment error.
		const outcome: StartOutcome =
			claim.outcome === 'not-ready'
				? 'refused'
				: claim.exitCode === 2
					? 'lost'
					: claim.exitCode === 3
						? 'contended'
						: 'usage-error';
		return {exitCode: claim.exitCode, outcome, message: claim.message};
	}

	// The claim landed — the item is now in-progress on the arbiter. Onboard the
	// human onto the work branch cut from that NEW main (which includes the claim).
	const branch = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	const message = `Started '${slug}': claimed and switched to ${branch}.`;
	note(message);
	return {exitCode: 0, outcome: 'started', branch, message};
}

/**
 * needs-attention → a runner bounced this stuck item. Picking it up is
 * UNGUARDED (a stuck item is explicitly up-for-grabs — no --resume): print the
 * recorded reason, transition it back to in-progress THROUGH the write seam
 * (mode M clears the `main` surface via the reverse move), then switch onto
 * work/<slug>. NO manual file move — the seam owns the transition.
 */
async function startFromNeedsAttention(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<StartResult> {
	const {slug, arbiter, cwd, env, note} = params;

	// Surface the recorded reason for the human, read from the stuck file on the
	// arbiter's main (the body prose under `## Needs attention`).
	const reason = await reasonOnArbiterMain(slug, arbiter, cwd, env);
	if (reason) {
		note(`'${slug}' is stuck (needs-attention): ${reason}`);
	} else {
		note(`'${slug}' is stuck (needs-attention) — picking it up.`);
	}

	// To transition the surface on main, work in a checkout that has the stuck file
	// in its tree. Cut a temporary branch off the arbiter's needs-attention surface
	// (the human's current branch may be anything), apply the reverse move THROUGH
	// the write seam (which clears the main surface in mode M), then onboard onto
	// work/<slug>. No manual file move escapes — the seam owns it.
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const startRef =
		(
			await gitSoft(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, env)
		).stdout.trim() ||
		(await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	const resolveBranch = `agent-runner/resolve-${slug}`;
	await gitHard(
		['switch', '--quiet', '-C', resolveBranch, `${arbiter}/main`],
		cwd,
		env,
	);
	try {
		const resolved = ledgerWrite.applyResolveNeedsAttentionTransition({
			cwd,
			slug,
			arbiter,
			env,
			note,
		});
		if (!resolved.moved) {
			throw new StartUsageError(
				resolved.reasonNotMoved ??
					`could not resolve '${slug}' from needs-attention.`,
			);
		}
	} finally {
		// Leave no scratch resolve branch behind: switch back, then drop it.
		await gitSoft(['switch', '--quiet', startRef], cwd, env);
		await gitSoft(['branch', '-D', resolveBranch], cwd, env);
	}

	// The surface is cleared on main (item back in in-progress). Onboard onto the
	// work branch cut from that NEW main.
	const branch = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	const message = `Started '${slug}': resolved from needs-attention and switched to ${branch}.`;
	note(message);
	return {exitCode: 0, outcome: 'resolved', branch, message};
}

/**
 * In-progress → already claimed (it is no longer in backlog, so the CAS cannot
 * apply). Refuse by default. With --resume the human explicitly asserts
 * ownership, so we switch to the work branch WITHOUT claiming. The decision is
 * folder-based; we never read the advisory `claimed_by` to guess ownership.
 */
async function startFromInProgress(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	resume: boolean;
	note: (m: string) => void;
}): Promise<StartResult> {
	const {slug, arbiter, cwd, env, resume, note} = params;

	if (!resume) {
		// Surfaced for the human, NEVER used to decide (the folder already drove the
		// decision). Who claimed comes from the claim COMMIT (the source of truth),
		// not a frontmatter field (there is none — WORK-CONTRACT rule 6).
		const claimedBy = await claimedByFromCommit(slug, arbiter, cwd, env);
		const who = claimedBy ? claimedBy : '(see git log)';
		throw new StartRefusal(
			`'${slug}' is already in-progress; claimed ${who}; ` +
				'if this is your own resumed work, re-run with --resume.',
		);
	}

	const branch = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	const message = `Resumed '${slug}': switched to ${branch} (no claim).`;
	note(message);
	return {exitCode: 0, outcome: 'resumed', branch, message};
}

/**
 * `git fetch <arbiter>` + `git switch -c work/<slug> <arbiter>/main`, landing the
 * user on the work branch in their current checkout. If the branch already
 * exists locally (e.g. a re-run / resume), switch to it instead of failing.
 */
async function switchToWorkBranch(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<string> {
	const {slug, arbiter, cwd, env} = params;
	const branch = `work/${slug}`;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Prefer creating the branch off the latest arbiter main (it includes the
	// claim move). If it already exists locally, plain-switch to it.
	const created = await gitSoft(
		['switch', '--quiet', '-c', branch, `${arbiter}/main`],
		cwd,
		env,
	);
	if (created.status === 0) {
		return branch;
	}
	const switched = await gitSoft(['switch', '--quiet', branch], cwd, env);
	if (switched.status === 0) {
		return branch;
	}
	throw new StartUsageError(
		`failed to switch to ${branch}: ${created.stderr.trim() || switched.stderr.trim()}`,
	);
}

/** If HEAD is a `work/<slug>` branch, return `<slug>`; else ''. */
async function inferSlugFromBranch(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	if (sym.status !== 0) {
		return '';
	}
	const branch = sym.stdout.trim();
	const match = /^work\/(.+)$/.exec(branch);
	return match ? match[1] : '';
}

/** Which work/ folder the slug currently lives in on `<arbiter>/main`. */
async function folderOnArbiterMain(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<Folder> {
	const folders: Exclude<Folder, 'absent'>[] = [
		'backlog',
		'in-progress',
		'needs-attention',
		'done',
	];
	for (const folder of folders) {
		const object = `${arbiter}/main:work/${folder}/${slug}.md`;
		if ((await gitSoft(['cat-file', '-e', object], cwd, env)).status === 0) {
			return folder;
		}
	}
	return 'absent';
}

/**
 * Derive who claimed the slice from the claim COMMIT that introduced it to
 * `work/in-progress/` (the message is `claim: <slug> (by <who>)`), purely to make
 * the refusal message helpful. This is the source of truth for who/when (there is
 * no advisory `claimed_by` frontmatter field — WORK-CONTRACT rule 6); the folder
 * already drove the start decision, so this value is NEVER used to decide.
 */
async function claimedByFromCommit(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const path = `work/in-progress/${slug}.md`;
	const log = await gitSoft(
		['log', '-1', '--format=%s', `${arbiter}/main`, '--', path],
		cwd,
		env,
	);
	if (log.status !== 0) {
		return '';
	}
	const match = /\(by (.+)\)\s*$/.exec(log.stdout.trim());
	return match ? `by ${match[1].trim()}` : '';
}

/**
 * Read the recorded needs-attention reason for `slug` from `<arbiter>/main`: the
 * prose under the `## Needs attention` heading in
 * `work/needs-attention/<slug>.md`. Returns '' when absent/unreadable (the human
 * is told it is stuck regardless). Read-only.
 */
async function reasonOnArbiterMain(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const show = await gitSoft(
		['show', `${arbiter}/main:work/needs-attention/${slug}.md`],
		cwd,
		env,
	);
	if (show.status !== 0) {
		return '';
	}
	const lines = show.stdout.replace(/\r\n/g, '\n').split('\n');
	const start = lines.findIndex((l) => l.trim() === '## Needs attention');
	if (start === -1) {
		return '';
	}
	const collected: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s/.test(line) || /^###\s/.test(line)) {
			break;
		}
		if (line.trim() === '') {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		collected.push(line.trim());
	}
	return collected.join(' ').trim();
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}
