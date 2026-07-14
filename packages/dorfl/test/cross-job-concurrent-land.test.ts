import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performClaim} from '../src/claim-cas.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	rmrf,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * Story 13 (CROSS-JOB half) of
 * `work/prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md` +
 * Applied Answer q1 (a) — the SCALED `mergeRetries` cap is the git-alone
 * cross-job land queue. This file is the CROSS-PROCESS sibling of
 * `run-in-process-concurrent-land.test.ts`: two SEPARATE node processes race
 * the SAME bare arbiter ref, so the IN-PROCESS `integrateLock` (per-`runOnce`
 * keyed lock in `run.ts`) CANNOT serialise them — only the CAS-loop in
 * `performIntegration`'s merge-push tail can. That is exactly the surface this
 * task pins:
 *
 *   (1) Exactly one process's tree is the new `<arbiter>/main` tip after both
 *       finish (the loser composes on top via the re-rebase).
 *   (2) Within the configured `mergeRetries` cap, no process bounces to
 *       needs-attention purely for losing the CAS race — the loser re-rebases
 *       + re-gates + retries until it lands.
 *   (3) Past the cap, a loser bounces DETERMINISTICALLY to lock `state: stuck`
 *       with a CAS-EXHAUSTION reason ("non-fast-forward push (a sibling
 *       advanced main …)"), NEVER a phantom rebase-conflict reason.
 *   (4) `<arbiter>/main` never contains a tree that fails `verify`.
 *
 * The racers are spawned as their OWN node processes via `tsx`
 * (`test/helpers/cross-job-land-worker.ts`); the parent pre-seeds the bare
 * arbiter + per-racer working clones (each its own cwd), each racer's
 * `performClaim` + branch + edit happens in the parent so the race window is
 * the push, not the build. The cap flows through `mergeConfig` (the
 * `merge-retries-gate-precedence` precedence chain) inside the worker, so a
 * regression that drops that wiring fails THIS test loudly.
 *
 * Determinism without wall-clock dependency: a filesystem rendezvous
 * (`<rendezvousDir>/ready-<slug>` files) gates the workers — BOTH the
 * within-cap and past-cap scenarios wait for BOTH ready files before either
 * proceeds, so both arrive at the push concurrently and the CAS loop
 * arbitrates. In the past-cap case both racers carry `mergeRetries: 0`, so
 * whichever process loses the CAS race exhausts on attempt zero and routes
 * to needs-attention; the assertion is on the SHAPE of the loss (CAS-
 * exhaustion reason, stuck lock, winner's tree at tip), not on which slug
 * happened to lose. Past-cap determinism-by-slug is intentionally not a
 * requirement here — the deterministic broken-merge coverage lives in
 * `clean-rebase-semantic-break.test.ts`.
 *
 * Per the AGENTS.md / setup.ts isolation rule the worker process inherits the
 * test setup's pinned `GIT_*` identity + `/dev/null` global/system config, so
 * the child's git invocations see ONLY the per-clone config (no contention on
 * the developer's / CI's real `~/.gitconfig`).
 */

let scratch: Scratch;
let rendezvousDir: string;
beforeEach(() => {
	scratch = makeScratch('dorfl-cross-job-land-');
	rendezvousDir = mkdtempSync(join(tmpdir(), 'dorfl-rendezvous-'));
});
afterEach(() => {
	scratch.cleanup();
	rmrf(rendezvousDir);
});

const ARBITER = 'arbiter';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'cross-job-land-worker.ts');

interface WorkerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	parsed?: {
		outcome: string;
		reason: string | null;
		routedToNeedsAttention: boolean;
	};
}

/**
 * Spawn one worker process. Cwd is the per-racer working clone; the JSON
 * payload is the entire worker contract (no env-coupling — every parameter is
 * explicit), so a refactor of the worker shape can never accidentally read
 * test-process state.
 */
function spawnWorker(args: {
	cwd: string;
	slug: string;
	mergeRetries: number;
	expectedReadyCount?: number;
}): Promise<WorkerResult> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({
			cwd: args.cwd,
			slug: args.slug,
			arbiter: ARBITER,
			mergeRetries: args.mergeRetries,
			rendezvousDir,
			expectedReadyCount: args.expectedReadyCount ?? 2,
		});
		const child = spawn(TSX_BIN, [WORKER, payload], {
			env: gitEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.stderr.on('data', (d) => (stderr += d.toString()));
		child.on('error', reject);
		child.on('close', (code) => {
			const out: WorkerResult = {
				exitCode: code ?? -1,
				stdout,
				stderr,
			};
			try {
				out.parsed = JSON.parse(stdout.trim());
			} catch {
				// stdout was empty or unparseable — caller asserts on stderr/exit
			}
			resolve(out);
		});
	});
}

/** Pre-claim + pre-branch + pre-edit each slug in its OWN clone, ready for race. */
async function setupTwoRacers(slugA: string, slugB: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [slugA, slugB]);
	const setupOne = async (slug: string) => {
		const cwd = seeded.clone(`job-${slug}`);
		const claim = await performClaim({
			slug,
			cwd,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], cwd);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], cwd);
		// Disjoint editor — no textual conflict; the ONLY thing forcing a CAS
		// retry is the non-fast-forward push the loser hits.
		writeFileSync(join(cwd, `${slug}.txt`), `work for ${slug}\n`);
		return cwd;
	};
	const cwdA = await setupOne(slugA);
	const cwdB = await setupOne(slugB);
	return {seeded, cwdA, cwdB};
}

describe('cross-process concurrent merge land — only the CAS loop can serialise (Story 13 cross-job half)', () => {
	it('within the resolved `mergeRetries` cap, two SEPARATE processes both LAND (loser re-rebases + re-gates), one tree wins the tip, no spurious needs-attention bounce', async () => {
		// Both racers carry the default-large cap, plumbed through `mergeConfig`
		// inside the worker. Per Applied Answer q1: a wide-matrix CI raises the cap
		// so a CLEAN re-rebase no longer counts against a tight give-up budget —
		// the loser's round-trip is correctness-bounded by the gate, not by the
		// cap. With a high cap the disjoint-file race CONVERGES — both land.
		const {seeded, cwdA, cwdB} = await setupTwoRacers('xa', 'xb');

		const [a, b] = await Promise.all([
			spawnWorker({cwd: cwdA, slug: 'xa', mergeRetries: 1000}),
			spawnWorker({cwd: cwdB, slug: 'xb', mergeRetries: 1000}),
		]);

		// Both worker processes exited cleanly with a parseable result line —
		// no thrown plumbing error in the merge push.
		expect(a.exitCode, `worker A stderr: ${a.stderr}`).toBe(0);
		expect(b.exitCode, `worker B stderr: ${b.stderr}`).toBe(0);
		expect(a.parsed?.outcome).toBe('completed');
		expect(b.parsed?.outcome).toBe('completed');
		expect(a.parsed?.routedToNeedsAttention).toBe(false);
		expect(b.parsed?.routedToNeedsAttention).toBe(false);

		// (1) Exactly ONE tree at the tip; the OTHER landed earlier in history —
		// the external signature of a serialised land (both pushed, but ordered)
		// vs both pushing the same pre-merge base.
		gitIn(['fetch', '-q', ARBITER], seeded.repo);
		const subjects = gitIn(
			['log', '--format=%s', `${ARBITER}/main`],
			seeded.repo,
		)
			.trim()
			.split('\n');
		const doneSubjects = subjects.filter((s) => /; done$/.test(s));
		expect(doneSubjects).toHaveLength(2);
		const slugAt = (s: string) => s.match(/^feat\((xa|xb)\):/)?.[1];
		const tipSlug = slugAt(doneSubjects[0]);
		const histSlug = slugAt(doneSubjects[1]);
		expect(tipSlug).not.toBeUndefined();
		expect(histSlug).not.toBeUndefined();
		expect(tipSlug).not.toBe(histSlug);
		expect(new Set([tipSlug, histSlug])).toEqual(new Set(['xa', 'xb']));

		// (2) Within the cap, NEITHER racer bounces — no `state: stuck` for
		// EITHER per-item lock, no done-body missing from main.
		for (const slug of ['xa', 'xb']) {
			expect(stuckLockOnArbiter(seeded.repo, slug)).toBe(false);
			const lock = await readItemLock({
				item: `task:${slug}`,
				cwd: seeded.repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			if (lock !== undefined) {
				expect(lock.state).not.toBe('stuck');
			}
			expect(existsOnArbiterMain(seeded.repo, 'done', slug)).toBe(true);
		}

		// (4) `<arbiter>/main` never contains a tree that fails `verify`. The
		// `verify` command is trivial (`exit 0`) here by design (the brief asks
		// for the MINIMAL race scenario where the ONLY contention is the land
		// slot — the clean-rebase-but-broken-merge case is its own test,
		// `clean-rebase-semantic-break.test.ts`). We re-confirm externally
		// against the final tip.
		const verifyClone = seeded.clone('verify-tip');
		gitIn(['switch', '-q', '-c', 'verify-tip', `${ARBITER}/main`], verifyClone);
		const {spawnSync} = await import('node:child_process');
		const verifyRun = spawnSync('sh', ['-c', 'exit 0'], {
			cwd: verifyClone,
			env: gitEnv(),
		});
		expect(verifyRun.status).toBe(0);
	}, 60_000);

	it('past the `mergeRetries` cap (both racers cap=0) a loser bounces with a CAS-EXHAUSTION reason (NOT a phantom rebase-conflict), the winner lands, and `main` still verifies', async () => {
		// The past-cap branch: BOTH cross-process racers carry `mergeRetries: 0`
		// (the un-retried route — the test seam preserved by the
		// `DEFAULT_MERGE_RETRIES` C2 SCOPE box). Both rebase off the SAME
		// pre-merge `<arbiter>/main`, then race to push; the file://-transport
		// CAS arbitrates them, exactly ONE push fast-forwards, the OTHER hits
		// non-fast-forward and exhausts the cap on attempt zero — the cross-
		// process expression of `merge-retries-external.test.ts`'s cap=0 race,
		// with the IN-PROCESS `integrateLock` definitionally out of the
		// picture (two SPAWNED node processes share no in-memory lock).
		//
		// We assert on WHICHEVER racer lost (symmetric on slug A vs B); the
		// load-bearing claim is the SHAPE of the loss — CAS-exhaustion reason,
		// stuck lock with that same reason, no `--force`, no both-land — not
		// which slug happened to lose this run.
		const {seeded, cwdA, cwdB} = await setupTwoRacers('pa', 'pb');

		const [a, b] = await Promise.all([
			spawnWorker({cwd: cwdA, slug: 'pa', mergeRetries: 0}),
			spawnWorker({cwd: cwdB, slug: 'pb', mergeRetries: 0}),
		]);

		expect(a.exitCode, `worker A stderr: ${a.stderr}`).toBe(0);
		expect(b.exitCode, `worker B stderr: ${b.stderr}`).toBe(0);

		const landed = [a.parsed, b.parsed].filter(
			(r) => r?.outcome === 'completed',
		).length;
		// EXACTLY one landed (never zero: one push always fast-forwards; never
		// two: the CAS push refuses a non-fast-forward and cap=0 means no
		// retry, so the loser routes rather than landing). NEVER a `--force`
		// to main.
		expect(landed).toBe(1);

		const winnerIsA = a.parsed?.outcome === 'completed';
		const winner = winnerIsA
			? {slug: 'pa', parsed: a.parsed!}
			: {slug: 'pb', parsed: b.parsed!};
		const loser = winnerIsA
			? {slug: 'pb', parsed: b.parsed!}
			: {slug: 'pa', parsed: a.parsed!};

		// (1) Winner's tree IS the new `<arbiter>/main` tip; loser's done-body
		// is NOT on main (the cap-0 bounce never re-pushed).
		expect(existsOnArbiterMain(seeded.repo, 'done', winner.slug)).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', loser.slug)).toBe(false);
		expect(winner.parsed.routedToNeedsAttention).toBe(false);

		// (3) Loser carries the CAS-EXHAUSTION reason ("non-fast-forward push
		// (a sibling advanced main…)"), NOT a phantom rebase-onto-main
		// conflicted reason — the loser did not actually fail to rebase, it
		// failed to PUSH a fast-forward and ran out of retries. Both the
		// worker's returned `reason` AND the durable lock-ref `reason` (the
		// cross-substrate record a human reads) carry this distinction.
		expect(loser.parsed.outcome).toBe('rebase-conflict');
		expect(loser.parsed.routedToNeedsAttention).toBe(true);
		expect(loser.parsed.reason ?? '').toMatch(/non-fast-forward push/);
		expect(loser.parsed.reason ?? '').not.toMatch(/rebase onto .* conflicted/);

		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(seeded.repo, loser.slug)).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(seeded.repo, loser.slug)).toBe(true);
		expect(needsAnswersOnArbiterMain(seeded.repo, loser.slug)).toBe(true);
		// PR-2b: post-bounce the lock is released; the reason lives on the surfaced
		// sidecar (`<arbiter>/main`).
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-${loser.slug}.md`],
			seeded.repo,
		);
		expect(sidecar).toMatch(/non-fast-forward push/);
		expect(sidecar).not.toMatch(/rebase onto .* conflicted/);

		// The winner is unaffected — no spurious stuck record from racing.
		expect(stuckLockOnArbiter(seeded.repo, winner.slug)).toBe(false);

		// (4) Final `<arbiter>/main` still verifies — never a both-land-broken,
		// never a `--force` to main (the loser routed CLEANLY without
		// clobbering the winner's tip).
		const verifyClone = seeded.clone('verify-tip');
		gitIn(['switch', '-q', '-c', 'verify-tip', `${ARBITER}/main`], verifyClone);
		const {spawnSync} = await import('node:child_process');
		const verifyRun = spawnSync('sh', ['-c', 'exit 0'], {
			cwd: verifyClone,
			env: gitEnv(),
		});
		expect(verifyRun.status).toBe(0);
	}, 60_000);
});
