import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runVerify, type VerifyConfig} from './verify.js';
import type {ReviewProvider} from './integrator.js';
import {ledgerWrite} from './ledger-write.js';
import {selectProvider} from './github.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import {runAsync, type RunResult} from './git.js';
import {formatProposeNextStep, shouldUseColor} from './output.js';

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
 * In BOTH modes `complete` lands the human back on local `main` by default
 * ("finish, ready for the next thing") — but the move differs because the work's
 * location differs: `merge` switches to `main` AND fast-forwards it to the just-
 * pushed `<arbiter>/main` (the work landed there); `propose` ONLY `git switch
 * main` (arbiter main has not moved, so there is nothing to ff). `--no-switch`
 * opts out in either mode (stay on `work/<slug>` to keep iterating).
 *
 * After landing on `main`, the LOCAL `work/<slug>` branch is deleted iff its work
 * is provably on the arbiter (the SAME predicate as worktree deletion, ADR §4,
 * mode-agnostic): its tip is an ancestor of `<arbiter>/main` (merged) OR
 * `<arbiter>/work/<slug>` exists with its tip == the local tip (pushed & up-to-
 * date). Otherwise the branch is KEPT (unmerged / unpushed / a diverged un-pushed
 * amend = not safe). The REMOTE branch is NEVER deleted (a propose PR is built
 * from it). `--no-switch` keeps the branch too.
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
 *
 * On the two FAILURE paths the human can't paper over — a red gate (without
 * `--skip-verify`) and a rebase conflict (ADR §10) — `complete` no longer leaves
 * the item dangling. Instead it routes the item through the shared
 * `needs-attention` mechanism (ADR §12): record the reason and
 * `git mv work/in-progress|done/<slug>.md → work/needs-attention/<slug>.md`, so
 * the stuck item is surfaced by `status` and returnable to `backlog/`. The
 * success and `--skip-verify` paths are unchanged. The exit code stays 1 (the
 * work did NOT complete); the outcome still names WHY (gate-failed /
 * rebase-conflict) and `routedToNeedsAttention` records that the move happened.
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
	/**
	 * Leave the human ON the `work/<slug>` branch (and KEEP it) in either mode,
	 * instead of switching back to `main` + deleting the provably-landed branch.
	 * For "I'll keep iterating on this branch" (e.g. addressing review feedback).
	 */
	noSwitch?: boolean;
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
	/**
	 * The review-request provider override (config `provider`, ADR §6). Unset ⇒
	 * auto-detect from the arbiter URL (a GitHub remote ⇒ `gh pr create`, else
	 * push-only `none`); an explicit value forces a provider. Ignored when
	 * `openPr` is injected (the legacy bridge wins). `merge` mode ignores it.
	 */
	provider?: ReviewProviderName;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Sink for a pre-formatted block printed VERBATIM (no `>> ` prefix), used for
	 * the visually-distinct propose-mode next-step block so its blank lines and
	 * heading stand out cleanly. Defaults to `note` when not supplied.
	 */
	noteBlock?: (message: string) => void;
	/**
	 * Emit ANSI color in the (cosmetic) propose-mode next-step block. Defaults
	 * to the TTY/`NO_COLOR` rule against `process.stdout`; injectable so tests
	 * can simulate a TTY (color) vs. a pipe / `NO_COLOR` (plain) without a real
	 * terminal. Color-only — it changes no gate/done-move/commit/integrate logic.
	 */
	color?: boolean;
}

export interface CompleteResult {
	exitCode: 0 | 1;
	outcome: CompleteOutcome;
	/**
	 * True iff a FAILURE outcome (gate-failed / rebase-conflict) was routed to
	 * `work/needs-attention/` via the shared mechanism (ADR §12), rather than left
	 * dangling. Undefined/false on the success, `--skip-verify`, refused, and
	 * usage-error paths (none of which move the item to needs-attention).
	 */
	routedToNeedsAttention?: boolean;
	/** The work branch that was completed, when one was resolved. */
	branch?: string;
	/** The completion commit message that was authored, on success. */
	commitMessage?: string;
	/** True when the work landed on the arbiter's `main` (merge mode). */
	mergedToMain?: boolean;
	/** The branch HEAD ended on after completing (`main`, or the work branch). */
	switchedTo?: string;
	/** True iff the local `work/<slug>` branch was deleted (provably on arbiter). */
	deletedLocalBranch?: boolean;
	/**
	 * The review-request URL (e.g. a GitHub PR) opened in `propose` mode, when a
	 * provider opened one and reported it (ADR §6). Absent in merge mode and on
	 * the push-only / degraded path.
	 */
	prUrl?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

const DEFAULT_ARBITER = 'origin';
const DEFAULT_TYPE = 'feat';
const DEFAULT_INTEGRATION: IntegrationMode = 'propose';

/**
 * Resolve the integration mode the human asked for ON THIS invocation from the
 * mutually-exclusive `--merge` / `--propose` flags. Returns the explicit mode,
 * or `undefined` when neither flag was given (per-repo > global > default then
 * decides). Throws when BOTH are given (they are mutually exclusive). This is
 * the TOP of the complete-time precedence chain (flag > per-repo > global >
 * default); the autonomous runner uses no flag and so resolves the same
 * underlying order.
 */
export function integrationFromFlags(flags: {
	merge?: boolean;
	propose?: boolean;
}): IntegrationMode | undefined {
	if (flags.merge && flags.propose) {
		throw new Error(
			'--merge and --propose are mutually exclusive; pass at most one.',
		);
	}
	if (flags.merge) {
		return 'merge';
	}
	if (flags.propose) {
		return 'propose';
	}
	return undefined;
}

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
			// Don't leave the item dangling in in-progress/: route it to
			// needs-attention/ with the reason (ADR §12) THROUGH the ledger write
			// seam's needs-attention transition. The item has NOT been committed/moved
			// yet, so the move bounces it straight from in-progress/ — recording the
			// reason + committing the move (with the agent's uncommitted work) as ONE
			// atomic transition. No partial state.
			const reason = `acceptance gate failed (exit ${gate.exitCode})`;
			const routed = ledgerWrite.applyNeedsAttentionTransition({
				cwd,
				slug,
				reason,
				env,
				note,
			});
			return {
				exitCode: 1,
				outcome: 'gate-failed',
				routedToNeedsAttention: routed.moved,
				branch,
				message: routed.moved
					? `Acceptance gate failed (exit ${gate.exitCode}); routed '${slug}' ` +
						'to work/needs-attention/ (surfaced by status; return to backlog/ ' +
						'once resolved). Fix the work, or use --skip-verify to override.'
					: `Acceptance gate failed (exit ${gate.exitCode}); not completing ` +
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
		// NEVER auto-resolve: abort the rebase (back to a clean work-branch tip).
		await gitSoft(['rebase', '--abort'], cwd, env);
		// Then route the item to needs-attention/ with the conflict reason (ADR
		// §12) THROUGH the ledger write seam's needs-attention transition, rather
		// than leaving it dangling in done/. The done-move was already committed
		// above, so the item sits in work/done/; the move bounces it from there and
		// commits the in-progress→needs-attention move (here done→needs-attention)
		// as ONE transition. No partial state.
		const reason = `rebase onto ${arbiter}/main conflicted (aborted, never auto-resolved)`;
		const routed = ledgerWrite.applyNeedsAttentionTransition({
			cwd,
			slug,
			reason,
			env,
			note,
		});
		return {
			exitCode: 1,
			outcome: 'rebase-conflict',
			routedToNeedsAttention: routed.moved,
			branch,
			commitMessage,
			message: routed.moved
				? `Rebasing ${branch} onto ${arbiter}/main conflicted; the rebase was ` +
					`aborted (never auto-resolved) and '${slug}' was routed to ` +
					'work/needs-attention/ (surfaced by status). Resolve against the ' +
					'latest main, then return it to backlog/ and re-run.'
				: `Rebasing ${branch} onto ${arbiter}/main conflicted; the rebase was ` +
					'aborted (never auto-resolved). Resolve against the latest main, ' +
					'then re-run complete.',
		};
	}

	// 5. Integrate per mode through the ledger write seam's COMPLETE transition
	//    (ADR §6 + `docs/adr/claim-ledger-vs-protected-main.md`). The rebase above
	//    already brought the branch up to date, so the seam's sole strategy uses
	//    `integrate` (not `integrateWithRebase`) and never --forces. Provider
	//    selection: an injected `openPr` wins (legacy bridge); otherwise pick by
	//    the `provider` override LAYERED OVER auto-detection from the arbiter's
	//    remote URL (a GitHub remote ⇒ `gh pr create`, else push-only `none`). A
	//    missing/unauthenticated `gh` degrades to push-only at runtime — never a
	//    hard failure. The seam is storage-agnostic: we hand it the work branch,
	//    the integration mode, and the provider — `main` lives only in the strategy.
	const provider = options.openPr
		? bridgeProvider(options.openPr)
		: selectProvider({
				arbiterUrl: await arbiterUrl(cwd, arbiter, env),
				provider: options.provider,
			});
	const result = ledgerWrite.applyCompleteTransition({
		arbiter,
		branch,
		mode,
		provider,
		cwd,
		env,
	});

	// Land back on `main` by default in BOTH modes (the move differs per mode),
	// then delete the local work branch iff its work is provably on the arbiter.
	// `--no-switch` keeps the human on the work branch AND keeps the branch.
	let switchedTo = branch;
	let deletedLocalBranch = false;
	if (!options.noSwitch) {
		if (mode === 'merge') {
			// merge: the work landed on <arbiter>/main, so switch to main AND ff it.
			await syncLocalMain(cwd, arbiter, env);
		} else {
			// propose: the work is on a pushed branch awaiting review, NOT on main,
			// so JUST switch to main — do NOT ff (arbiter main has not moved).
			await gitHard(['switch', '--quiet', 'main'], cwd, env);
		}
		switchedTo = 'main';
		// Delete the LOCAL work branch when provably on the arbiter (same predicate
		// as worktree deletion, ADR §4, mode-agnostic). NEVER delete the remote.
		deletedLocalBranch = await deleteLocalBranchIfProvablyOnArbiter(
			cwd,
			arbiter,
			branch,
			env,
		);
	}

	if (mode === 'merge') {
		const landed = options.noSwitch
			? `merged to ${arbiter}/main; left on ${branch} (--no-switch).`
			: `merged to ${arbiter}/main; local main updated` +
				`${deletedLocalBranch ? ` and ${branch} deleted` : ''}.`;
		const message = `Completed '${slug}': ${landed}`;
		note(message);
		return {
			exitCode: 0,
			outcome: 'completed',
			branch,
			commitMessage,
			mergedToMain: result.mergedToMain,
			switchedTo,
			deletedLocalBranch,
			message,
		};
	}

	// propose: the branch is pushed; report the next step. The next step is the
	// ONE thing the human must act on, so it is emitted as a visually-distinct
	// block (blank lines + heading + TTY-aware color) ON TOP of the plain summary
	// note below — cosmetic only; the structured result is unchanged.
	const color = options.color ?? shouldUseColor(process.stdout);
	const noteBlock = options.noteBlock ?? note;
	noteBlock(
		formatProposeNextStep({
			branch,
			arbiter,
			requestOpened: result.requestOpened,
			color,
		}),
	);
	const next = result.requestOpened
		? result.url
			? `pushed ${branch} and opened a review (${result.url})`
			: `pushed ${branch} and opened a review`
		: `pushed ${branch} to ${arbiter}. ` + 'Open a PR/MR to land it on main';
	const tail = options.noSwitch
		? `; left on ${branch} (--no-switch).`
		: deletedLocalBranch
			? `; switched to main and deleted ${branch}.`
			: '; switched to main.';
	const message = `Completed '${slug}': ${next}${tail}`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'completed',
		branch,
		commitMessage,
		mergedToMain: false,
		switchedTo,
		deletedLocalBranch,
		prUrl: result.url,
		message,
	};
}

/**
 * The arbiter's remote URL for `arbiter` in `cwd` (for provider auto-detection),
 * or `undefined` when it cannot be resolved. Read-only; soft (never throws).
 */
async function arbiterUrl(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	const res = await gitSoft(['remote', 'get-url', arbiter], cwd, env);
	if (res.status !== 0) {
		return undefined;
	}
	const url = res.stdout.trim();
	return url === '' ? undefined : url;
}

/** Adapt the legacy `openPr` callback into the new ReviewProvider seam. */
function bridgeProvider(
	openPr: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void,
): ReviewProvider {
	return {
		name: 'none',
		openRequest(input) {
			openPr({cwd: input.cwd, branch: input.branch, env: input.env});
			return {
				opened: true,
				instruction: `Opened a review for ${input.branch}.`,
			};
		},
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
 * Delete the LOCAL `work/<slug>` branch iff its work is PROVABLY on the arbiter
 * — the SAME predicate as worktree deletion (ADR §4), mode-agnostic. Must be
 * called AFTER we have switched off the branch (you cannot delete the branch you
 * are on). Returns whether the local branch was deleted.
 *
 * Provably-on-arbiter ⇔ EITHER:
 *   - merged: the branch tip is an ancestor of `<arbiter>/main`, OR
 *   - pushed & up-to-date: `<arbiter>/<branch>` exists AND its tip == the local
 *     branch tip (so a later un-pushed amend is NEVER lost — we verify the
 *     remote tip equals the local tip, not merely that "a branch was pushed").
 *
 * Otherwise the branch is KEPT (unmerged / unpushed / diverged = not safe). The
 * REMOTE branch is NEVER touched (a propose PR is built from it). A `git fetch`
 * refreshes the remote-tracking refs so reachability is read against the LIVE
 * arbiter; an unreachable arbiter simply reads as not-provable → keep (safe).
 */
async function deleteLocalBranchIfProvablyOnArbiter(
	cwd: string,
	arbiter: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	if (!(await isLocalBranchProvablyOnArbiter(cwd, arbiter, branch, env))) {
		return false; // not provably on the arbiter → KEEP the local branch
	}
	// Provably on the arbiter → delete ONLY the local branch (force-delete: the
	// `-d` safety check uses the upstream/HEAD, which we have already proven via
	// the predicate above; `-D` avoids a false "not fully merged" in propose mode).
	await gitHard(['branch', '-D', branch], cwd, env);
	return true;
}

/**
 * The provably-safe predicate (ADR §4), mode-agnostic, applied to a LOCAL
 * `branch` in `cwd`: true iff its tip is an ancestor of `<arbiter>/main` (merged)
 * OR `<arbiter>/<branch>` exists with its tip == the local tip (pushed &
 * up-to-date). False when the local branch is absent, or its work is unmerged /
 * unpushed / a diverged un-pushed amend (remote tip != local tip). A `git fetch`
 * refreshes the remote-tracking refs; an unreachable arbiter reads as not-
 * provable → false (the safe direction). Exported for direct testing of the
 * kept-vs-deleted decision in isolation.
 */
export async function isLocalBranchProvablyOnArbiter(
	cwd: string,
	arbiter: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	const localTip = (
		await gitSoft(['rev-parse', '--verify', '--quiet', branch], cwd, env)
	).stdout.trim();
	if (localTip === '') {
		return false; // no such local branch
	}

	// Refresh remote-tracking refs against the live arbiter (best-effort).
	await gitSoft(['fetch', '--quiet', arbiter], cwd, env);

	// Merged: tip is an ancestor of <arbiter>/main.
	const merged =
		(
			await gitSoft(
				['merge-base', '--is-ancestor', localTip, `${arbiter}/main`],
				cwd,
				env,
			)
		).status === 0;
	if (merged) {
		return true;
	}

	// Pushed & up-to-date: <arbiter>/<branch> exists AND its tip == the local tip
	// (we verify remote-tip == local-tip so a later un-pushed amend is never lost).
	const remoteTip = (
		await gitSoft(
			['rev-parse', '--verify', '--quiet', `refs/remotes/${arbiter}/${branch}`],
			cwd,
			env,
		)
	).stdout.trim();
	return remoteTip !== '' && remoteTip === localTip;
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
