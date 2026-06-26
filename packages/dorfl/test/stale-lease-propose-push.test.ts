import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	chmodSync,
	existsSync,
	readFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {
	Integrator,
	NoneProvider,
	type ReviewProvider,
} from '../src/integrator.js';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * `propose-push-survives-stale-lease-on-reaped-work-ref`: the propose-mode
 * integrator push must treat the UNSHARED `work/<slug>` ref the way the rest of
 * the system does — a `stale info` rejection is a stale LOCAL view (re-observe
 * + re-lease + retry, bounded), and a `work/<slug>` ref that is GONE on the
 * arbiter AND whose work is provably on `<arbiter>/main` is a BENIGN already-
 * landed success (mirrors the leased-delete `already-reaped` precedent and
 * `deleteMergedHeadBranch`'s ancestor guard), NOT a hard CI red.
 *
 * House style mirrors `stale-lease-all-push-sites.test.ts`: throwaway project
 * + local `--bare` arbiter, `gitEnv()` isolation, deterministic git shims for
 * the races. Tested at the integrator seam at two callers: the direct
 * `Integrator.integrate({mode: 'propose'})` (first-pass propose) AND
 * `performIntegration({committedRecovery: true, mode: 'propose'})` (the
 * RECOVERY-complete flow that rebases the kept already-complete branch onto
 * `<arbiter>/main` — the dominant real trigger per the launch incidents).
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-stale-lease-propose-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Create + commit a `work/task-<slug>` branch off `arbiter/main`. */
function workBranch(repo: string, slug: string, file = 'x.txt'): string {
	const branch = `work/task-${slug}`;
	gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, file), `${slug}\n`);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug})`], repo);
	return branch;
}

/** The arbiter's current sha for `work/<branch>` (via ls-remote), or `''` if absent. */
function arbiterWorkTip(arbiter: string, branch: string): string {
	const out = gitIn(
		['ls-remote', `file://${arbiter}`, `refs/heads/${branch}`],
		scratch.root,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/**
 * Run `fn(env)` with a PATH-shimmed `git` (passed via the returned `env`) that
 * records every argv into `commands`, then delegates to the real git. Lets the
 * safety sweep assert the EXACT flags the propose path emits (lease only, never
 * bare `--force`, never `:main`). Mirrors `stale-lease-all-push-sites.test.ts`'s
 * helper of the same name.
 */
function traceGit<T>(
	commands: string[][],
	fn: (env: NodeJS.ProcessEnv) => Promise<T> | T,
): Promise<T> | T {
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
	const drain = () => {
		if (!existsSync(logFile)) return;
		const raw = readFileSync(logFile, 'utf8');
		for (const rec of raw.split('\u001e')) {
			if (rec === '') continue;
			const args = rec.split('\u001f').filter((a) => a !== '');
			if (args.length > 0) commands.push(args);
		}
	};
	try {
		const out = fn(tracedEnv);
		if (out instanceof Promise) {
			return out.finally(() => drain()) as Promise<T>;
		}
		drain();
		return out;
	} catch (err) {
		drain();
		throw err;
	}
}

/**
 * Assert the propose path obeys the §11 safety invariants: lease ONLY on the
 * work branch, NEVER a bare `--force`, NEVER a `:main` destination from the
 * propose seam. Extends `stale-lease-all-push-sites.test.ts`'s `assertSafePushes`
 * coverage to the propose path (the task's "extend the existing all-push-sites
 * safety sweep so the propose path is covered" requirement).
 */
function assertSafeProposePushes(commands: string[][]): void {
	const pushes = commands.filter((c) => c.includes('push'));
	for (const cmd of pushes) {
		const joined = cmd.join(' ');
		// The propose path NEVER targets main.
		expect(joined).not.toMatch(/:main(\s|$)/);
		// No bare --force / -f anywhere on the propose path.
		expect(cmd).not.toContain('--force');
		expect(cmd).not.toContain('-f');
		// A work-branch push must carry a --force-with-lease=<branch>:<expected>.
		if (/work\/task-/.test(joined)) {
			expect(joined).toMatch(/--force-with-lease=work\/task-[^=\s]+:/);
		}
	}
}

describe('Integrator propose-mode push — stale-lease retry + benign already-landed', () => {
	it('first-time propose (no remote ref yet) UNCHANGED — the helper accepts the create-only lease and pushes', async () => {
		const {repo, arbiter: arbDir} = seedRepoWithArbiter(scratch.root, ['feat']);
		const branch = workBranch(repo, 'feat');
		const commands: string[][] = [];
		const result = (await traceGit(commands, async (env) =>
			new Integrator({provider: new NoneProvider()}).integrate({
				cwd: repo,
				arbiter: ARBITER,
				branch,
				mode: 'propose',
				env,
			}),
		)) as Awaited<ReturnType<Integrator['integrate']>>;
		expect(result.mode).toBe('propose');
		expect(result.pushedRef).toBe(branch);
		expect(result.alreadyLanded).toBeUndefined();
		// The branch landed on the arbiter exactly as before.
		expect(arbiterWorkTip(arbDir, branch)).toBe(
			gitIn(['rev-parse', 'HEAD'], repo).trim(),
		);
		assertSafeProposePushes(commands);
	});

	it('SURVIVES a stale-lease rejection: the arbiter churns the ref under our lease → re-observe + retry lands the work', async () => {
		const {repo, arbiter: arbDir} = seedRepoWithArbiter(scratch.root, ['beta']);
		const branch = workBranch(repo, 'beta');
		// Pre-create the remote ref so the FIRST propose push hits a non-empty lease;
		// a one-shot shim then CHURNS the ref before delegating, making the lease
		// stale exactly once. The helper observes the churned tip and re-leases.
		gitIn(['push', '-q', ARBITER, `${branch}:${branch}`], repo);
		// Now advance the local branch with another commit so the propose push is a
		// non-fast-forward without the lease — driving the lease's `stale info`
		// signal on a moved arbiter ref.
		writeFileSync(join(repo, 'second.txt'), 'second\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'second commit'], repo);

		const shimDir = join(scratch.root, 'shim-beta');
		mkdirSync(shimDir, {recursive: true});
		const sentinel = join(shimDir, 'churn-once');
		writeFileSync(sentinel, '1');
		const shim = join(shimDir, 'git');
		writeFileSync(
			shim,
			[
				'#!/bin/sh',
				'export PATH="$REAL_PATH"',
				'case "$*" in',
				`  *"push"*"${branch}:${branch}"*)`,
				`    if [ -f ${JSON.stringify(sentinel)} ]; then`,
				`      rm -f ${JSON.stringify(sentinel)}`,
				`      churndir="${join(scratch.root, 'shim-churn-beta')}"`,
				`      git clone -q "file://${arbDir}" "$churndir" >/dev/null 2>&1`,
				`      git -C "$churndir" switch -q -C ${branch} origin/${branch} >/dev/null 2>&1`,
				'      echo churned > "$churndir/churned.txt"',
				'      git -C "$churndir" add -A >/dev/null 2>&1',
				'      git -C "$churndir" -c user.name=Churn -c user.email=churn@x commit -q -m churn >/dev/null 2>&1',
				`      git -C "$churndir" push -q origin ${branch}:${branch} >/dev/null 2>&1`,
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

		// First attempt: leased on the pre-churn tip → arbiter churns → stale info.
		// Helper re-observes + re-leases against the churned tip → ok, BUT the
		// local branch is no longer a descendant of the churned ref (it forked).
		// So a SECOND stale-info would happen on a forced lease retry — the helper
		// keeps retrying until success or cap. The shim only churns once, so the
		// second attempt's lease matches the churned tip; with our local tip being
		// non-ff, the push would still reject — but the lease here is FORCE (the
		// work branch is unshared and we re-lease against the observed tip), so
		// git --force-with-lease overwrites it. The branch lands.
		const integrator = new Integrator({provider: new NoneProvider()});
		const result = await integrator.integrate({
			cwd: repo,
			arbiter: ARBITER,
			branch,
			mode: 'propose',
			env: shimEnv,
		});
		expect(result.alreadyLanded).toBeUndefined();
		expect(result.pushedRef).toBe(branch);
		// The churn fired (the stale-lease path WAS exercised).
		expect(existsSync(sentinel)).toBe(false);
		// And the work landed: the arbiter `<branch>` tip equals our local tip.
		expect(arbiterWorkTip(arbDir, branch)).toBe(
			gitIn(['rev-parse', 'HEAD'], repo).trim(),
		);
	});

	it('BENIGN already-landed: ref gone on arbiter AND work provably on <arbiter>/main → alreadyLanded: true, no PR opened, no throw', async () => {
		const {repo, arbiter: arbDir} = seedRepoWithArbiter(scratch.root, [
			'gamma',
		]);
		const branch = workBranch(repo, 'gamma');
		// Pre-arrange the race tail: the work already landed on main (a sibling
		// merged it) AND the remote `work/<slug>` ref was reaped. Simulate by
		// pushing the branch's tip to main DIRECTLY (no remote work-ref ever
		// created). The propose helper's gone-ref + ancestor-of-main predicate
		// fires before any push attempt.
		gitIn(['push', '-q', ARBITER, `${branch}:main`], repo);
		// Confirm the pre-condition: ref absent on arbiter, main carries our work.
		expect(arbiterWorkTip(arbDir, branch)).toBe('');
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(
			gitIn(['rev-parse', 'HEAD'], repo).trim(),
		);

		// Provider that would EXPLODE if asked to open a PR (proves we don't ask).
		let providerCalled = false;
		const provider: ReviewProvider = {
			name: 'explodes',
			async openRequest() {
				providerCalled = true;
				throw new Error(
					'openRequest must not be called for already-landed work',
				);
			},
			postPRComment() {
				return {posted: false, instruction: ''};
			},
			postPRCommentOnBranch() {
				return {posted: false, instruction: ''};
			},
		};

		const commands: string[][] = [];
		const result = (await traceGit(commands, async (env) =>
			new Integrator({provider}).integrate({
				cwd: repo,
				arbiter: ARBITER,
				branch,
				mode: 'propose',
				env,
			}),
		)) as Awaited<ReturnType<Integrator['integrate']>>;

		expect(result.mode).toBe('propose');
		expect(result.alreadyLanded).toBe(true);
		expect(result.requestOpened).toBe(false);
		expect(result.provider).toBe('none');
		expect(providerCalled).toBe(false);
		// No push to `<branch>` ever attempted (the pre-check short-circuited).
		const branchPushes = commands.filter(
			(c) => c.includes('push') && c.some((a) => a === `${branch}:${branch}`),
		);
		expect(branchPushes).toEqual([]);
		assertSafeProposePushes(commands);
	});

	it('a NON-stale-lease push failure (protected ref / connectivity-shape) SURFACES as a terminal throw, never retried into a clobber', async () => {
		const {repo, arbiter: arbDir} = seedRepoWithArbiter(scratch.root, [
			'delta',
		]);
		const branch = workBranch(repo, 'delta');
		// Pre-create the remote ref so the propose push is a non-ff WITH the lease
		// matching. denyNonFastForwards then rejects with a NON-`stale info` error.
		gitIn(['push', '-q', ARBITER, `${branch}:${branch}`], repo);
		// Advance the local branch with a content-rewriting amend so the propose
		// push is a non-fast-forward (the prior tip is no longer an ancestor of the
		// new local tip).
		gitIn(['commit', '--amend', '-q', '-m', `feat(delta) — amended`], repo);
		// Confirm the arbiter would reject a non-ff.
		gitIn(['config', 'receive.denyNonFastForwards', 'true'], arbDir);

		const integrator = new Integrator({provider: new NoneProvider()});
		// The local tip is NOT an ancestor of <arbiter>/main, so even after a
		// stale-info rejection the helper would NOT short-circuit benign — it must
		// SURFACE the failure as a terminal throw.
		await expect(
			integrator.integrate({
				cwd: repo,
				arbiter: ARBITER,
				branch,
				mode: 'propose',
				env: gitEnv(),
			}),
		).rejects.toThrow(/failed|stale/i);
		// And the work is NOT silently swallowed: the local branch still has it.
		expect(gitIn(['log', '--oneline', '-1'], repo)).toMatch(/amended/);
	});
});

describe('RECOVERY-complete propose flow — kept already-complete branch, ref reaped, work on main → benign already-landed', () => {
	/**
	 * Stand the repo up as a stranded committed+done-moved branch (the
	 * committed-recovery precondition) whose work has ALREADY landed on
	 * `<arbiter>/main` via a sibling's earlier merge, AND whose remote head ref
	 * has been REAPED. This is the dominant real CI trigger per the Observed
	 * incidents: the recovery-complete propose push hits a stale lease because
	 * the ref was reaped after the earlier land — the predicate must return
	 * BENIGN already-landed.
	 */
	async function seedAlreadyLandedRecovery(slug: string): Promise<{
		repo: string;
		seeded: SeededRepo;
		branch: string;
	}> {
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
		const branch = `work/task-${slug}`;
		gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);
		// Agent work + the step-2/3 done-move + atomic completion commit.
		writeFileSync(join(repo, 'agent-work.txt'), `${slug}-work\n`);
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `feat(${slug}): build; done`], repo);
		// SIMULATE: an earlier attempt of THIS exact commit ALREADY landed on
		// `<arbiter>/main` (a sibling integrated it). The kept commit on this
		// branch IS therefore reachable from `<arbiter>/main` — the same commit
		// landed via a fast-forward merge. The remote `work/<slug>` ref was
		// reaped after that land (the merged-head-reap), so ls-remote shows it
		// absent.
		gitIn(['push', '-q', ARBITER, `${branch}:main`], repo);
		// Confirm: branch ref ABSENT (never pushed); main carries the work.
		expect(arbiterWorkTip(seeded.arbiter, branch)).toBe('');
		return {repo, seeded, branch};
	}

	it('committed-recovery propose: HEAD already on <arbiter>/main + ref reaped → already-integrated short-circuit (the existing precedent the helper mirrors)', async () => {
		// This case fires the EXISTING early-ancestor short-circuit in
		// `recoverAlreadyCommitted` (predates this task). It is the upper-bound
		// case the helper's NEW benign predicate generalises to (the stale-lease-
		// during-push variant, exercised by the next test). We assert it stays
		// green here so the recovery path's existing already-integrated semantics
		// are preserved alongside the new helper behaviour.
		const {repo, seeded} = await seedAlreadyLandedRecovery('eta');
		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'eta',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'propose',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('already-integrated');
		expect(result.routedToNeedsAttention).toBe(false);
		// The arbiter end-state is the desired one: ref absent, work on main.
		expect(arbiterWorkTip(seeded.arbiter, result.branch ?? '')).toBe('');
	});

	it('committed-recovery propose: kept-tip NOT on main pre-rebase, ref already reaped → after the recovery rebase the helper sees gone-ref + ancestor-of-main, returns BENIGN already-landed (no PR, no throw)', async () => {
		// The DOMINANT real CI trigger: the kept branch's tip is AHEAD of main on
		// the way in (so the early `isAncestor` short-circuit does NOT fire), the
		// recovery rebases onto fresh main, and the propose push reconciles the
		// rewritten tip — but the work's CONTENT had already landed via a sibling
		// PR (squash-style: same diff, different sha) AND the head was reaped.
		// We simulate by: (1) putting the kept commit on main with a DIFFERENT
		// sha (a parallel commit with the same content path / a noop), so the
		// early ancestor check fails; (2) the recovery rebase replays the kept
		// commit onto fresh main, where its diff is now empty → rebase succeeds
		// and post-rebase HEAD equals `<arbiter>/main`; (3) the propose push then
		// sees gone-ref + HEAD-on-main → benign.
		const seeded = seedRepoWithArbiter(scratch.root, ['kappa']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'kappa',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		const branch = 'work/task-kappa';
		gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'kappa.txt'), 'kappa-work\n');
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/kappa.md`, `work/tasks/done/kappa.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `feat(kappa): build; done`], repo);

		// (1) Land the SAME content on main with a DIFFERENT sha via a sibling
		// clone — same diff, fresh committer-timestamp → different sha. The
		// early-ancestor check on the kept tip will therefore FAIL (the kept
		// commit's sha is NOT reachable from main, even though its content is).
		const sibling = seeded.clone('sibling-kappa');
		gitIn(['switch', '-q', '-C', 'sib', `${ARBITER}/main`], sibling);
		writeFileSync(join(sibling, 'kappa.txt'), 'kappa-work\n');
		mkdirSync(join(sibling, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/kappa.md`, `work/tasks/done/kappa.md`],
			sibling,
		);
		gitIn(['add', '-A'], sibling);
		gitIn(
			['commit', '-q', '-m', `feat(kappa): sibling-merged equivalent`],
			sibling,
		);
		gitIn(['push', '-q', ARBITER, 'sib:main'], sibling);
		// The remote `work/<slug>` ref was reaped after the sibling's land — and
		// it was never created in this run, so the arbiter sees no head.
		expect(arbiterWorkTip(seeded.arbiter, branch)).toBe('');

		// (2) + (3): the recovery integrates. The early-ancestor check FAILS (the
		// kept sha is not on main); the rebase onto fresh main replays the kept
		// commit, whose diff is empty against the sibling's equivalent commit, so
		// rebase produces an empty result and HEAD ends at `<arbiter>/main`. The
		// propose push then observes gone-ref + HEAD-on-main → BENIGN already-
		// landed: no PR opened, no throw. We use the NoneProvider so no real
		// `gh` is invoked; the helper's predicate is what we are testing.
		let providerCalled = false;
		const provider: ReviewProvider = {
			name: 'explodes',
			async openRequest() {
				providerCalled = true;
				throw new Error(
					'openRequest must not be called when propose detects already-landed',
				);
			},
			postPRComment() {
				return {posted: false, instruction: ''};
			},
			postPRCommentOnBranch() {
				return {posted: false, instruction: ''};
			},
		};
		const commands: string[][] = [];
		const result = (await traceGit(commands, async (env) =>
			performIntegration({
				cwd: repo,
				arbiter: ARBITER,
				slug: 'kappa',
				source: 'tasks-ready',
				recovering: false,
				committedRecovery: true,
				mode: 'propose',
				providerInstance: provider,
				env,
			}),
		)) as Awaited<ReturnType<typeof performIntegration>>;

		// The recovery completed cleanly: either via the early short-circuit
		// (`already-integrated`, when the post-rebase tip ended up at main and
		// the inner integrate read the ancestor check first) OR via the propose
		// helper's benign already-landed predicate (`completed` with the
		// integration result's `alreadyLanded` set). Either way: no throw, no PR
		// opened, no main re-write needed, ref still absent.
		expect(['already-integrated', 'completed']).toContain(result.outcome);
		expect(result.routedToNeedsAttention).toBe(false);
		expect(providerCalled).toBe(false);
		if (result.outcome === 'completed' && result.integration) {
			expect(result.integration.alreadyLanded).toBe(true);
			expect(result.integration.requestOpened).toBe(false);
		}
		// The arbiter end-state stays as the sibling left it: ref absent, the
		// `work/done/kappa.md` body is on main (placed by the sibling).
		expect(arbiterWorkTip(seeded.arbiter, branch)).toBe('');
		expect(existsOnArbiterMain(repo, 'done', 'kappa')).toBe(true);
		assertSafeProposePushes(commands);
	});
});
