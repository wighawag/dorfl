import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';

/**
 * In-process TypeScript implementation of the atomic compare-and-swap claim from
 * `scripts/CLAIM-PROTOCOL.md`. This is the first-class `agent-runner claim`
 * command (ADR §9: agent-runner is the PRIMARY implementation of the claim
 * protocol; `scripts/claim.sh` is retained as the portable, zero-dependency
 * bootstrap / reference). It is behaviourally equivalent to `claim.sh` — same
 * steps, same guardrails, same exit codes.
 *
 * It is async (each git call is a non-blocking `runAsync`) so two awaited claims
 * over the same slug genuinely race — the arbiter's ref-CAS (not test ordering)
 * picks the single winner, exactly as claim.sh's own verification does.
 *
 * Exit codes (identical to claim.sh / CLAIM-PROTOCOL.md):
 *   0  claim landed (work/in-progress/<slug>.md now on the arbiter's main)
 *   1  usage / environment error
 *   2  item not claimable (not in backlog, or lost the race to someone else)
 *   3  push kept failing after retries (transient/contended — try again later)
 */

/** Maps onto the four claim.sh exit codes. */
export type ClaimExitCode = 0 | 1 | 2 | 3;

/** A semantic label for each exit code (for callers/tests, never the verdict). */
export type ClaimCasOutcome = 'claimed' | 'usage-error' | 'lost' | 'contended';

export interface ClaimCasOptions {
	/** The slug to claim (`work/backlog/<slug>.md`). */
	slug: string;
	/** Working clone/worktree the claim runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory claimer id (`--by`). Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced (`--retries`). Default 3. */
	retries?: number;
	/** Show the intended push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes (claim.sh writes these to stderr). */
	note?: (message: string) => void;
}

export interface ClaimCasResult {
	exitCode: ClaimExitCode;
	outcome: ClaimCasOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** Raised for usage/environment errors (exit 1). */
class ClaimUsageError extends Error {}

/** Internal: the result of a single claim attempt. */
type AttemptResult =
	| {kind: 'claimed'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

const DEFAULT_RETRIES = 3;
const DEFAULT_ARBITER = 'origin';

/**
 * Perform the claim CAS. Never throws for the expected "lost the race" or
 * "contended" cases — those are returned as exit 2 / 3. Usage/environment
 * problems surface as exit 1. A successful claim is exit 0. This mirrors
 * claim.sh's control flow exactly (refuse dirty tree → loop attempts → on
 * rejection refetch & decide lost-vs-advanced → cap retries → back off).
 */
export async function performClaim(
	options: ClaimCasOptions,
): Promise<ClaimCasResult> {
	const note = options.note ?? (() => {});
	try {
		return await runClaim(options, note);
	} catch (err) {
		if (err instanceof ClaimUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		// Any other unexpected failure is an environment error (exit 1), never a
		// false "claimed". claim.sh treats unexpected rc the same way (die → 1).
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runClaim(
	options: ClaimCasOptions,
	note: (m: string) => void,
): Promise<ClaimCasResult> {
	const slug = options.slug;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? DEFAULT_RETRIES;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;

	if (!slug) {
		throw new ClaimUsageError(
			'missing <slug>. usage: agent-runner claim <slug> [--arbiter remote] [--by who]',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new ClaimUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new ClaimUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	// Refuse to run with a dirty tree — the claim must be a clean, isolated commit.
	const dirtyWorktree =
		(await gitSoft(['diff', '--quiet'], cwd, env)).status !== 0;
	const dirtyIndex =
		(await gitSoft(['diff', '--cached', '--quiet'], cwd, env)).status !== 0;
	if (dirtyWorktree || dirtyIndex) {
		throw new ClaimUsageError(
			'working tree has uncommitted changes; commit/stash them before claiming',
		);
	}

	const backlog = `work/backlog/${slug}.md`;
	const inProgress = `work/in-progress/${slug}.md`;
	const claimBranch = `claim/${slug}`;

	const origRef = await originalRef(cwd, env);

	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await attempt({
				slug,
				arbiter,
				by,
				dryRun,
				cwd,
				env,
				backlog,
				inProgress,
				claimBranch,
				note,
			});
			if (result.kind === 'claimed') {
				return {exitCode: 0, outcome: 'claimed', message: result.message};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			// rejected: main moved under us — retry up to the cap, then back off.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
			// The next attempt re-checks claimability, so if we now LOST the item
			// it returns exit 2 (definitive), matching claim.sh.
		}
	} finally {
		await cleanup(cwd, origRef, claimBranch, env);
	}
}

interface AttemptContext {
	slug: string;
	arbiter: string;
	by: string;
	dryRun: boolean;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	backlog: string;
	inProgress: string;
	claimBranch: string;
	note: (m: string) => void;
}

/** One claim attempt: branch off arbiter/main, move, commit, CAS-push, verify. */
async function attempt(ctx: AttemptContext): Promise<AttemptResult> {
	const {arbiter, slug, backlog, inProgress, claimBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Is the item still claimable on the arbiter's main?
	if (!(await catFileExists(`${arbiter}/main:${backlog}`, cwd, env))) {
		if (await catFileExists(`${arbiter}/main:${inProgress}`, cwd, env)) {
			const message = `'${slug}' is already in-progress on ${arbiter}/main — someone claimed it. Pick another item.`;
			note(message);
			return {kind: 'lost', message};
		}
		const message = `'${backlog}' not found on ${arbiter}/main (already done/removed, or wrong slug).`;
		note(message);
		return {kind: 'lost', message};
	}

	// Fresh claim branch off the latest arbiter main.
	await gitSoft(['branch', '-D', claimBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', claimBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	// Make the destination dir exist, then move. A failed move must abort (fatal),
	// never silently continue — guarding against a false "claimed".
	const inProgressAbs = join(cwd, inProgress);
	mkdirSync(dirname(inProgressAbs), {recursive: true});
	const mv = await gitSoft(['mv', backlog, inProgress], cwd, env);
	if (mv.status !== 0) {
		throw new ClaimUsageError(
			`git mv failed for '${backlog}' (unexpected — aborting claim)`,
		);
	}

	// Advisory only (NOT the source of truth — folder + history are). Stamp if present.
	await stampAdvisory(inProgressAbs, ctx.by, cwd, env);

	await gitHard(
		['commit', '--quiet', '-m', `claim: ${slug} (by ${ctx.by})`],
		cwd,
		env,
	);

	// Sanity: the claim commit MUST be a real child of the arbiter main we branched
	// from (i.e. it actually changed something). Guards against a no-op claim that
	// would make an "Everything up-to-date" push look like a successful claim.
	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new ClaimUsageError(
			'claim commit is a no-op (nothing moved) — aborting',
		);
	}
	const parent = (
		await gitHard(['rev-parse', 'HEAD^'], cwd, env)
	).stdout.trim();
	if (parent !== base) {
		throw new ClaimUsageError(
			`claim is not a direct child of ${arbiter}/main — aborting`,
		);
	}

	if (ctx.dryRun) {
		const message = `[dry-run] would: git push ${arbiter} ${claimBranch}:main --force-with-lease=main:${base}`;
		note(message);
		return {kind: 'claimed', message};
	}

	// The atomic compare-and-swap. --force-with-lease=main:<base> asserts the
	// arbiter's main is STILL <base> (unchanged since our fetch); the push then
	// fast-forwards main to our claim. If main moved, the lease fails → rejected.
	const push = await gitSoft(
		['push', arbiter, `${claimBranch}:main`, `--force-with-lease=main:${base}`],
		cwd,
		env,
	);
	if (push.status === 0) {
		// Verify the arbiter main now points at OUR claim (not merely "up-to-date").
		await gitHard(['fetch', '--quiet', arbiter], cwd, env);
		const arbiterHead = (
			await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
		).stdout.trim();
		if (arbiterHead === head) {
			const message = `CLAIMED '${slug}' -> work/in-progress/ on ${arbiter}/main.`;
			note(message);
			note(
				`Start work:  git fetch ${arbiter} && git switch -c work/${slug} ${arbiter}/main`,
			);
			return {kind: 'claimed', message};
		}
		note(
			`push reported success but ${arbiter}/main is not our claim — treating as rejected.`,
		);
	}
	return {kind: 'rejected', message: 'push rejected / lease failed'};
}

/** Stamp advisory `claimed_by` / `claimed_at` lines if they already exist. */
async function stampAdvisory(
	inProgressAbs: string,
	by: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	let content: string;
	try {
		content = readFileSync(inProgressAbs, 'utf8');
	} catch {
		return;
	}
	if (!/^claimed_by:/m.test(content)) {
		return;
	}
	const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
	const stamped = content
		.replace(/^claimed_by:.*$/m, `claimed_by: ${by}`)
		.replace(/^claimed_at:.*$/m, `claimed_at: ${ts}`);
	writeFileSync(inProgressAbs, stamped);
	await gitHard(['add', inProgressAbs], cwd, env);
}

/** The branch (or detached HEAD sha) we should return to afterward. */
async function originalRef(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	if (sym.status === 0 && sym.stdout.trim() !== '') {
		return sym.stdout.trim();
	}
	return (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
}

/** Best-effort: return to where we were and drop the throwaway claim branch. */
async function cleanup(
	cwd: string,
	origRef: string,
	claimBranch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	await gitSoft(['checkout', '--quiet', origRef], cwd, env);
	await gitSoft(['branch', '-D', claimBranch], cwd, env);
}

/** Resolve the advisory claimer: git user.name, else $USER/$USERNAME, else ''. */
async function resolveBy(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const name = await gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? '';
}

/** `git cat-file -e <object>` — true iff the object exists. */
async function catFileExists(
	object: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	return (await gitSoft(['cat-file', '-e', object], cwd, env)).status === 0;
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
