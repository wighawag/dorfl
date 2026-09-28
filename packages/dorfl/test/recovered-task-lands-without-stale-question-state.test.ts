import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {surfaceStuckToNeedsAttention} from '../src/needs-attention.js';
import {clearOwnQuestionResidueOnLand} from '../src/land-question-residue.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {newSidecar, serialiseSidecar} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	needsAnswersOnArbiterMain,
	sidecarSurfacedOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * A task SURFACED to needs-attention (`needsAnswers: true` + its
 * `work/questions/task-<slug>.md` sidecar on `main`) and then RECOVERED must land
 * in `tasks/done/` WITHOUT that stale question state, in the land itself (task
 * `a-recovered-task-lands-without-stale-question-state`). Before, both halves
 * survived the done-move and were drained only by the NEXT claim's reconcile.
 *
 * House style (mirrors `decisions-transcribed-into-done-record.test.ts`): a
 * throwaway checkout + a local `--bare` arbiter + a STUBBED agent.
 */

const ARBITER = 'arbiter';
const PASS = 'exit 0';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-recovered-land-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

function show(repo: string, ref: string, path: string): string | undefined {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	const res = run('git', ['show', `${ref}:${path}`], repo, {env: gitEnv()});
	return res.status === 0 ? res.stdout : undefined;
}

function commitCount(repo: string, ref: string): number {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return Number(
		run('git', ['rev-list', '--count', ref], repo, {
			env: gitEnv(),
		}).stdout.trim(),
	);
}

async function claim(repo: string, slug: string): Promise<void> {
	const claimed = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claimed.exitCode).toBe(0);
}

/** Bounce the item: the surface lands flag + sidecar on `main`, lock released. */
async function surface(repo: string, slug: string): Promise<void> {
	const surfaced = await surfaceStuckToNeedsAttention({
		cwd: repo,
		slug,
		reason: 'acceptance gate failed (exit 1)',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(surfaced.surfaced).toBe(true);
	expect(needsAnswersOnArbiterMain(repo, slug, 'backlog')).toBe(true);
	expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(true);
}

/**
 * Surfaced FIRST, then re-dispatched: the recovery build branches off a `main`
 * that already carries the flag + sidecar (the requeue / re-dispatch shape).
 */
async function surfacedThenRebranched(slug: string): Promise<string> {
	const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
	await claim(repo, slug);
	await surface(repo, slug);
	await claim(repo, slug); // the recovery re-dispatch
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return repo;
}

describe('a recovered task lands without stale question state', () => {
	it('merge: the done record has no needsAnswers:true and the sidecar is gone, in the ONE land commit', async () => {
		const slug = 'alpha';
		const repo = await surfacedThenRebranched(slug);
		const before = commitCount(repo, `${ARBITER}/main`);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug,
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		const record = show(repo, `${ARBITER}/main`, `work/tasks/done/${slug}.md`);
		expect(record).toBeDefined();
		expect(parseFrontmatter(record!).needsAnswers).not.toBe(true);
		expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(false);
		// In the done-move commit itself: no second clean-up commit.
		expect(commitCount(repo, `${ARBITER}/main`)).toBe(before + 1);
	});

	it('propose: the pushed work branch carries the cleared flag and no sidecar', async () => {
		const slug = 'beta';
		const repo = await surfacedThenRebranched(slug);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug,
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		const branchRef = `${ARBITER}/work/task-${slug}`;
		const record = show(repo, branchRef, `work/tasks/done/${slug}.md`);
		expect(record).toBeDefined();
		expect(parseFrontmatter(record!).needsAnswers).not.toBe(true);
		expect(
			show(repo, branchRef, `work/questions/task-${slug}.md`),
		).toBeUndefined();
	});

	it('merge, kept branch cut BEFORE the surface: residue the rebase brings in is folded into the land commit', async () => {
		const slug = 'gamma';
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		await claim(repo, slug);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'feature.txt'), 'the work\n');
		// The bounce lands on `main` AFTER this branch was cut.
		await surface(repo, slug);
		await claim(repo, slug);
		const before = commitCount(repo, `${ARBITER}/main`);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug,
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		const record = show(repo, `${ARBITER}/main`, `work/tasks/done/${slug}.md`);
		expect(record).toBeDefined();
		expect(parseFrontmatter(record!).needsAnswers).not.toBe(true);
		expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(false);
		expect(commitCount(repo, `${ARBITER}/main`)).toBe(before + 1);
		// The work itself still landed.
		expect(pathOnArbiterMain(repo, 'feature.txt')).toBe(true);
	});

	it('committed recovery (the land primitive tail): a stranded done branch finished after a surface lands clean', async () => {
		const slug = 'delta';
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		await claim(repo, slug);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'feature.txt'), 'the work\n');
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `feat(${slug}): build; done`], repo);
		await surface(repo, slug);
		await claim(repo, slug);

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug,
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		const record = show(repo, `${ARBITER}/main`, `work/tasks/done/${slug}.md`);
		expect(record).toBeDefined();
		expect(parseFrontmatter(record!).needsAnswers).not.toBe(true);
		expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(false);
	});

	it('a task that lands normally is unchanged (done record byte-identical to its ready body)', async () => {
		const slug = 'epsilon';
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		const original = readFileSync(
			join(repo, 'work', 'tasks', 'ready', `${slug}.md`),
			'utf8',
		);
		await claim(repo, slug);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'feature.txt'), 'the work\n');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug,
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(show(repo, `${ARBITER}/main`, `work/tasks/done/${slug}.md`)).toBe(
			original,
		);
	});
});

describe('clearOwnQuestionResidueOnLand', () => {
	function tree(): string {
		const root = join(scratch.root, 'tree');
		mkdirSync(join(root, 'work', 'tasks', 'done'), {recursive: true});
		mkdirSync(join(root, 'work', 'questions'), {recursive: true});
		return root;
	}
	const flagged = '---\ntitle: T\nneedsAnswers: true\n---\n\nbody\n';

	it('holds an ANSWERED sidecar and its flag (a human answer is never discarded)', () => {
		const root = tree();
		writeFileSync(join(root, 'work/tasks/done/zeta.md'), flagged);
		const model = newSidecar('task:zeta', [
			{question: 'How should we proceed?'},
		]);
		model.entries[0].answer = 'merge it';
		const sidecar = serialiseSidecar(model);
		writeFileSync(join(root, 'work/questions/task-zeta.md'), sidecar);

		const res = clearOwnQuestionResidueOnLand({cwd: root, slug: 'zeta'});

		expect(res.changed).toEqual([]);
		expect(res.held).toBe(true);
		expect(existsSync(join(root, 'work/questions/task-zeta.md'))).toBe(true);
		expect(readFileSync(join(root, 'work/tasks/done/zeta.md'), 'utf8')).toBe(
			flagged,
		);
	});

	it('clears a stranded flag with no sidecar, and touches nothing without a done record', () => {
		const root = tree();
		writeFileSync(join(root, 'work/tasks/done/eta.md'), flagged);
		const res = clearOwnQuestionResidueOnLand({cwd: root, slug: 'eta'});
		expect(res.unflagged).toBe(true);
		expect(
			parseFrontmatter(
				readFileSync(join(root, 'work/tasks/done/eta.md'), 'utf8'),
			).needsAnswers,
		).toBe(false);

		expect(
			clearOwnQuestionResidueOnLand({cwd: root, slug: 'absent'}).changed,
		).toEqual([]);
	});
});
