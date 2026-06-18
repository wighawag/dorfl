import {mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {
	acquireItemLock,
	readItemLock,
	releaseItemLock,
	resolveLockHolder,
} from './item-lock.js';
import {ledgerWrite} from './ledger-write.js';
import {resolveReadiness} from './readiness.js';
import {workBranchRef} from './slug-namespace.js';

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
 *   1  usage / environment error, or a readiness REFUSAL (unmet blockedBy)
 *   2  item not claimable (not in backlog, or lost the race to someone else)
 *   3  push kept failing after retries (transient/contended — try again later)
 *
 * INTERIM DUAL-WRITE (PRD `ledger-status-per-item-lock-refs`, ADR
 * `ledger-status-on-per-item-lock-refs`): a successful claim ALSO acquires the
 * item's unified per-item lock (`action: implement`) via the lock module, ON TOP
 * OF today's `git mv backlog→in-progress` CAS. The lock is acquired FIRST, so a
 * lock `lost` (the SAME item is already locked) makes the claim lose definitively
 * (exit 2, NO retry budget) and performs NO body move — the lock exclusion and the
 * shared-`main` CAS agree on the single winner. If the body move subsequently
 * loses/contends/errors the lock is RELEASED (never orphaned). Stopping the body
 * move / dropping the `main` write entirely is the capstone slice #9; here the
 * body STILL moves to `in-progress/` and `claimCommit` still lands on `main`.
 *
 * Before the CAS runs, the HUMAN path's readiness guard (resolveReadiness) is
 * applied: a slice with an unmet `blockedBy` is REFUSED (exit 1, outcome
 * 'not-ready') unless overridden; a `needsAnswers: true` slice is WARNED about
 * but still claimed. The autonomous runner does NOT pass `humanPath`, so its
 * behaviour is unchanged (eligibility already filters those items upstream).
 */

/** Maps onto the four claim.sh exit codes. */
export type ClaimExitCode = 0 | 1 | 2 | 3;

/** A semantic label for each exit code (for callers/tests, never the verdict). */
export type ClaimCasOutcome =
	| 'claimed'
	| 'usage-error'
	| 'lost'
	| 'contended'
	| 'not-ready';

export interface ClaimCasOptions {
	/** The slug to claim (`work/backlog/<slug>.md`). */
	slug: string;
	/** Working clone/worktree the claim runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Cap on push retries when main merely advanced (`--retries`). Default 3. */
	retries?: number;
	/** Show the intended push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/**
	 * Apply the human-path readiness guard before the CAS: refuse an unmet
	 * `blockedBy`, warn on `needsAnswers`. The HUMAN `claim`/`start` path sets
	 * this; the autonomous runner leaves it off (it filters upstream via
	 * eligibility and must NOT change behaviour here).
	 */
	humanPath?: boolean;
	/**
	 * Override flag (`--force` / `--ignore-not-ready`): bypass the readiness
	 * refusal and silence the `needsAnswers` warning, printing a loud notice that
	 * the guard was overridden. Only meaningful with `humanPath`.
	 */
	override?: boolean;
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
	/**
	 * The sha of the CLAIM COMMIT (`claim: <slug>`) that landed on the arbiter,
	 * on a SUCCESSFUL claim (`outcome === 'claimed'`, `exitCode === 0`) only.
	 * Surfaced so in-place onboarding can branch the work branch from the EXACT
	 * claim commit (and HARD-FAIL if it is not reachable) rather than a stale
	 * same-named branch or a not-yet-advanced local `<arbiter>/main`. Absent on a
	 * dry-run, lost/contended, or usage-error result.
	 */
	claimCommit?: string;
}

/**
 * The folder-based "lost" diagnostic, reused by the lock-`lost` path so its
 * message matches the CAS folder check's (recovery hints for a human re-running
 * their OWN item). Fetches the arbiter and inspects `work/in-progress/<slug>.md`
 * vs `work/backlog/<slug>.md`; falls back to the lock's generic message when the
 * body has not moved (lock held but body still in `backlog/` — the genuine
 * concurrent-acquire race). */
async function lostMessage(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	fallback: string,
): Promise<string> {
	await runAsync('git', ['fetch', '--quiet', arbiter], cwd, {env});
	const inProgress = `work/in-progress/${slug}.md`;
	if (await catFileExists(`${arbiter}/main:${inProgress}`, cwd, env)) {
		return `'${slug}' is already in-progress on ${arbiter}/main. If someone else claimed it, pick another item; if it's your own (e.g. an interrupted run), continue it with \`agent-runner resume ${slug}\` (or \`work-on\`), or recover via \`requeue\`.`;
	}
	return fallback;
}

/**
 * Self-heal an ORPHANED OWN lock at claim time. Returns `true` when we reclaimed a
 * stale lock that was OUR OWN (same holder) over a body that is genuinely
 * claimable in `backlog/` — the legitimate continue/re-claim of a requeued item
 * whose return-to-pool failed to clear the lock, or a crash-orphaned lock. Returns
 * `false` (the caller then loses definitively) when the lock is a GENUINE
 * concurrent holder: a DIFFERENT principal holds it, OR the body is no longer in
 * `backlog/` (someone has moved it to in-progress).
 *
 * The body-move CAS below remains the authoritative single-winner arbiter, so this
 * never lets two DISTINCT principals both proceed: a genuine concurrent racer has a
 * different holder, so we do NOT steal its lock and lose definitively instead. A
 * reclaim is release + re-acquire of our own ref; if the re-acquire then loses (a
 * true racer slipped in between), we do NOT proceed.
 */
async function reclaimOwnStaleLock(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	await runAsync('git', ['fetch', '--quiet', arbiter], cwd, {env});
	// The body must be genuinely claimable in backlog/ (not already in-progress).
	const backlog = `work/backlog/${slug}.md`;
	if (!(await catFileExists(`${arbiter}/main:${backlog}`, cwd, env))) {
		return false;
	}
	const held = await readItemLock({item: `slice:${slug}`, cwd, arbiter, env});
	if (!held) {
		// The lock vanished between the failed acquire and now — retry the acquire.
		const reacquire = await acquireItemLock({
			item: `slice:${slug}`,
			action: 'implement',
			cwd,
			arbiter,
			env,
		});
		return reacquire.outcome === 'acquired';
	}
	const ourHolder = await resolveLockHolder(cwd, env);
	if (held.holder !== ourHolder) {
		// A DIFFERENT principal holds it — a genuine concurrent holder. Do NOT steal.
		return false;
	}
	// Our own orphaned lock over a claimable body: release + re-acquire.
	await releaseItemLock({item: `slice:${slug}`, cwd, arbiter, env});
	const reacquire = await acquireItemLock({
		item: `slice:${slug}`,
		action: 'implement',
		cwd,
		arbiter,
		env,
	});
	return reacquire.outcome === 'acquired';
}

/** Raised for usage/environment errors (exit 1). */
class ClaimUsageError extends Error {}

/**
 * Raised for a deliberate readiness REFUSAL (exit 1, outcome 'not-ready') —
 * distinct from a usage/environment error. The slice has an unmet `blockedBy`
 * and the override was not supplied, so nothing is claimed.
 */
class ClaimNotReady extends Error {}

/** Internal: the result of a single claim attempt. */
type AttemptResult =
	| {kind: 'claimed'; message: string; claimCommit?: string}
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
		if (err instanceof ClaimNotReady) {
			return {exitCode: 1, outcome: 'not-ready', message: err.message};
		}
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
			'missing <slug>. usage: agent-runner claim <slug> [--arbiter remote]',
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

	// HUMAN-path readiness guard (run BEFORE the CAS so a not-ready slice is never
	// claimed). Reads the slice frontmatter + `work/done/` from `<arbiter>/main`
	// (the same source of truth the folder check uses) and resolves `blockedBy`
	// via the shared resolveBlockedBy. Skipped entirely for the autonomous runner
	// (no `humanPath`), whose eligibility filter already handles these upstream.
	if (options.humanPath) {
		await gitHard(['fetch', '--quiet', arbiter], cwd, env);
		const readiness = await resolveReadiness({
			slug,
			cwd,
			arbiter,
			override: options.override === true,
			env,
		});
		if (readiness.refuse) {
			const missing = readiness.missing.join(', ');
			const message =
				`'${slug}' is not ready: blocked by unmet dependencies not yet in ` +
				`work/done/ on ${arbiter}/main: ${missing}. ` +
				'Re-run with --force (or --ignore-not-ready) to claim it anyway.';
			note(message);
			throw new ClaimNotReady(message);
		}
		if (readiness.overridden && readiness.missing.length > 0) {
			note(
				`!! readiness guard OVERRIDDEN: claiming '${slug}' despite unmet ` +
					`blockedBy: ${readiness.missing.join(', ')} (not yet in work/done/).`,
			);
		}
		if (readiness.needsAnswers && !readiness.overridden) {
			note(
				`!! WARNING: '${slug}' is flagged needsAnswers: true — it has open ` +
					'questions (see the slice body). Claiming it anyway (human path); ' +
					'resolve the questions before/while building.',
			);
		} else if (readiness.needsAnswers && readiness.overridden) {
			note(
				`!! readiness guard OVERRIDDEN: silencing the needsAnswers warning for '${slug}'.`,
			);
		}
	}

	const backlog = `work/backlog/${slug}.md`;
	const inProgress = `work/in-progress/${slug}.md`;
	const claimBranch = `claim/${slug}`;

	// UNIFIED PER-ITEM LOCK (PRD `ledger-status-per-item-lock-refs` US #1/#3/#15/#16;
	// ADR `ledger-status-on-per-item-lock-refs`). INTERIM DUAL-WRITE: claim ALSO
	// acquires the item's per-item lock (`action: implement`) ALONGSIDE today's
	// `git mv backlog→in-progress` CAS. Acquire FIRST (before the body move), so a
	// lock `lost` (someone already holds this SAME item's lock) makes claim lose
	// DEFINITIVELY (no retry budget) WITHOUT ever moving the body — the lock
	// exclusion and the existing CAS agree on the single winner. A dry-run takes no
	// lock (it mutates nothing). When the body move/CAS subsequently loses or errors,
	// the lock we just took is RELEASED so it is never orphaned (the body never
	// moved, so releasing returns the item cleanly to the pool). The body-move /
	// `main`-write retarget (stop moving the body) is the capstone slice #9; here the
	// body STILL moves to `in-progress/` and `claimCommit` still lands on `main`.
	if (!dryRun) {
		const lock = await acquireItemLock({
			item: `slice:${slug}`,
			action: 'implement',
			cwd,
			arbiter,
			env,
		});
		if (lock.outcome === 'error') {
			// Environment/usage problem acquiring the lock — surface as exit 1, never a
			// false claim. Nothing moved.
			throw new ClaimUsageError(
				`failed to acquire the item lock for '${slug}': ${lock.message}`,
			);
		}
		if (lock.outcome === 'lost') {
			// We lost the create-only lock race. Two cases to tell apart:
			//
			//   (a) GENUINE concurrent holder — another writer (a DIFFERENT principal)
			//       holds this item's lock, or it has already moved the body to
			//       in-progress. We lose DEFINITIVELY (no retry budget) and perform NO
			//       body move — the lock and the CAS agree on the single winner.
			//   (b) OUR OWN ORPHANED lock — a prior in-flight cycle of THIS item by the
			//       SAME holder left a lock behind that the return-to-pool did not clear
			//       (or a crash), AND the body is back in `backlog/` (genuinely
			//       claimable). A legitimate continue/re-claim of our own requeued item
			//       must not deadlock on that stale ref. We reclaim it (release +
			//       re-acquire) and proceed; the body-move CAS below stays the
			//       authoritative single-winner arbiter, so this self-heal can never let
			//       two DISTINCT principals both proceed (their holders differ → no steal).
			const selfHealed = await reclaimOwnStaleLock(slug, arbiter, cwd, env);
			if (!selfHealed) {
				// (a): definitively lost. Prefer the FOLDER-based diagnostic (its recovery
				// hints — resume / work-on / requeue — are what a human re-running their
				// OWN item needs); fall back to the lock's generic message.
				const message = await lostMessage(
					slug,
					arbiter,
					cwd,
					env,
					lock.message,
				);
				note(message);
				return {exitCode: 2, outcome: 'lost', message};
			}
			note(
				`reclaimed our own stale item lock for '${slug}' (orphaned by a prior ` +
					'cycle; body is back in backlog) and proceeding with the claim.',
			);
		}
	}

	const origRef = await originalRef(cwd, env);

	/** Release the lock we just acquired (best-effort) — used when the body move
	 * subsequently loses/contends/errors, so the lock is never orphaned (the body
	 * never moved, so the item is cleanly returned to the pool). */
	async function releaseHeldLock(): Promise<void> {
		if (dryRun) {
			return;
		}
		await releaseItemLock({item: `slice:${slug}`, cwd, arbiter, env});
	}

	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await attempt({
				slug,
				arbiter,
				dryRun,
				cwd,
				env,
				backlog,
				inProgress,
				claimBranch,
				note,
			});
			if (result.kind === 'claimed') {
				return {
					exitCode: 0,
					outcome: 'claimed',
					message: result.message,
					claimCommit: result.claimCommit,
				};
			}
			if (result.kind === 'lost') {
				// The shared-`main` CAS says we lost the body (already in-progress / done /
				// removed). Release the lock we took so it is not orphaned.
				await releaseHeldLock();
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			// rejected: main moved under us — retry up to the cap, then back off.
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				await releaseHeldLock();
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
			// The next attempt re-checks claimability, so if we now LOST the item
			// it returns exit 2 (definitive), matching claim.sh.
		}
	} catch (err) {
		// A body-move plumbing failure after we took the lock: release it so the held
		// lock does not orphan an item whose body never moved, then re-throw for the
		// top-level handler to classify (exit 1).
		await releaseHeldLock();
		throw err;
	} finally {
		await cleanup(cwd, origRef, claimBranch, env);
	}
}

interface AttemptContext {
	slug: string;
	arbiter: string;
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

	// Is the item still claimable on the arbiter's main? The claimable predicate is
	// "in `backlog/` on `main` AND no lock held" (PRD US #15). The HELD-LOCK half is
	// enforced UPFRONT by `runClaim` acquiring the per-item lock BEFORE this loop (a
	// held slug already lost the create-only lock race → exit 2, no body move), so the
	// folder check here only needs to confirm `backlog/` residence — re-listing the
	// locks here would be redundant and racy against our own just-acquired lock.
	if (!(await catFileExists(`${arbiter}/main:${backlog}`, cwd, env))) {
		if (await catFileExists(`${arbiter}/main:${inProgress}`, cwd, env)) {
			const message = `'${slug}' is already in-progress on ${arbiter}/main. If someone else claimed it, pick another item; if it's your own (e.g. an interrupted run), continue it with \`agent-runner resume ${slug}\` (or \`work-on\`), or recover via \`requeue\`.`;
			note(message);
			return {kind: 'lost', message};
		}
		const message = `'${backlog}' not found on ${arbiter}/main (already done/removed, or wrong slug).`;
		note(message);
		return {kind: 'lost', message};
	}

	// Fresh claim branch off the latest arbiter main. DETACH onto `arbiter/main`
	// first so the throwaway claim branch can always be deleted: on a RETRY (the
	// push was rejected because main advanced) HEAD is still ON `claimBranch` from
	// the prior attempt, and `git branch -D <current-branch>` refuses — leaving a
	// stale branch that makes the re-`checkout -b` fail with "already exists".
	// Detaching first makes the delete + recreate idempotent across attempts. (This
	// retry path is hit far more often once `run` claims CONCURRENTLY — a sibling
	// job's integration advancing main is exactly what triggers the rejection.)
	await gitHard(
		['checkout', '--quiet', '--detach', `${arbiter}/main`],
		cwd,
		env,
	);
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

	// Who/when is recorded authoritatively by THIS commit (the folder + git
	// history — the committer identity and timestamp — are the source of truth;
	// there is no advisory claimed_by frontmatter field and no `(by ...)` subject
	// suffix; read the claimer with `git log` — see WORK-CONTRACT rule 6).
	await gitHard(['commit', '--quiet', '-m', `claim: ${slug}`], cwd, env);

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

	// Publish the prepared claim micro-commit THROUGH the write seam. The seam's
	// sole strategy is exactly today's behaviour — the `:main` push, the
	// `--force-with-lease=main:<base>` lease, and the post-push verify all live
	// inside the strategy (claim-cas no longer hard-wires the `main` push). The
	// seam is storage-agnostic: we hand it the transition KIND, the prepared local
	// branch, the CAS lease base, and the commit we expect to land.
	if (ctx.dryRun) {
		const result = await ledgerWrite.applyTransition({
			kind: 'claim',
			arbiter,
			localBranch: claimBranch,
			expectedBase: base,
			head,
			cwd,
			dryRun: true,
			env,
			note,
		});
		return {kind: 'claimed', message: result.message};
	}

	const result = await ledgerWrite.applyTransition({
		kind: 'claim',
		arbiter,
		localBranch: claimBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		// The seam stamps the claim commit with a per-attempt `CAS-Nonce` trailer, so
		// the sha that ACTUALLY landed on the arbiter is the nonce'd one the seam
		// reports back — NOT our pre-nonce `head` (its un-stamped sibling, which is
		// NOT on `<arbiter>/main`). Branch the work branch + report off the LANDED
		// sha so onboarding builds on the ledger tip, not a detached sibling.
		const landed = result.publishedHead ?? head;
		// Advance the LOCAL remote-tracking `<arbiter>/main` so it now INCLUDES the
		// claim commit (the push only moved the arbiter's main; the local tracking
		// ref stayed at the pre-claim sha). Onboarding then branches the work branch
		// off an `<arbiter>/main` that reaches the claim, and the printed "Start
		// work" hint is correct. Best-effort: a failed fetch leaves onboarding's own
		// fetch to advance it.
		await gitSoft(['fetch', '--quiet', arbiter], cwd, env);
		const branch = workBranchRef('slice', slug);
		const message = `CLAIMED '${slug}' -> work/in-progress/ on ${arbiter}/main.`;
		note(message);
		note(
			`Start work:  git fetch ${arbiter} && git switch -C ${branch} ${landed}`,
		);
		return {kind: 'claimed', message, claimCommit: landed};
	}
	return {kind: 'rejected', message: result.message};
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
