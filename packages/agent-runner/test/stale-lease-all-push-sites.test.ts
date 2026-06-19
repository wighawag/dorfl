import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	readFileSync,
	existsSync,
	mkdirSync,
	chmodSync,
} from 'node:fs';
import {join} from 'node:path';
import {inPlaceStrategy} from '../src/isolation.js';
import {createJob} from '../src/workspace.js';
import {performStart} from '../src/start.js';
import {performDoRemote, type DoAgentRunner} from '../src/do.js';
import {performClaim} from '../src/claim-cas.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * House style: a throwaway project + a local `--bare` arbiter; temp
 * `workspacesDir` (the agents' area); real shared dirs untouched. These tests
 * exercise the TWO sibling continue-path push sites that `#88` left unguarded
 * (`isolation.ts` in-place strategy + `start.ts` `continueFromKeptBranch`), now
 * routed through `pushContinuedBranchWithStaleLeaseRetry`, plus the Part-B
 * after-commit push-failure SURFACE to needs-attention (the job-worktree
 * `createJob` path the `--isolated` incident hit).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-stale-lease-sites-');
	// Isolate pi's session storage to scratch so the createJob/performDoRemote e2e
	// path never writes into the developer's real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * Drive a slice to a KEPT-branch-on-the-arbiter state (the requeue durable
 * artifact a continue resumes from): claim → cut work/<slug> → prior commit →
 * push the branch → route to needs-attention → requeue (keep) back to backlog.
 * Returns the seeded handle (its `repo` is the human checkout, on main).
 */
async function stuckThenRequeued(
	slug: string,
	opts: {reclaim?: boolean} = {},
): Promise<{seeded: SeededRepo}> {
	const reclaim = opts.reclaim ?? true;
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work (green, approved)'], repo);
	gitIn(['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`], repo);
	await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'gate red on the first attempt',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	const result = await returnToBacklog({
		cwd: repo,
		slug,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(result.moved).toBe(true);
	// The item is now back in BACKLOG on the arbiter with its kept work/<slug>
	// branch still present (the requeue durable artifact). The `start`/`isolation`
	// continue paths assume the item is already IN-PROGRESS (they onboard AFTER
	// their own claim), so by default re-claim. The `performDoRemote` e2e path
	// CLAIMS itself, so it needs the item left in backlog (`reclaim: false`).
	if (reclaim) {
		const reclaimed = await performClaim({
			slug,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(reclaimed.exitCode).toBe(0);
	}
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	return {seeded};
}

/** The arbiter's current sha for `work/<branch>` (via ls-remote on the bare repo). */
function arbiterWorkTip(arbiter: string, branch: string): string {
	const out = gitIn(
		['ls-remote', `file://${arbiter}`, `refs/heads/${branch}`],
		scratch.root,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/**
 * Advance the arbiter `work/<slug>` ref behind our back (a requeue-continue
 * churning it), so a lease computed against an earlier-observed tip is STALE.
 * Returns the new arbiter tip.
 */
function churnArbiterWorkBranch(
	arbiter: string,
	branch: string,
	file: string,
): string {
	const dest = join(
		scratch.root,
		`churn-${branch.replace(/\//g, '_')}-${file}`,
	);
	gitIn(['clone', '-q', `file://${arbiter}`, dest], scratch.root);
	gitIn(['switch', '-q', '-C', branch, `origin/${branch}`], dest);
	writeFileSync(join(dest, file), `${file}\n`);
	gitIn(['add', '-A'], dest);
	gitIn(['commit', '-q', '-m', `arbiter churned ${branch}`], dest);
	gitIn(['push', '-q', 'origin', `${branch}:${branch}`], dest);
	return arbiterWorkTip(arbiter, branch);
}

/**
 * Run `fn(env)` with a PATH-shimmed `git` (passed via the returned `env`) that
 * records every argv into `sink`, then delegates to the real git. Lets a test
 * assert the EXACT push flags a site used (the threaded `--force-with-lease=
 * <branch>:<tip>` lease, no bare --force, no `:main`). Mirrors the helper test's
 * `traceGit`.
 */
function traceGit<T>(sink: string[][], fn: (env: NodeJS.ProcessEnv) => T): T {
	const shimDir = join(
		scratch.root,
		`git-shim-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(shimDir, {recursive: true});
	const logFile = join(shimDir, 'argv.log');
	const shim = join(shimDir, 'git');
	writeFileSync(
		shim,
		[
			'#!/bin/sh',
			`printf '%s\\037' "$@" >> ${JSON.stringify(logFile)}`,
			`printf '\\036' >> ${JSON.stringify(logFile)}`,
			'PATH="$REAL_PATH" exec git "$@"',
			'',
		].join('\n'),
	);
	chmodSync(shim, 0o755);
	const base = gitEnv();
	const tracedEnv: NodeJS.ProcessEnv = {
		...base,
		REAL_PATH: base.PATH ?? process.env.PATH ?? '',
		PATH: `${shimDir}:${base.PATH ?? process.env.PATH ?? ''}`,
	};
	try {
		return fn(tracedEnv);
	} finally {
		if (existsSync(logFile)) {
			const raw = readFileSync(logFile, 'utf8');
			for (const rec of raw.split('\u001e')) {
				if (rec === '') continue;
				const args = rec.split('\u001f').filter((a) => a !== '');
				if (args.length > 0) sink.push(args);
			}
		}
	}
}

/** Assert the work-branch pushes obey the safety invariants (lease-only, never :main). */
function assertSafePushes(commands: string[][]): void {
	const pushes = commands.filter((c) => c.includes('push'));
	for (const cmd of pushes) {
		const joined = cmd.join(' ');
		// A work-branch reconcile push: skip the surface push of a ledger move
		// (its destination IS main and it is the leased CAS ff — handled elsewhere).
		if (/:main(\s|$)/.test(joined)) {
			// The only :main writes are leased CAS (force-with-lease=main:<base>), NEVER
			// a bare force.
			expect(joined).toMatch(/--force-with-lease=main:/);
			expect(cmd).not.toContain('--force');
			expect(cmd).not.toContain('-f');
			continue;
		}
		if (!joined.includes('work/slice-')) {
			continue;
		}
		// Work-branch push: --force-with-lease ONLY, never a bare --force.
		if (
			cmd.includes('--force-with-lease') ||
			/--force-with-lease=/.test(joined)
		) {
			expect(cmd).not.toContain('--force');
			expect(cmd).not.toContain('-f');
		}
	}
}

describe('Part A — isolation.ts in-place strategy: continue push via the stale-lease retry helper', () => {
	it('threads the pre-rebase arbiter tip as an EXPLICIT --force-with-lease=<branch>:<tip> (never bare force / :main)', async () => {
		const {seeded} = await stuckThenRequeued('alpha');
		// The pre-rebase arbiter work-branch tip (what the lease must expect).
		const preTip = arbiterWorkTip(seeded.arbiter, 'work/slice-alpha');

		const commands: string[][] = [];
		const tree = traceGit(commands, (env) =>
			inPlaceStrategy({checkout: seeded.repo, arbiter: ARBITER}).prepare({
				slug: 'alpha',
				type: 'slice',
				env,
			}),
		);
		expect(tree.continued).toBe(true);
		expect(tree.continueRebaseConflict).toBe(false);
		expect(tree.continuePushFailure).toBeUndefined();

		// The continue reconcile push used the EXPLICIT pre-rebase tip lease — the
		// load-bearing thread. A test that would FAIL if expectedRemoteTip were
		// omitted (the bare `--force-with-lease=<branch>` form) or wrong.
		const workPush = commands.find(
			(c) =>
				c.includes('push') &&
				c.some((a) => /^work\/slice-alpha:work\/slice-alpha$/.test(a)),
		);
		expect(workPush).toBeDefined();
		expect(workPush!.join(' ')).toContain(
			`--force-with-lease=work/slice-alpha:${preTip}`,
		);
		assertSafePushes(commands);

		// The work landed on the arbiter (clean ff — no churn here).
		expect(arbiterWorkTip(seeded.arbiter, 'work/slice-alpha')).toBe(
			gitIn(['rev-parse', 'HEAD'], seeded.repo).trim(),
		);
	});

	it('SURVIVES a stale-lease rejection: the arbiter churns the ref under the lease → re-fetch + re-rebase + retry lands the work', async () => {
		const {seeded} = await stuckThenRequeued('beta');
		// Deterministically make the FIRST leased work-branch push STALE: a git shim
		// that, the first time it sees the `work/slice-beta:work/slice-beta` push,
		// CHURNS the arbiter ref (advancing it past the lease's expected tip) BEFORE
		// delegating to the real push. That real push then fails `stale info`; the
		// helper re-fetches the churned tip, re-rebases cleanly, and retries — landing
		// the work. A one-shot sentinel ensures the churn fires exactly once.
		const shimDir = join(scratch.root, 'shim-beta');
		mkdirSync(shimDir, {recursive: true});
		const sentinel = join(shimDir, 'churn-once');
		writeFileSync(sentinel, '1');
		const shim = join(shimDir, 'git');
		// On the first `push <remote> work/slice-beta:work/slice-beta ...` (sentinel
		// present), churn the arbiter work ref via the REAL git, drop the sentinel,
		// then fall through to the requested push (now against a moved arbiter tip).
		writeFileSync(
			shim,
			[
				'#!/bin/sh',
				'export PATH="$REAL_PATH"',
				'case "$*" in',
				'  *"push"*"work/slice-beta:work/slice-beta"*)',
				`    if [ -f ${JSON.stringify(sentinel)} ]; then`,
				`      rm -f ${JSON.stringify(sentinel)}`,
				`      churndir="${join(scratch.root, 'shim-churn-beta')}"`,
				`      git clone -q "file://${seeded.arbiter}" "$churndir" >/dev/null 2>&1`,
				'      git -C "$churndir" switch -q -C work/slice-beta origin/work/slice-beta >/dev/null 2>&1',
				'      echo churned-by-shim > "$churndir/churned-beta.txt"',
				'      git -C "$churndir" add -A >/dev/null 2>&1',
				'      git -C "$churndir" -c user.name=Churn -c user.email=churn@x commit -q -m churn >/dev/null 2>&1',
				'      git -C "$churndir" push -q origin work/slice-beta:work/slice-beta >/dev/null 2>&1',
				'    fi',
				'    ;;',
				'esac',
				'exec git "$@"',
				'',
			].join('\n'),
		);
		chmodSync(shim, 0o755);
		const base = gitEnv();
		const shimEnv: NodeJS.ProcessEnv = {
			...base,
			REAL_PATH: base.PATH ?? process.env.PATH ?? '',
			PATH: `${shimDir}:${base.PATH ?? process.env.PATH ?? ''}`,
		};

		const tree = inPlaceStrategy({
			checkout: seeded.repo,
			arbiter: ARBITER,
		}).prepare({slug: 'beta', type: 'slice', env: shimEnv});
		expect(tree.continued).toBe(true);
		expect(tree.continueRebaseConflict).toBe(false);
		expect(tree.continuePushFailure).toBeUndefined();
		// The churn fired (sentinel consumed) — the stale-lease retry path WAS
		// exercised (the first leased push hit `stale info`).
		expect(existsSync(sentinel)).toBe(false);
		// RECOVERED: after the re-fetch + re-rebase + retry, the arbiter tip equals our
		// reconciled local tip — the green work LANDED instead of stranding (the
		// retry re-leased against the churned tip, an unshared work-branch ff). The
		// prior attempt's work is present (continued, never lost).
		expect(arbiterWorkTip(seeded.arbiter, 'work/slice-beta')).toBe(
			gitIn(['rev-parse', 'HEAD'], seeded.repo).trim(),
		);
		expect(existsSync(join(seeded.repo, 'prior.txt'))).toBe(true);
	});

	it('a CONFLICTING re-rebase routes to the conflict signal (continueRebaseConflict), never auto-resolved', async () => {
		const {seeded} = await stuckThenRequeued('gamma');
		// Main moves editing shared.txt one way; the kept branch edits it differently,
		// so the onboard rebase onto fresh main CONFLICTS.
		const mover = seeded.clone('mover-gamma');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main edits shared'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);
		// The kept work branch edits shared.txt too (re-point it on the arbiter).
		gitIn(
			['switch', '-q', '-C', 'work/slice-gamma', `${ARBITER}/work/slice-gamma`],
			mover,
		);
		writeFileSync(join(mover, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'branch edits shared'], mover);
		gitIn(['push', '-q', ARBITER, 'work/slice-gamma:work/slice-gamma'], mover);

		const tree = inPlaceStrategy({
			checkout: seeded.repo,
			arbiter: ARBITER,
		}).prepare({slug: 'gamma', type: 'slice', env: gitEnv()});
		expect(tree.continueRebaseConflict).toBe(true);
		expect(tree.continuePushFailure).toBeUndefined();
		// Never auto-resolved: the checkout is clean (the rebase was aborted).
		expect(gitIn(['status', '--porcelain'], seeded.repo).trim()).toBe('');
	});
});

describe('Part A — start.ts continueFromKeptBranch: continue push via the helper, best-effort PRESERVED', () => {
	it('continues + lands the kept work on the arbiter via the leased push (a fresh clone, like a different machine)', async () => {
		const {seeded} = await stuckThenRequeued('delta');
		// A different machine continuing: a fresh clone of the arbiter (the item is
		// in-progress on the arbiter after stuckThenRequeued's reclaim).
		const fresh = seeded.clone('continuer-delta');
		const started = await performStart({
			slug: 'delta',
			cwd: fresh,
			arbiter: ARBITER,
			resume: true,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(started.outcome).toBe('resumed');
		// The reconciled work tip is on the arbiter (the leased push landed it).
		expect(arbiterWorkTip(seeded.arbiter, 'work/slice-delta')).toBe(
			gitIn(['rev-parse', 'HEAD'], fresh).trim(),
		);
		// The prior work is present (continued, not fresh-cut).
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
	});

	it('TOLERATES an OFFLINE / unreachable arbiter at push time (best-effort): no hard failure, local rebased branch left for complete', async () => {
		const {seeded} = await stuckThenRequeued('epsilon');
		const fresh = seeded.clone('continuer-epsilon');
		// Isolate the PUSH connectivity failure (the read/fetch+rebase succeed against
		// a reachable arbiter; only the reconcile PUSH is unreachable). A git shim
		// fails the `work/slice-epsilon:work/slice-epsilon` push with a git CONNECTIVITY
		// stderr ("Could not read from remote repository") + non-zero exit, delegating
		// every OTHER git invocation (fetch, rebase, switch) to the real git. This is
		// the exact tolerated-offline case: the helper's first push throws a NON-stale
		// connectivity error, which the start.ts catch DISCRIMINATES as offline.
		const shimDir = join(scratch.root, 'shim-epsilon');
		mkdirSync(shimDir, {recursive: true});
		const shim = join(shimDir, 'git');
		writeFileSync(
			shim,
			[
				'#!/bin/sh',
				'export PATH="$REAL_PATH"',
				'case "$*" in',
				'  *"push"*"work/slice-epsilon:work/slice-epsilon"*)',
				'    echo "fatal: unable to access remote: Could not read from remote repository." 1>&2',
				'    exit 128',
				'    ;;',
				'esac',
				'exec git "$@"',
				'',
			].join('\n'),
		);
		chmodSync(shim, 0o755);
		const base = gitEnv();
		const shimEnv: NodeJS.ProcessEnv = {
			...base,
			REAL_PATH: base.PATH ?? process.env.PATH ?? '',
			PATH: `${shimDir}:${base.PATH ?? process.env.PATH ?? ''}`,
		};

		const started = await performStart({
			slug: 'epsilon',
			cwd: fresh,
			arbiter: ARBITER,
			resume: true,
			env: shimEnv,
		});
		// Best-effort: the unreachable arbiter does NOT turn start into a hard failure
		// nor a needs-attention surface — the local rebased branch is left for
		// complete's later push.
		expect(started.exitCode).toBe(0);
		expect(started.outcome).toBe('resumed');
		expect(currentBranch(fresh)).toBe('work/slice-epsilon');
	});

	it('SURFACES a REAL terminal push failure (a protected / denyNonFastForwards arbiter) to needs-attention — NOT silently swallowed', async () => {
		const {seeded} = await stuckThenRequeued('zeta');
		// Make the arbiter REJECT a forced (leased) non-fast-forward push: a protected
		// ref. The onboard rebase rewrites the branch SHAs (main moved), so the
		// reconcile push is a non-ff the lease forces — denyNonFastForwards rejects it
		// with a NON-"stale info" error → a real terminal failure.
		gitIn(['config', 'receive.denyNonFastForwards', 'true'], seeded.arbiter);
		// Move main so the onboard rebase rewrites the work-branch tip (forces a non-ff).
		const mover = seeded.clone('mover-zeta');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const fresh = seeded.clone('continuer-zeta');
		const started = await performStart({
			slug: 'zeta',
			cwd: fresh,
			arbiter: ARBITER,
			resume: true,
			env: gitEnv(),
		});
		// SURFACED, not swallowed: the run reports needs-attention and the slice is
		// STUCK on its per-item lock (NOT silently in-progress).
		expect(started.outcome).toBe('needs-attention');
		expect(started.exitCode).toBe(1);
		expect(stuckLockOnArbiter(fresh, 'zeta')).toBe(true);
		// RECOVERABLE: the kept work branch is still on the arbiter.
		expect(arbiterWorkTip(seeded.arbiter, 'work/slice-zeta')).not.toBe('');
	});
});

describe('Part B — after-commit push failure surfaces to needs-attention (job-worktree createJob path)', () => {
	it('PINS: a terminal continue push-failure no longer THROWS out of createJob; it flags continuePushFailure (recoverable)', async () => {
		const {seeded} = await stuckThenRequeued('eta');
		// A protected (denyNonFastForwards) arbiter + a moved main: the onboard rebase
		// rewrites the work tip, so the leased reconcile push is a non-ff the arbiter
		// REJECTS for a NON-stale reason → the helper THROWs. createJob must CATCH it
		// (flag continuePushFailure) instead of letting it escape (the strand bug).
		gitIn(['config', 'receive.denyNonFastForwards', 'true'], seeded.arbiter);
		const mover = seeded.clone('mover-eta');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const workspacesDir = join(scratch.root, '.agent-runner');
		// MUST NOT throw (the bug: it threw and escaped uncaught).
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'eta',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job.continued).toBe(true);
		expect(job.continueRebaseConflict).toBe(false);
		expect(job.continuePushFailure).toBeDefined();
		expect(job.continuePushFailure).toMatch(/failed|stale/i);
		// RECOVERABLE: the green work is still committed on the worktree branch.
		expect(existsSync(join(job.dir, 'prior.txt'))).toBe(true);
		job.dispose();
	});

	it('END-TO-END (performDoRemote, the EXACT --isolated incident path): an after-commit continue push-failure SURFACES to needs-attention on the arbiter, NOT silently in-progress, the agent NEVER runs, the kept branch recoverable', async () => {
		// The job-worktree/createJob path the original `--isolated` incident hit, end
		// to end: leave the kept work/<slug> in BACKLOG (performDoRemote claims it
		// itself), move main + protect the arbiter so the onboard continue reconcile
		// push of the rebased (already-committed) work branch is a non-ff the lease
		// forces — denyNonFastForwards REJECTS it with a NON-"stale info" error → a
		// REAL terminal push failure. The pipeline must SURFACE the slice to
		// needs-attention (step 2b in runOneItem / the Part-B fix), NOT crash + strand
		// it silently in work/in-progress/ on the arbiter (the observed bug).
		const {seeded} = await stuckThenRequeued('theta', {reclaim: false});
		gitIn(['config', 'receive.denyNonFastForwards', 'true'], seeded.arbiter);
		const mover = seeded.clone('mover-theta');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const ws = join(scratch.root, 'agents-area-theta');
		let agentRan = false;
		const neverAgent: DoAgentRunner = () => {
			agentRan = true;
			return {ok: true};
		};
		const result = await performDoRemote({
			arg: 'theta',
			remote: `file://${seeded.arbiter}`,
			workspacesDir: ws,
			integration: 'merge',
			// A gate that would EXPLODE if reached — proves the agent + gate are SKIPPED
			// (the push failed at onboard-time, before the agent ran).
			verify: 'echo GATE-RAN >&2; exit 1',
			agentRunner: neverAgent,
			env: gitEnv(),
		});

		// SURFACED, not swallowed nor crashed: the run reports needs-attention.
		expect(result.outcome).toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		// The agent NEVER ran (the onboard push failed first; the build is skipped).
		expect(agentRan).toBe(false);
		// The item is STUCK on its per-item lock and is NO LONGER in-progress (the
		// observed silent-strand bug, now closed on the incident's own path).
		expect(stuckLockOnArbiter(seeded.repo, 'theta')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'in-progress', 'theta')).toBe(
			false,
		);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'theta')).toBe(false);
		// The recorded reason names the push-failure cause.
		expect(result.message).toMatch(
			/publishing the rebased work branch|failed/i,
		);
		// RECOVERABLE: the kept green work branch is left intact on the arbiter.
		expect(arbiterWorkTip(seeded.arbiter, 'work/slice-theta')).not.toBe('');
		// performDoRemote materialises a hub mirror + job worktree (a real clone) and
		// drives the whole pipeline, so this e2e is genuinely slower than the
		// strategy-level tests above — give it headroom past the 5s default.
	}, 30000);
});

/** Current branch (short name) of a checkout. */
function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}
