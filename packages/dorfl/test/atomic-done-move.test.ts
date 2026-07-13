import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	rmrf,
} from './helpers/gitRepo.js';

/**
 * The ledger-integrity hardening (PRD `work/prds/tasked/ledger-integrity.md`,
 * defect 1 + its root defect 2): the integration done-move must be ATOMIC against
 * the ARBITER's current status folder, and the one-slug-one-folder invariant must
 * hold on the transition — a merge can NEVER land `done/` while leaving an
 * `in-progress/` (or `needs-attention/`) GHOST behind.
 *
 * House style (mirrors `integration-core.test.ts`): a throwaway checkout + a local
 * `--bare` arbiter, `gitEnv()` isolation (`GIT_CONFIG_GLOBAL=/dev/null` …), temp
 * workspace dirs. `merge` mode is used so the done-move's effect actually LANDS on
 * `<arbiter>/main` and we can assert the merged ledger directly.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-atomic-done-move-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/**
 * Claim a slug (acquires the lock; the body RESTS in `backlog/<slug>` on the
 * arbiter, since claim no longer moves it) and branch off the freshly-fetched main
 * with UNCOMMITTED agent work — exactly as the caller's HEAD leaves it just before
 * the core.
 */
async function claimAndBranch(slug: string) {
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
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

/**
 * The `--allow-backlog` analogue of {@link claimAndBranch} (prd
 * `do-allow-backlog-drive-staged-tasks-without-promotion`): seed a STAGED task
 * (`tasks/backlog/<slug>`), claim it under the flag (the body RESTS in staging),
 * and branch off main with uncommitted agent work.
 */
async function claimAndBranchStaged(slug: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [], {staged: [slug]});
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		allowBacklog: true,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

describe('atomic done-move — --allow-backlog staged source (tasks/backlog/ → done/)', () => {
	// prd `do-allow-backlog-drive-staged-tasks-without-promotion`, decision 4: the
	// done-move sources from `tasks-backlog` and the arbiter is the authority for
	// the actual source folder (the arbiter holds the slug in tasks/backlog/).
	it('a staged source done-moves tasks/backlog/ → tasks/done/ directly (the move is a MOVE)', async () => {
		const {repo} = await claimAndBranchStaged('staged');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'staged',
			source: 'tasks-backlog',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// Landed in done/ ONLY — the arbiter-resolved source (tasks/backlog/) was
		// removed; the move is a move, not a copy.
		expect(existsOnArbiterMain(repo, 'done', 'staged')).toBe(true);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'staged')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'staged')).toBe(false);
	});

	it('the arbiter-side reconciler resolves a tasks/backlog/-resident slug even when a SIBLING advanced main (rebase reconcile)', async () => {
		// A sibling job lands its OWN done-move on <arbiter>/main between our claim and
		// our rebase. Our staged done-move must still rebase + land cleanly, with the
		// arbiter resolving OUR slug's source folder (tasks/backlog/) correctly.
		const {seeded, repo} = await claimAndBranchStaged('staged');

		// Sibling advances main with an unrelated ledger move (its own done file).
		const sibling = seeded.clone('sibling');
		gitIn(['switch', '-q', '-c', 'sibling/x', `${ARBITER}/main`], sibling);
		mkdirSync(join(sibling, 'work', 'tasks', 'done'), {recursive: true});
		writeFileSync(
			join(sibling, 'work', 'tasks', 'done', 'sibling-x.md'),
			'---\ntitle: sibling-x\nslug: sibling-x\n---\n\ndone elsewhere\n',
		);
		gitIn(['add', '-A'], sibling);
		gitIn(['commit', '-q', '-m', 'done: sibling-x'], sibling);
		gitIn(['push', '-q', ARBITER, 'sibling/x:main'], sibling);
		rmrf(sibling);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'staged',
			source: 'tasks-backlog',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'staged')).toBe(true);
		expect(existsOnArbiterMain(repo, 'pre-backlog', 'staged')).toBe(false);
		// The sibling's move is untouched.
		expect(existsOnArbiterMain(repo, 'done', 'sibling-x')).toBe(true);
	});
});

describe('atomic done-move — the move is a MOVE, not a COPY (defect 1)', () => {
	// NOTE: the historical divergent-base scenario (the arbiter holds the slug in a
	// TRANSIENT folder — `in-progress/`/`needs-attention/` — while the branch base has
	// it elsewhere) is RETIRED by the capstone cut-over (task
	// `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`): the only
	// `work/` moves on `main` are the durable resting transitions, the body always
	// rests in `backlog/` until the durable promotion, and the stuck surface is a lock
	// amend (never a `needs-attention/` folder ghost). The remaining divergent case a
	// merge must still handle correctly is a backlog/-vs-done/ duplicate — the
	// FAIL-LOUD corrupt-ledger test below.
	it('the normal backlog/ path still lands done/ ONLY (no regression)', async () => {
		const {repo} = await claimAndBranch('beta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});
});

describe('one-slug-one-folder invariant — FAIL LOUD on a two-folder slug (defect 2)', () => {
	it('the arbiter already holds the slug in TWO status folders pre-transition: the done-move FAILS LOUD rather than publishing a corrupt ledger', async () => {
		const {seeded, repo} = await claimAndBranch('gamma');
		// Corrupt the arbiter: ADD a stale done/gamma.md alongside the live
		// backlog/gamma.md (the exact PR #86 corruption — a slug in two folders).
		const other = seeded.clone('corrupt');
		gitIn(['switch', '-q', '-c', `corrupt/gamma`, `${ARBITER}/main`], other);
		mkdirSync(join(other, 'work', 'tasks', 'done'), {recursive: true});
		// DISTINCT content from the in-progress copy, so the auto-clean
		// "provably-safe (identical content)" escape hatch does NOT apply — it must
		// fail loud, never silently pick one.
		writeFileSync(
			join(other, 'work', 'tasks', 'done', 'gamma.md'),
			'---\ntitle: gamma\nslug: gamma\n---\n\nA DIFFERENT, stale copy.\n',
		);
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'corrupt: gamma in two folders'], other);
		gitIn(['push', '-q', ARBITER, 'corrupt/gamma:main'], other);
		rmrf(other);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		// FAIL LOUD: the transition refuses rather than publish a corrupt ledger.
		expect(core.outcome).not.toBe('completed');
		expect(core.reason).toMatch(
			/one-slug-one-folder|two .*folders|more than one/i,
		);
		// Nothing corrupt landed: the stale done/ copy is untouched, backlog/
		// still present (we did NOT silently delete either side).
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
	});
});
