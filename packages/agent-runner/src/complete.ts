import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runVerify, type VerifyConfig} from './verify.js';
import {integrate} from './integrate.js';
import type {IntegrationMode} from './config.js';
import {runAsync, type RunResult} from './git.js';

/**
 * `agent-runner complete [<slug>] [--skip-verify] [--type <t>] [--message <s>]
 * [--arbiter <remote>]` — the human "finish this" command that runs the same
 * back-half the autonomous runner runs: gate → mark done → commit → integrate.
 *
 * It runs on a `work/<slug>` branch (slug inferred from the branch if omitted).
 * The build agent leaves its work UNCOMMITTED (it does no git), so `complete`
 * `git add -A`s the agent's work AND the done-move into ONE atomic commit. This
 * is the same finish/integration logic `run-once`/`watch` reuse; here it is
 * human-driven and so allows a `--skip-verify` escape hatch the autonomous
 * runner never uses (ADR §8).
 *
 * The integration step is split by mode (config `integration`, ADR §6):
 *   merge   — push the rebased branch to `<arbiter>/main`, then sync the LOCAL
 *             clone to that new main (the push is authoritative; the local sync
 *             is the ergonomic finish so the user ends on an up-to-date main).
 *   propose — push the `work/<slug>` branch (the safety-bearing step) and report
 *             the next step. Full provider-driven PR/MR creation lands with the
 *             integration seam; until then `complete` pushes + tells the human.
 *
 * Before integrating, the work branch is rebased onto the latest `<arbiter>/main`
 * (ADR §10): a clean rebase continues; a conflicting rebase is `--abort`ed and
 * surfaced as needs-attention — `complete` NEVER auto-resolves. It NEVER
 * `--force`es to main.
 *
 * Exit codes:
 *   0  completed (done-move + commit + integrate succeeded)
 *   1  usage/environment error, or a refusal (gate failed, nothing to commit,
 *      not on a work branch, rebase conflict needs the human)
 */

export type CompleteOutcome =
	| 'completed' // gated, moved, committed, integrated
	| 'gate-failed' // the acceptance gate was red (and not skipped)
	| 'rebase-conflict' // rebase onto arbiter/main conflicted (aborted; human resolves)
	| 'refused' // nothing to complete (nothing to commit, wrong folder, …)
	| 'usage-error'; // usage / environment problem

export interface CompleteOptions {
	/** The slug to complete. If omitted, inferred from a `work/<slug>` branch. */
	slug?: string;
	/** The working clone/checkout the work branch lives in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/** Integration mode: `propose` (default) or `merge`. */
	integration?: IntegrationMode;
	/** The declared per-repo gate (string | list). Unset ⇒ the default command. */
	verify?: VerifyConfig;
	/** Skip the acceptance gate (human-only escape hatch; never used unattended). */
	skipVerify?: boolean;
	/** Conventional-commit type for the completion commit. Defaults to `feat`. */
	type?: string;
	/** Commit summary. Defaults to the slice `title` minus a leading `slug — `. */
	message?: string;
	/** Optional injectable PR opener (e.g. `gh pr create`); used in `propose` mode. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface CompleteResult {
	exitCode: 0 | 1;
	outcome: CompleteOutcome;
	/** The work branch that was completed, when one was resolved. */
	branch?: string;
	/** The completion commit message that was authored, on success. */
	commitMessage?: string;
	/** True when the work landed on the arbiter's `main` (merge mode). */
	mergedToMain?: boolean;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

const DEFAULT_ARBITER = 'origin';
const DEFAULT_TYPE = 'feat';
const DEFAULT_INTEGRATION: IntegrationMode = 'propose';

/** Raised for usage/environment errors (exit 1, outcome 'usage-error'). */
class CompleteUsageError extends Error {}

/** Raised for a deliberate REFUSAL (exit 1, outcome 'refused'). */
class CompleteRefusal extends Error {}

/**
 * Run the complete ritual. Never throws for the expected gate-failed /
 * rebase-conflict / refused cases — those are returned with exit 1 and a
 * specific outcome. Usage/environment problems also surface as exit 1.
 */
export async function performComplete(
	options: CompleteOptions,
): Promise<CompleteResult> {
	const note = options.note ?? (() => {});
	try {
		return await runComplete(options, note);
	} catch (err) {
		if (err instanceof CompleteRefusal) {
			return {exitCode: 1, outcome: 'refused', message: err.message};
		}
		if (err instanceof CompleteUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runComplete(
	options: CompleteOptions,
	note: (m: string) => void,
): Promise<CompleteResult> {
	const cwd = options.cwd;
	const env = options.env;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const mode = options.integration ?? DEFAULT_INTEGRATION;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new CompleteUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new CompleteUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}

	// Resolve the slug: explicit wins; otherwise infer from a `work/<slug>` branch.
	const slug = options.slug || (await inferSlugFromBranch(cwd, env));
	if (!slug) {
		throw new CompleteUsageError(
			'missing <slug> and the current branch is not a work/<slug> branch. ' +
				'usage: agent-runner complete [<slug>] [--skip-verify] [--type t] ' +
				'[--message s] [--arbiter remote]',
		);
	}
	const branch = `work/${slug}`;

	// We must be ON the work branch — that is where the agent's work lives and
	// what we rebase + push. (Unlike `start`, `complete` mutates the checkout.)
	const head = await currentBranch(cwd, env);
	if (head !== branch) {
		throw new CompleteUsageError(
			`not on ${branch} (HEAD is '${head}'). ` +
				`Check out the work branch before completing '${slug}'.`,
		);
	}

	// The slice must be in-progress in the working tree (it is what we move).
	const inProgress = join(cwd, 'work', 'in-progress', `${slug}.md`);
	if (!existsSync(inProgress)) {
		throw new CompleteRefusal(
			`work/in-progress/${slug}.md not found — nothing to complete ` +
				'(already done, or wrong slug?).',
		);
	}

	// 1. Gate: bad work never proceeds to done. Default-on; --skip-verify is a
	//    human-only escape hatch (the autonomous runner never skips — ADR §8).
	if (options.skipVerify) {
		note('Skipping the acceptance gate (--skip-verify).');
	} else {
		note('Running the acceptance gate (verify)…');
		const gate = await runVerify({cwd, verify: options.verify, env});
		if (!gate.passed) {
			return {
				exitCode: 1,
				outcome: 'gate-failed',
				branch,
				message:
					`Acceptance gate failed (exit ${gate.exitCode}); not completing ` +
					`'${slug}'. Fix the work, or use --skip-verify to override.`,
			};
		}
	}

	// Read the title now, BEFORE the move, for the default commit summary (the
	// in-progress file is about to be git-mv'd away).
	const defaultMessage = defaultSummary(inProgress, slug);

	// 2. Mark done: mkdir -p work/done, then git mv in-progress → done.
	mkdirSync(join(cwd, 'work', 'done'), {recursive: true});
	await gitHard(
		['mv', `work/in-progress/${slug}.md`, `work/done/${slug}.md`],
		cwd,
		env,
	);

	// 3. Commit: git add -A (the agent's uncommitted work + the move) into ONE
	//    atomic commit. Nothing to commit is FATAL (no-op-is-fatal, like claim.sh).
	await gitHard(['add', '-A'], cwd, env);
	if (await nothingStaged(cwd, env)) {
		throw new CompleteRefusal(
			`nothing to commit for '${slug}' — no work and no move staged. ` +
				'(Did the agent produce changes? Is the slice already done?)',
		);
	}
	const summary = options.message ?? defaultMessage;
	const type = (options.type ?? DEFAULT_TYPE).trim() || DEFAULT_TYPE;
	const commitMessage = `${type}(${slug}): ${summary}; done`;
	await gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	note(`Committed: ${commitMessage}`);

	// 4. Rebase-before-integrate (ADR §10): rebase the work branch onto the
	//    latest <arbiter>/main. Clean → continue. Conflict → abort + stop.
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const rebase = await gitSoft(['rebase', `${arbiter}/main`], cwd, env);
	if (rebase.status !== 0) {
		// NEVER auto-resolve: abort and hand the conflict back to the human.
		await gitSoft(['rebase', '--abort'], cwd, env);
		return {
			exitCode: 1,
			outcome: 'rebase-conflict',
			branch,
			commitMessage,
			message:
				`Rebasing ${branch} onto ${arbiter}/main conflicted; the rebase was ` +
				'aborted (never auto-resolved). Resolve against the latest main, then ' +
				're-run complete.',
		};
	}

	// 5. Integrate per mode. integrate() never --forces.
	const result = integrate({
		cwd,
		arbiter,
		branch,
		mode,
		env,
		openPr: options.openPr,
	});

	if (mode === 'merge') {
		// The push to <arbiter>/main is authoritative; now sync the LOCAL clone so
		// the user ends on an up-to-date local main (not a stale one).
		await syncLocalMain(cwd, arbiter, env);
		const message = `Completed '${slug}': merged to ${arbiter}/main; local main updated.`;
		note(message);
		return {
			exitCode: 0,
			outcome: 'completed',
			branch,
			commitMessage,
			mergedToMain: result.mergedToMain,
			message,
		};
	}

	// propose: the branch is pushed; report the next step.
	const message = result.prOpened
		? `Completed '${slug}': pushed ${branch} and opened a review.`
		: `Completed '${slug}': pushed ${branch} to ${arbiter}. ` +
			'Open a PR/MR to land it on main (full provider PR creation comes with ' +
			'the integration seam).';
	note(message);
	return {
		exitCode: 0,
		outcome: 'completed',
		branch,
		commitMessage,
		mergedToMain: false,
		message,
	};
}

/**
 * Sync the local `main` to the just-pushed `<arbiter>/main`: switch to main and
 * fast-forward it. We fetch + reset --hard to the arbiter's main (a ff in
 * practice — we just pushed our rebased work there) so the user lands on an
 * up-to-date local main without merge noise.
 */
async function syncLocalMain(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	await gitHard(['switch', '--quiet', 'main'], cwd, env);
	await gitHard(['merge', '--ff-only', '--quiet', `${arbiter}/main`], cwd, env);
}

/**
 * Default commit summary: the slice's `title` frontmatter with any leading
 * `slug — ` (or `slug -`) prefix stripped, so a slice titled
 * "complete — gate, mark done, …" yields "gate, mark done, …". Falls back to a
 * generic summary when the title is missing/unreadable.
 */
function defaultSummary(inProgressPath: string, slug: string): string {
	let title: string | undefined;
	try {
		title = readTitle(readFileSync(inProgressPath, 'utf8'));
	} catch {
		title = undefined;
	}
	if (!title) {
		return 'complete work slice';
	}
	// Strip a leading "slug" followed by an em-dash / en-dash / hyphen separator.
	const prefix = new RegExp(`^${escapeRegExp(slug)}\\s*[—–-]\\s*`, 'i');
	return title.replace(prefix, '').trim() || title;
}

/** Read the `title:` scalar from a slice's frontmatter block, or undefined. */
function readTitle(content: string): string | undefined {
	const normalized = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n')) {
		return undefined;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	const block = closing === -1 ? lines.slice(1) : lines.slice(1, closing);
	for (const line of block) {
		const match = /^title\s*:\s*(.*)$/.exec(line);
		if (match) {
			const value = match[1].trim();
			return value === '' ? undefined : unquote(value);
		}
	}
	return undefined;
}

function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** If HEAD is a `work/<slug>` branch, return `<slug>`; else ''. */
async function inferSlugFromBranch(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const branch = await currentBranch(cwd, env);
	const match = /^work\/(.+)$/.exec(branch);
	return match ? match[1] : '';
}

/** The short symbolic name of HEAD, or '' for a detached HEAD. */
async function currentBranch(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	return sym.status === 0 ? sym.stdout.trim() : '';
}

/** True when the index has no staged changes against HEAD (nothing to commit). */
async function nothingStaged(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	// `diff --cached --quiet` exits 0 when there is NOTHING staged, 1 when there is.
	const res = await gitSoft(['diff', '--cached', '--quiet'], cwd, env);
	return res.status === 0;
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
