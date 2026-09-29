import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performClaim} from '../src/claim-cas.js';
import {performAdvanceAuto} from '../src/advance-drivers.js';
import {performAdvance} from '../src/advance.js';
import {mergeConfig} from '../src/config.js';
import {
	acquireItemLock,
	listItemLockEntriesStrict,
	markLockKeptForProposePr,
	parseLockEntry,
	proposeKeptTaskSlugs,
	readItemLock,
	serialiseLockEntry,
	takeOverProposeKeptLock,
} from '../src/item-lock.js';
import {gatherLifecycleInPlace} from '../src/lifecycle-gather.js';
import {resolveCwdSection} from '../src/cwd-section.js';
import {runMergeQuestionTick} from '../src/merge-question-tick.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
} from '../src/sidecar.js';
import {
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task `wire-merge-questions-into-the-advance-tick`: the merge-question feature
 * made real on the laptop.
 *
 *   - a propose build keeps its lock stamped `keptFor: propose-pr` (decision 4);
 *   - the bare `advance` tick surfaces a merge question for an unmerged work
 *     branch whose lock is free or propose-kept, and publishes it (decision 5);
 *     `mergeQuestions: off` surfaces nothing (decision 3);
 *   - an answered `merge` on such a branch is SELECTED despite the held lock
 *     (decision 6), TAKES the propose-kept lock OVER (decisions 2 and 4) and
 *     lands through the answered-merge action, with no manual `release-lock`;
 *   - a lock held WITHOUT the marker (a live build) is neither surfaced nor
 *     taken over.
 *
 * Every git op runs in a throwaway scratch dir against a local `--bare` arbiter.
 */

const ARBITER = 'arbiter';
const SLUG = 'land-me';
const ITEM = `task:${SLUG}`;
const BRANCH = `work/task-${SLUG}`;

let scratch: Scratch;
let seeded: SeededRepo;
let repo: string;

beforeEach(() => {
	scratch = makeScratch('dorfl-merge-question-tick-');
	seeded = seedRepoWithArbiter(scratch.root, [SLUG]);
	repo = seeded.repo;
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * A finished propose build of {@link SLUG}: claim (the `implement` lock), push
 * `work/task-<slug>` carrying the work and the done-move, and (when `kept`)
 * stamp the lock as kept for a propose PR, as `complete` does. `main` is left
 * untouched (the body stays in `tasks/ready/`).
 */
async function finishedProposeBuild(opts: {kept: boolean}): Promise<void> {
	const claim = await performClaim({
		slug: SLUG,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode, claim.message).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', BRANCH, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${SLUG}.md`, `work/tasks/done/${SLUG}.md`],
		repo,
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${SLUG}): build the thing; done`], repo);
	gitIn(['push', '-q', ARBITER, BRANCH], repo);
	gitIn(['switch', '-q', 'main'], repo);
	gitIn(['branch', '-q', '-D', BRANCH], repo);
	if (opts.kept) {
		const marked = await markLockKeptForProposePr({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(marked.outcome, marked.message).toBe('transitioned');
	}
}

function showOnArbiter(spec: string): string | undefined {
	const r = gitInSoft(['show', spec], seeded.arbiter);
	return r;
}

function gitInSoft(args: string[], cwd: string): string | undefined {
	try {
		return gitIn(args, cwd);
	} catch {
		return undefined;
	}
}

/** Bring `repo`'s main to the arbiter's. */
function syncMain(): void {
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['merge', '-q', '--ff-only', `${ARBITER}/main`], repo);
}

/** Answer the item's merge question `answer` on the arbiter's main (via `repo`). */
function answerOnMain(answer: string): void {
	syncMain();
	const abs = join(repo, sidecarPathFor(ITEM));
	const model = parseSidecar(readFileSync(abs, 'utf8'));
	writeFileSync(
		abs,
		serialiseSidecar({
			...model,
			entries: model.entries.map((e) => ({...e, answer})),
		}),
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `answer ${ITEM}: ${answer}`], repo);
	gitIn(['push', '-q', ARBITER, 'main:main'], repo);
}

/** A bare `advance` whose per-item ticks are stubbed out (surfacing only). */
function surfaceOnly(config = mergeConfig({})) {
	return performAdvanceAuto({
		cwd: repo,
		arbiter: ARBITER,
		config,
		run: async () => ({exitCode: 0, outcome: 'no-op', message: 'stub'}),
	});
}

describe('the propose-kept lock marker', () => {
	it('round-trips through the lock entry body; an unmarked entry has no keptFor', () => {
		const base = {
			entry: 'task-x',
			action: 'implement' as const,
			state: 'active' as const,
			holder: 'h',
			since: 's',
		};
		expect(parseLockEntry(serialiseLockEntry(base))).toEqual(base);
		expect(
			parseLockEntry(serialiseLockEntry({...base, keptFor: 'propose-pr'})),
		).toEqual({...base, keptFor: 'propose-pr'});
	});

	it('marks a held lock (keeping action/holder/since), is idempotent, and refuses a stale expected sha', async () => {
		await finishedProposeBuild({kept: false});
		const before = await readItemLock({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
		});
		expect(before?.keptFor).toBeUndefined();

		const stale = await markLockKeptForProposePr({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
			expectedSha: '0'.repeat(40),
			env: gitEnv(),
		});
		expect(stale.outcome).toBe('lost');

		const marked = await markLockKeptForProposePr({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(marked.outcome).toBe('transitioned');
		const after = await readItemLock({item: ITEM, cwd: repo, arbiter: ARBITER});
		expect(after).toEqual({...before, keptFor: 'propose-pr'});
		expect(await proposeKeptTaskSlugs(repo, ARBITER, gitEnv())).toEqual(
			new Set([SLUG]),
		);
		const again = await markLockKeptForProposePr({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(again.outcome).toBe('transitioned');
	});

	it('takeOverProposeKeptLock takes a marked lock over (an advance hold, no marker) and refuses an unmarked one', async () => {
		await finishedProposeBuild({kept: false});
		const refused = await takeOverProposeKeptLock({
			item: ITEM,
			action: 'advance',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(refused.outcome).toBe('lost');
		expect(
			(await readItemLock({item: ITEM, cwd: repo, arbiter: ARBITER}))?.action,
		).toBe('implement');

		await markLockKeptForProposePr({
			item: ITEM,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const taken = await takeOverProposeKeptLock({
			item: ITEM,
			action: 'advance',
			cwd: repo,
			arbiter: ARBITER,
			holder: 'the-answer',
			env: gitEnv(),
		});
		expect(taken.outcome, taken.message).toBe('acquired');
		const now = await readItemLock({item: ITEM, cwd: repo, arbiter: ARBITER});
		expect(now).toMatchObject({action: 'advance', holder: 'the-answer'});
		expect(now?.keptFor).toBeUndefined();
	});

	it('listItemLockEntriesStrict throws when the lock refs cannot be read (no silent "no locks")', async () => {
		await expect(
			listItemLockEntriesStrict(repo, 'no-such-remote', gitEnv()),
		).rejects.toThrow();
	});

	it('a plain acquire still loses to a propose-kept lock (only the answered-merge takeover may take it)', async () => {
		await finishedProposeBuild({kept: true});
		const lost = await acquireItemLock({
			item: ITEM,
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lost.outcome).toBe('lost');
	});
});

describe('the laptop bare `advance` tick surfaces merge questions', () => {
	it('mergeQuestions ask (default): asks about the propose-kept branch and publishes the question to <arbiter>/main', async () => {
		await finishedProposeBuild({kept: true});
		await surfaceOnly();
		const sidecar = showOnArbiter(`main:${sidecarPathFor(ITEM)}`);
		expect(sidecar).toBeDefined();
		const entries = parseSidecar(sidecar as string).entries;
		expect(entries).toHaveLength(1);
		expect(entries[0].kind).toBe('merge');
		expect(entries[0].question).toContain(BRANCH);
		expect(
			parseFrontmatter(
				showOnArbiter(`main:work/tasks/ready/${SLUG}.md`) as string,
			).needsAnswers,
		).toBe(true);
	});

	it('mergeQuestions off: surfaces nothing', async () => {
		await finishedProposeBuild({kept: true});
		await surfaceOnly(mergeConfig({mergeQuestions: 'off'}));
		expect(showOnArbiter(`main:${sidecarPathFor(ITEM)}`)).toBeUndefined();
		const pass = await runMergeQuestionTick({
			cwd: repo,
			arbiter: ARBITER,
			mergeQuestions: 'off',
		});
		expect(pass.ran).toBe(false);
	});

	it('a branch whose lock is held WITHOUT the marker (a live build) is not asked about', async () => {
		await finishedProposeBuild({kept: false});
		const pass = await runMergeQuestionTick({
			cwd: repo,
			arbiter: ARBITER,
			mergeQuestions: 'ask',
			env: gitEnv(),
		});
		expect(pass.result?.skipped).toEqual([
			{ref: BRANCH, slug: SLUG, reason: 'lock-held'},
		]);
		expect(showOnArbiter(`main:${sidecarPathFor(ITEM)}`)).toBeUndefined();
	});

	it('a lock read failure asks nothing (never mistakes an unreadable arbiter for "no live build")', async () => {
		await finishedProposeBuild({kept: false});
		const pass = await runMergeQuestionTick({
			cwd: repo,
			arbiter: ARBITER,
			mergeQuestions: 'ask',
			env: gitEnv(),
			readLocks: async () => {
				throw new Error('simulated lock read fault');
			},
		});
		expect(pass.failed).toBe(true);
		expect(pass.ran).toBe(false);
		expect(showOnArbiter(`main:${sidecarPathFor(ITEM)}`)).toBeUndefined();
	});
});

describe('an answered merge on a propose-kept branch lands with no manual release-lock', () => {
	it('selection keeps it despite the held lock, the tick takes the lock over, lands, and releases it', async () => {
		await finishedProposeBuild({kept: true});
		await surfaceOnly();
		answerOnMain('merge');
		syncMain();

		// Selection (decision 6): the held-but-propose-kept item with an answered
		// `merge` is in the apply pool; without the marker it would be subtracted.
		const kept = await proposeKeptTaskSlugs(repo, ARBITER, gitEnv());
		const selected = gatherLifecycleInPlace({
			repoPath: repo,
			heldSlugs: new Set([SLUG]),
			proposeKeptSlugs: kept,
		});
		expect(selected.apply.map((i) => i.slug)).toEqual([SLUG]);
		expect(
			gatherLifecycleInPlace({
				repoPath: repo,
				heldSlugs: new Set([SLUG]),
			}).apply,
		).toEqual([]);

		const multi = await performAdvanceAuto({
			cwd: repo,
			arbiter: ARBITER,
			config: mergeConfig({}),
			workspacesDir: join(scratch.root, 'ws'),
			verify: 'test "$(cat feature.txt)" = "the work"',
		});
		expect(multi.results.map((r) => [r.rung, r.outcome])).toEqual([
			['apply', 'advanced'],
		]);
		expect(multi.exitCode, multi.results[0]?.message).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', SLUG)).toBe(true);
		expect(showOnArbiter('main:feature.txt')).toBe('the work\n');
		expect(
			await readItemLock({item: ITEM, cwd: repo, arbiter: ARBITER}),
		).toBeUndefined();
	}, 60_000);

	it('the CI `enumerate` scan (`scan --json --here`) lists it as an apply item despite the held lock; hold is not listed', async () => {
		await finishedProposeBuild({kept: true});
		await surfaceOnly();
		answerOnMain('merge');
		syncMain();
		const section = await resolveCwdSection({
			cwd: repo,
			config: mergeConfig({}),
			lockArbiterRemote: ARBITER,
		});
		expect(section.repo?.lifecycle.apply.map((i) => i.slug)).toEqual([SLUG]);

		answerOnMain('hold');
		syncMain();
		const held = await resolveCwdSection({
			cwd: repo,
			config: mergeConfig({}),
			lockArbiterRemote: ARBITER,
		});
		expect(held.repo?.lifecycle.apply).toEqual([]);
	}, 60_000);

	it('an answered merge on a LIVE build (unmarked lock) backs off: no takeover, nothing lands', async () => {
		await finishedProposeBuild({kept: true});
		await surfaceOnly();
		answerOnMain('merge');
		syncMain();
		// The kept lock is replaced by a live build's (a rebuild took it).
		const lockRef = `refs/dorfl/lock/task-${SLUG}`;
		gitIn(['push', '-q', ARBITER, `:${lockRef}`], repo);
		const live = await acquireItemLock({
			item: ITEM,
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(live.outcome).toBe('acquired');

		const result = await performAdvance({
			arg: SLUG,
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			verify: 'true',
		});
		expect(result.outcome).toBe('lost');
		expect(existsOnArbiterMain(repo, 'done', SLUG)).toBe(false);
		expect(
			(await readItemLock({item: ITEM, cwd: repo, arbiter: ARBITER}))?.action,
		).toBe('implement');
	}, 60_000);
});
