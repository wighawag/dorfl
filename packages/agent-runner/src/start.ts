import {performClaim} from './claim-cas.js';
import {readItemLock} from './item-lock.js';
import {ledgerWrite} from './ledger-write.js';
import type {SurfaceToNeedsAttentionResult} from './needs-attention.js';
import {
	branchAheadOfArbiter,
	rebaseContinuedBranchOntoMain,
	pushContinuedBranchWithStaleLeaseRetry,
} from './continue-branch.js';
import {runAsync, type RunResult} from './git.js';
import {workFolderRel} from './work-layout.js';
import {workBranchRef, parseWorkBranchRef} from './slug-namespace.js';
import type {InteractiveLauncher} from './harness.js';

/**
 * `agent-runner start [<slug>]` — the human convenience that claims a task (only
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
	| 'needs-attention' // continued branch's rebase onto main conflicted → routed (§10)
	| 'surface-unmoved' // the tree-less surface to needs-attention did NOT land on the arbiter (lost the CAS race) — the item is STILL in-progress on the arbiter; retry/resolve
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
	 * Override the readiness guard (`--force` / `--ignore-not-ready`): claim a task
	 * with an unmet `blockedBy` anyway, and silence the `needsAnswers` warning —
	 * loudly. Forwarded to the claim CAS's human-path guard.
	 */
	override?: boolean;
	/**
	 * `--agent` (task `agent-interactive-launch`): after onboarding onto
	 * `work/<slug>`, launch the configured harness INTERACTIVELY in the checkout —
	 * a foreground session the human drives (no prepared prompt). Injected as a
	 * thin launcher so `start.ts` stays decoupled from `createHarness`: the CLI
	 * wires it to the resolved harness's `launchInteractive` (model/session/cwd
	 * resolved there). When omitted, start onboards and gets out of the way (its
	 * historical behaviour, unchanged). It is NOT a tracked job (decision #3): no
	 * job record, no gate — after exit the human drives `complete`/`requeue`.
	 */
	launchInteractive?: InteractiveLauncher;
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
type Folder =
	| 'tasks-todo'
	| 'in-progress'
	| 'needs-attention'
	| 'done'
	| 'absent';

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

	// Folder on the arbiter's main is the source of truth (NOT claimed_by) for the
	// DURABLE residence; HELD-NESS is read from the per-item LOCK ref, not a folder.
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const folder = await dispatchFolder(slug, arbiter, cwd, env);

	const result = await onboardFromFolder(folder, {
		options,
		slug,
		arbiter,
		cwd,
		env,
		note,
	});

	// `--agent` (task `agent-interactive-launch`): when the human onboarded onto a
	// work branch (started/resumed/resolved — exit 0 with a branch), launch the
	// configured harness INTERACTIVELY in the checkout so they can immediately drive
	// the agent. It is NOT a tracked job (decision #3): no record, no gate — it
	// blocks in the foreground until the human exits, then control returns and they
	// drive `complete`/`requeue`. On a failed/refused onboard we never launch.
	if (
		options.launchInteractive &&
		result.exitCode === 0 &&
		result.branch !== undefined
	) {
		note(`Launching the configured harness interactively in ${cwd}.`);
		options.launchInteractive({slug, dir: cwd, env});
	}
	return result;
}

/**
 * Resolve the EFFECTIVE dispatch folder, combining the durable `<arbiter>/main`
 * folder with the per-item LOCK ref. Since claim no longer moves the body, a
 * CLAIMED-AND-IN-FLIGHT task RESTS in `backlog/` on `main` (task
 * `cutover-claim-body-stays-and-complete-sources-from-backlog`), and a STUCK item
 * is the per-item lock `state: stuck` (NOT a `needs-attention/` folder file —
 * task `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision
 * i+: the folder is retired). So a folder-only check would mis-read either as
 * unclaimed and let `start` re-claim it. We re-key the dispatch off the LOCK when
 * the body is in `backlog/`:
 *   - held `active` (`action: implement`) ⇒ `in-progress` (already claimed:
 *     refuse / `--resume`);
 *   - held `stuck` ⇒ `needs-attention` (the recovery dispatch: print the reason,
 *     resume the lock `stuck → active`, onboard).
 * Everything else dispatches by folder unchanged.
 */
async function dispatchFolder(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<Folder> {
	const folder = await folderOnArbiterMain(slug, arbiter, cwd, env);
	if (folder !== 'tasks-todo') {
		return folder;
	}
	// In `backlog/`: claimed-ness + stuck-ness are the per-item lock, not the folder.
	const lock = await readItemLock({item: `task:${slug}`, cwd, arbiter, env});
	if (lock && lock.state === 'stuck') {
		return 'needs-attention';
	}
	if (lock && lock.state === 'active') {
		return 'in-progress';
	}
	return 'tasks-todo';
}

/** Dispatch the onboard by the slug's resolved (folder + lock) state. */
async function onboardFromFolder(
	folder: Folder,
	params: {
		options: StartOptions;
		slug: string;
		arbiter: string;
		cwd: string;
		env: NodeJS.ProcessEnv | undefined;
		note: (m: string) => void;
	},
): Promise<StartResult> {
	const {options, slug, arbiter, cwd, env, note} = params;
	switch (folder) {
		case 'tasks-todo':
			return startFromBacklog({
				slug,
				arbiter,
				cwd,
				env,
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
	override: boolean;
	note: (m: string) => void;
}): Promise<StartResult> {
	const {slug, arbiter, cwd, env, override, note} = params;

	// The human-path readiness guard lives in the claim CAS (so both `claim` and
	// `start` inherit it): an unmet `blockedBy` is refused (exit 1, 'not-ready')
	// unless overridden; a `needsAnswers` task warns but still claims.
	const claim = await performClaim({
		slug,
		cwd,
		arbiter,
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
	// human onto the work branch: CONTINUE from a kept arbiter work/<slug> when one
	// exists ahead of main (a requeue), else cut fresh off the NEW main (which
	// includes the claim).
	const switched = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	if (switched.rebaseConflict) {
		return continueConflictResult({slug, arbiter, cwd, env, note});
	}
	if (switched.pushFailure !== undefined) {
		return continuePushFailureResult({
			slug,
			arbiter,
			cwd,
			pushFailure: switched.pushFailure,
			env,
			note,
		});
	}
	const branch = switched.branch;
	const message = switched.continued
		? `Started '${slug}': claimed and continued ${branch} from the kept branch.`
		: `Started '${slug}': claimed and switched to ${branch}.`;
	note(message);
	return {exitCode: 0, outcome: 'started', branch, message};
}

/**
 * Build the terminal StartResult for a CONTINUE rebase conflict: route the item
 * to needs-attention (the §10 path) and return the 'needs-attention' outcome.
 */
async function continueConflictResult(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<StartResult> {
	const surfaced = await routeContinueConflict(params);
	if (!surfaced.moved) {
		return surfaceUnmovedStartResult({slug: params.slug, surfaced});
	}
	const message =
		`Could not continue '${params.slug}': the kept work branch did not rebase ` +
		`cleanly onto ${params.arbiter}/main; routed to work/needs-attention/ ` +
		'(surfaced by status). Resolve against the latest main, or `requeue --reset` ' +
		'to discard and start fresh.';
	return {
		exitCode: 1,
		outcome: 'needs-attention',
		branch: workBranchRef('task', params.slug),
		message,
	};
}

/**
 * Build the terminal StartResult for a CONTINUE reconcile-push that FAILED
 * TERMINALLY (the stale-lease retry cap exhausted, or a non-connectivity
 * rejection like a protected ref) \u2014 NOT a tolerated offline arbiter. Route the
 * item to needs-attention (the SAME \u00a712 surface the conflict path uses) so the
 * already-committed kept work is NOT left silently in-progress (the
 * stale-lease-strand bug this task kills), then return the 'needs-attention'
 * outcome with a message naming the push failure.
 */
async function continuePushFailureResult(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	pushFailure: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<StartResult> {
	const surfaced = await routeContinuePushFailure(params);
	if (!surfaced.moved) {
		return surfaceUnmovedStartResult({slug: params.slug, surfaced});
	}
	const message =
		`Could not continue '${params.slug}': publishing the rebased work branch to ` +
		`${params.arbiter} failed terminally (${params.pushFailure}); routed to ` +
		'work/needs-attention/ (surfaced by status), the kept branch left intact on ' +
		'the arbiter (recoverable). `requeue` to retry once the churn settles.';
	return {
		exitCode: 1,
		outcome: 'needs-attention',
		branch: workBranchRef('task', params.slug),
		message,
	};
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

	// Surface the recorded reason for the human, read from the STUCK LOCK ENTRY
	// (task `cutover-needs-attention-becomes-lock-stuck-recovery-surface`: the lock
	// is the sole stuck record — no `needs-attention/` folder file). The full reason
	// prose + any surfaced questions ride on the lock entry body.
	const stuck = await readItemLock({item: `task:${slug}`, cwd, arbiter, env});
	if (stuck?.reason) {
		note(`'${slug}' is stuck (needs-attention): ${stuck.reason}`);
	} else {
		note(`'${slug}' is stuck (needs-attention) — picking it up.`);
	}
	if (stuck?.questions && stuck.questions.length > 0) {
		note('Surfaced questions:');
		for (const q of stuck.questions) {
			note(`  - ${q}`);
		}
	}

	// Resume the lock `stuck → active` THROUGH the write seam (a pure lock amend, NO
	// `main` write, NO temp checkout — the body already rests in `backlog/` and the
	// work stays on the kept `work/<slug>` branch), then onboard onto work/<slug>.
	const resolved = await ledgerWrite.applyResolveNeedsAttentionTransition({
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

	// The lock is back to active (the human owns it). Onboard onto the work branch:
	// CONTINUE from a kept arbiter work/<slug> when present, else fresh off main.
	const switched = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	if (switched.rebaseConflict) {
		return continueConflictResult({slug, arbiter, cwd, env, note});
	}
	if (switched.pushFailure !== undefined) {
		return continuePushFailureResult({
			slug,
			arbiter,
			cwd,
			pushFailure: switched.pushFailure,
			env,
			note,
		});
	}
	const branch = switched.branch;
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
		// The folder drove the decision (WORK-CONTRACT rule 6: the folder + git
		// history are the source of truth). We do NOT name the claimer in the
		// message; whoever holds it is read from git history
		// (`git log work/in-progress/<slug>.md`).
		throw new StartRefusal(
			`'${slug}' is already in-progress; see \`git log\` for who claimed it; ` +
				'if this is your own work, re-run with --resume.',
		);
	}

	const switched = await switchToWorkBranch({slug, arbiter, cwd, env, note});
	if (switched.rebaseConflict) {
		return continueConflictResult({slug, arbiter, cwd, env, note});
	}
	if (switched.pushFailure !== undefined) {
		return continuePushFailureResult({
			slug,
			arbiter,
			cwd,
			pushFailure: switched.pushFailure,
			env,
			note,
		});
	}
	const branch = switched.branch;
	const message = `Resumed '${slug}': switched to ${branch} (no claim).`;
	note(message);
	return {exitCode: 0, outcome: 'resumed', branch, message};
}

/**
/** The outcome of onboarding the checkout onto `work/<slug>`. */
interface SwitchResult {
	/** The work branch landed on (`work/<slug>`). */
	branch: string;
	/** True iff we CONTINUED from a kept arbiter `work/<slug>` (not a fresh cut). */
	continued: boolean;
	/**
	 * True iff a CONTINUE rebase onto fresh main CONFLICTED (and was aborted,
	 * never auto-resolved). The caller routes the item to needs-attention (§10).
	 */
	rebaseConflict: boolean;
	/**
	 * Set iff the CONTINUE reconcile push to the arbiter FAILED TERMINALLY (the
	 * stale-lease retry cap was exhausted, or a non-connectivity rejection such as
	 * a protected ref) — NOT a tolerated offline/unreachable arbiter (which leaves
	 * the local rebased branch standing for `complete`'s later push, exactly as
	 * before). When present, the caller routes the item to needs-attention so the
	 * already-committed kept work is NOT left silently in-progress (the
	 * stale-lease-strand bug). Absent on a fresh cut, a clean continue that pushed,
	 * and the tolerated-offline case.
	 */
	pushFailure?: string;
}

/**
 * Onboard the checkout onto `work/<slug>`, CONTINUE-AWARE (the keystone of the
 * `requeue-continue-and-reset` task). `git fetch <arbiter>`, then:
 *
 *   - **CONTINUE** when the arbiter has a `work/<slug>` ref AHEAD of main (a
 *     `requeue` kept it): switch onto that kept branch (a local tracking branch
 *     off `<arbiter>/work/<slug>`) and REBASE it onto the freshly-fetched
 *     `<arbiter>/main` at onboard-time, so the agent builds on a CURRENT base
 *     (ADR §10: rebase, not merge). A CLEAN rebase continues; a CONFLICTING
 *     rebase is aborted (never auto-resolved) and reported so the caller routes
 *     to needs-attention. The rebased tip is published to the already-pushed
 *     work branch with `--force-with-lease` on the WORK branch only (a requeued
 *     item is unshared) — NEVER `--force` to main (§11).
 *   - **FRESH** otherwise (no kept branch — a first attempt, or a
 *     `requeue --reset` deleted it): `git switch -c work/<slug> <arbiter>/main`
 *     (today's behaviour). If the branch already exists LOCALLY (a re-run /
 *     resume) plain-switch to it.
 */
async function switchToWorkBranch(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<SwitchResult> {
	const {slug, arbiter, cwd, env, note} = params;
	// `start` is a TASK-only command: the branch is the task-namespaced
	// `work/task-<slug>` (distinct from a same-slug brief-tasking branch).
	const branch = workBranchRef('task', slug);

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// CONTINUE-detection (shared with the job-worktree path): does the arbiter
	// have a `work/<slug>` ref AHEAD of main? ARBITER-AUTHORITATIVE: `ls-remote`
	// the arbiter so a STALE local remote-tracking ref (a plain `git fetch` does
	// NOT prune unless `fetch.prune` is set — verified live in the task obs)
	// pointing at a branch the arbiter no longer has cannot resurrect a deleted
	// branch as a "continue". In a normal clone the local refs are the
	// remote-tracking `<arbiter>/work/<slug>` and `<arbiter>/main`.
	const ahead = branchAheadOfArbiter({
		cwd,
		arbiterRemote: arbiter,
		branch,
		branchRef: `${arbiter}/${branch}`,
		mainRef: `${arbiter}/main`,
		env,
	});
	if (ahead) {
		return continueFromKeptBranch({slug, arbiter, cwd, env, note});
	}

	// FRESH cut: prefer creating the branch off the latest arbiter main (it
	// includes the claim move). If it already exists locally, plain-switch to it.
	const created = await gitSoft(
		['switch', '--quiet', '-c', branch, `${arbiter}/main`],
		cwd,
		env,
	);
	if (created.status === 0) {
		return {branch, continued: false, rebaseConflict: false};
	}
	const switched = await gitSoft(['switch', '--quiet', branch], cwd, env);
	if (switched.status === 0) {
		return {branch, continued: false, rebaseConflict: false};
	}
	throw new StartUsageError(
		`failed to switch to ${branch}: ${created.stderr.trim() || switched.stderr.trim()}`,
	);
}

/**
 * CONTINUE onto a kept arbiter `work/<slug>`: switch onto it (resetting any
 * stale local branch to the arbiter tip), rebase onto the freshly-fetched
 * `<arbiter>/main`, and — on a CLEAN rebase — update the already-pushed work
 * branch with `--force-with-lease` on the WORK branch only (never main, §11). A
 * CONFLICTING rebase is aborted and reported (`rebaseConflict: true`).
 */
async function continueFromKeptBranch(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<SwitchResult> {
	const {slug, arbiter, cwd, env, note} = params;
	const branch = workBranchRef('task', slug);
	note(`Continuing '${slug}' from the kept ${arbiter}/${branch} (requeue).`);

	// Land the local work branch ON the kept arbiter tip (force-reset a stale
	// local branch so we continue the SAME single branch, not a divergent copy).
	await gitHard(
		['switch', '--quiet', '-C', branch, `${arbiter}/${branch}`],
		cwd,
		env,
	);

	// REBASE onto the freshly-fetched main at onboard-time (§10: rebase, not
	// merge) so the agent builds on a CURRENT base. Conflict → aborted + reported.
	const rebase = rebaseContinuedBranchOntoMain(cwd, `${arbiter}/main`, env);
	if (rebase.kind === 'conflict') {
		return {branch, continued: true, rebaseConflict: true};
	}

	// The arbiter `work/<slug>` tip the fetch above brought down, READ AFTER the
	// rebase — the rebase rewrote only the LOCAL branch, so the remote-tracking ref
	// `<arbiter>/<branch>` still holds the PRE-rebase arbiter sha (the value the
	// --force-with-lease push expects the arbiter to still hold). It is non-empty
	// here: `branchAheadOf` proved the ref resolves (the CONTINUE precondition).
	const expectedRemoteTip = (
		await gitHard(['rev-parse', `${arbiter}/${branch}`], cwd, env)
	).stdout.trim();

	// The rebase may have rewritten SHAs vs the already-pushed tip, so updating it
	// is a non-fast-forward. Reconcile with --force-with-lease on the WORK branch
	// ONLY (a requeued item is unshared) — NEVER --force, and NEVER to main (§11),
	// SURVIVING a stale-lease ("stale info") rejection by re-fetching + re-rebasing
	// + retrying (the SAME helper `workspace.ts`/`isolation.ts` use).
	//
	// BEST-EFFORT, but DISCRIMINATING (NOT a blanket swallow — the silent-strand
	// bug this guard kills): the helper THROWS, so we catch it and split the cause.
	// An OFFLINE / unreachable-arbiter throw is TOLERATED exactly as the bare
	// `gitSoft` push was — the local rebased branch is left, and `complete`'s push
	// handles it later. A REAL terminal failure (the stale-lease retry cap, or a
	// non-connectivity rejection like a protected ref) is NOT swallowed: it is
	// reported up as `pushFailure` so the caller surfaces the item to
	// needs-attention rather than leaving the committed kept work silently
	// in-progress.
	try {
		const pushed = pushContinuedBranchWithStaleLeaseRetry({
			cwd,
			branch,
			arbiter,
			mainRef: `${arbiter}/main`,
			expectedRemoteTip,
			env,
			note,
		});
		if (pushed.kind === 'conflict') {
			return {branch, continued: true, rebaseConflict: true};
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (isOfflinePushFailure(message)) {
			// Tolerated (today's behaviour): the arbiter is unreachable, so the local
			// rebased branch is left and `complete`'s later push handles it.
			note(
				`Could not push ${branch} to ${arbiter} (arbiter unreachable) — the ` +
					'local rebased branch is left; `complete` pushes it later.',
			);
		} else {
			// A REAL terminal failure — surface it (do NOT silently strand the work).
			return {
				branch,
				continued: true,
				rebaseConflict: false,
				pushFailure: message,
			};
		}
	}
	return {branch, continued: true, rebaseConflict: false};
}

/**
 * Discriminate the THROW from {@link pushContinuedBranchWithStaleLeaseRetry} at
 * the `start` continue-push site: is it a TOLERATED offline/unreachable-arbiter
 * outage (the existing best-effort case — `complete` pushes later), or a REAL
 * terminal failure that must SURFACE (the stale-lease retry cap exhausted, or a
 * non-connectivity rejection like a protected ref)?
 *
 * The helper throws ONLY two shapes: a `(not a stale lease)` push failure
 * carrying the raw git stderr, or a `kept failing with a stale --force-with-lease`
 * cap-exhausted message. The cap message is ALWAYS a real give-up. A non-stale
 * push failure is OFFLINE only when its stderr matches a git connectivity
 * signature (unable to access / could not read from remote / connection refused /
 * could not resolve host / ssh connect) — anything else (a protected ref, a hook
 * rejection) is a real failure that must surface. Conservative: an unmatched
 * cause is treated as a REAL failure (surface), never silently swallowed.
 */
function isOfflinePushFailure(message: string): boolean {
	// The retry-cap give-up is never "offline" — it is a real terminal failure.
	if (/kept failing with a stale --force-with-lease/i.test(message)) {
		return false;
	}
	return /unable to access|could not read from remote repository|connection (?:refused|reset|timed out)|could not resolve host|ssh: connect to host|network is unreachable|\bECONN(?:REFUSED|RESET)\b|\bENOTFOUND\b|\bETIMEDOUT\b/i.test(
		message,
	);
}

/**
 * Build the HONEST {@link StartResult} for a CONTINUE-site surface that did NOT
 * land on the arbiter (`{moved: false}`). The tree-less `in-progress/ →
 * needs-attention/` move lost the CAS race against a busy arbiter (its
 * contention-retry cap exhausted), so the item is STILL in-progress on the
 * arbiter — a clean `needs-attention` outcome would mislead (it claims the
 * surface landed). The DISTINCT `surface-unmoved` outcome carries
 * `reasonNotMoved` so the human can tell it apart from a successful surface and
 * retry/resolve.
 */
function surfaceUnmovedStartResult(params: {
	slug: string;
	surfaced: SurfaceToNeedsAttentionResult;
}): StartResult {
	const {slug, surfaced} = params;
	const message =
		`'${slug}' could NOT be surfaced to needs-attention — the surface did not ` +
		`reach the arbiter's main; the item is still IN-PROGRESS on the arbiter ` +
		`(retry/resolve). ${surfaced.reasonNotMoved ?? ''}`.trim();
	return {
		exitCode: 1,
		outcome: 'surface-unmoved',
		branch: workBranchRef('task', slug),
		message,
	};
}

/**
 * Route a CONTINUE rebase conflict to needs-attention (the §10 path): the kept
 * branch's commits did not replay cleanly onto the current main, so a human must
 * resolve (or `requeue --reset`).
 *
 * TREE-LESS (`#89` mechanism), the SAME-PROFILE sibling of
 * {@link routeContinuePushFailure}: the rebase was ABORTED, so the REAL continued
 * `work/<slug>` is already on the arbiter from the prior requeue, untouched
 * (after-commit, durable, recoverable). The surface is PURELY the one-file
 * `in-progress/ → needs-attention/` ledger `.md` move + reason — we publish it via
 * the tree-less surface CAS (the SAME no-checkout primitive `requeue` uses for the
 * reverse direction), NO temp-branch switch/restore, NO `pushBranch`, NO worktree.
 */
async function routeContinueConflict(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<SurfaceToNeedsAttentionResult> {
	const {slug, arbiter, cwd, env, note} = params;
	const reason =
		`continuing the kept ${arbiter}/${workBranchRef('task', slug)}: rebase onto ` +
		`${arbiter}/main conflicted (aborted, never auto-resolved) — resolve ` +
		'against the latest main, or `requeue --reset` to discard and start fresh';
	note(reason);
	// PROPAGATE the {moved, reasonNotMoved} result to the caller so a `moved:false`
	// (the surface did NOT reach main — lost the CAS race) is surfaced honestly
	// instead of swallowed as `void`.
	return ledgerWrite.applyTreelessNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter,
		env,
		note,
	});
}

/**
 * Route a CONTINUE reconcile-push TERMINAL failure to needs-attention (the §12
 * surface): the rebased work branch could not be published to the arbiter (the
 * stale-lease retry cap exhausted, or a non-connectivity rejection) — so rather
 * than leave the committed kept work silently in-progress, surface it on the
 * arbiter's main. Mirrors {@link routeContinueConflict}'s temp-branch pattern.
 *
 * TREE-LESS (`#89` mechanism): the recoverable artifact — the kept `work/<slug>`
 * — is ALREADY on the arbiter from the prior requeue (our local rebased tip is
 * what FAILED to push, so it is not the cross-machine truth), and the work is
 * already committed. So the surface is PURELY the one-file `in-progress/ →
 * needs-attention/` ledger `.md` move + reason: we publish it via the tree-less
 * surface CAS (the SAME no-checkout primitive `requeue` uses for the reverse
 * direction) — NO temp-branch switch/restore, NO `pushBranch`, NO worktree. A
 * `requeue` then continues from the kept arbiter tip.
 */
async function routeContinuePushFailure(params: {
	slug: string;
	arbiter: string;
	cwd: string;
	pushFailure: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<SurfaceToNeedsAttentionResult> {
	const {slug, arbiter, cwd, pushFailure, env, note} = params;
	const reason =
		`continuing the kept ${arbiter}/${workBranchRef('task', slug)}: publishing ` +
		`the rebased work branch to ${arbiter} failed terminally (${pushFailure}) — ` +
		'the kept branch is left intact on the arbiter (recoverable); `requeue` to ' +
		'retry once the churn settles, or `requeue --reset` to discard and start fresh';
	note(reason);
	// PROPAGATE the {moved, reasonNotMoved} result to the caller so a `moved:false`
	// (the surface did NOT reach main — lost the CAS race) is surfaced honestly
	// instead of swallowed as `void`.
	return ledgerWrite.applyTreelessNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter,
		env,
		note,
	});
}

/** If HEAD is a `work/<type>-<slug>` branch, return `<slug>`; else ''. */
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
	return parseWorkBranchRef(sym.stdout.trim())?.slug ?? '';
}

/** Which work/ folder the slug currently lives in on `<arbiter>/main`. */
async function folderOnArbiterMain(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<Folder> {
	const folders: Exclude<Folder, 'absent'>[] = [
		'tasks-todo',
		'in-progress',
		'needs-attention',
		'done',
	];
	for (const folder of folders) {
		const object = `${arbiter}/main:${workFolderRel(folder)}/${slug}.md`;
		if ((await gitSoft(['cat-file', '-e', object], cwd, env)).status === 0) {
			return folder;
		}
	}
	return 'absent';
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
