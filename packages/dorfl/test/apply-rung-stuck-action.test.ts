import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performAdvance} from '../src/advance.js';
import {
	parseStuckAnswer,
	detectAnsweredStuckAction,
	type StuckActionHandler,
	type StuckActionInput,
	type StuckActionResult,
} from '../src/apply-stuck-action.js';
import {deleteRemoteWorkBranchIfPresent} from '../src/needs-attention.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * Task `apply-resolve-reset-flag-discards-work-branch` (spec
 * `surface-stuck-as-questions-and-retire-stuck-lock-state`, user story 2,
 * resolved decision #6) — the DETERMINISTIC, ANSWER-DRIVEN RUNNER-ACTION
 * dispatch the apply rung calls BEFORE the fall-through persist when a sidecar
 * entry stamped `kind: 'stuck'` (the bounce-surface path's mark) is answered.
 *
 * Mirrors the sibling `apply-rung-merge-action.test.ts` shape: parser + detect
 * unit tests, then apply-rung routing with a stub handler, then an end-to-end
 * pass through the real `performStuckAction` -> `deleteRemoteWorkBranchIfPresent`
 * for the three cases the acceptance criteria pin down:
 *
 *   - reset with a work branch on the arbiter -> the branch is DELETED FIRST,
 *     then `needsAnswers` clears (delete-before-clear ordering);
 *   - keep -> the branch SURVIVES (today's continue-from-WIP), `needsAnswers`
 *     clears;
 *   - reset with NO work branch on the arbiter -> harmless no-op (the
 *     `deleteRemoteWorkBranchIfPresent` primitive is idempotent), `needsAnswers`
 *     clears.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-apply-rung-stuck-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

// --- unit-level shape tests --------------------------------------------------

describe('parseStuckAnswer — deterministic choice parsing', () => {
	it('accepts the three plain verbs (case-insensitive, leading whitespace tolerated)', () => {
		expect(parseStuckAnswer('keep')).toBe('keep');
		expect(parseStuckAnswer('  RESET  ')).toBe('reset');
		expect(parseStuckAnswer('Cancel')).toBe('cancel');
	});

	it('reads the first whole word (commentary after is ignored)', () => {
		expect(parseStuckAnswer('reset — rebuild fresh')).toBe('reset');
		expect(parseStuckAnswer('cancel, this task is stale')).toBe('cancel');
	});

	it('refuses anything else (empty / typo / narrative) — NEVER default-guesses a destructive reset', () => {
		expect(parseStuckAnswer('')).toBeUndefined();
		expect(parseStuckAnswer('   ')).toBeUndefined();
		expect(parseStuckAnswer('maybe later')).toBeUndefined();
		expect(parseStuckAnswer('rst')).toBeUndefined();
	});
});

describe('detectAnsweredStuckAction — the kind-check', () => {
	it('returns the latest answered `kind: stuck` entry verb; ignores answered content entries', () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const item = 'task:foo';
		let model = newSidecar(item, [
			{question: 'plain content?', context: ''},
			{
				question: "'task:foo' was bounced — how should we proceed?",
				context: 'stream ended before message_stop',
				kind: 'stuck',
			},
		]);
		model = {
			...model,
			entries: model.entries.map((e, i) => ({
				...e,
				answer: i === 0 ? 'yes' : 'reset — start clean',
			})),
		};
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPathFor(item)), serialiseSidecar(model));

		const detected = detectAnsweredStuckAction(repo, item);
		expect(detected?.verb).toBe('reset');
		expect(detected?.entry.kind).toBe('stuck');
	});

	it('returns undefined when the latest `kind: stuck` entry is unanswered (re-paused follow-up)', () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const item = 'task:baz';
		let model = newSidecar(item, [
			{question: 'first stuck?', context: '', kind: 'stuck'},
			{question: 'follow-up?', context: '', kind: 'stuck'},
		]);
		// Answer the first, leave the second unanswered.
		model = {
			...model,
			entries: model.entries.map((e, i) =>
				i === 0 ? {...e, answer: 'keep'} : e,
			),
		};
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPathFor(item)), serialiseSidecar(model));
		expect(detectAnsweredStuckAction(repo, item)).toBeUndefined();
	});

	it('returns undefined when no `kind: stuck` entry exists', () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const item = 'task:bar';
		let model = newSidecar(item, [{question: 'just content?', context: ''}]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'yes'})),
		};
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPathFor(item)), serialiseSidecar(model));
		expect(detectAnsweredStuckAction(repo, item)).toBeUndefined();
	});
});

// --- apply-rung routing (stub handler) ---------------------------------------

/**
 * Seed a working repo carrying a bounced-task shape:
 *   - a task body in `work/tasks/ready/<slug>.md` with `needsAnswers: true`;
 *   - an answered `kind: 'stuck'` sidecar carrying the supplied answer text.
 *
 * The repo is its own arbiter remote (a `--bare` clone next to it). No work
 * branch is pushed here — the stub-handler tests don't need one (they inject a
 * canned result); the end-to-end tests below build a work branch themselves.
 */
function seedAnsweredStuckQuestion(
	slug: string,
	answer: string,
): {repo: string; sidecarPath: string; item: string} {
	const seeded = seedRepoWithArbiter(scratch.root, [slug], {
		needsAnswers: true,
	});
	const repo = seeded.repo;
	const item = `task:${slug}`;

	let model = newSidecar(item, [
		{
			question: `'${item}' was bounced — how should we proceed?`,
			context: 'stream ended before message_stop',
			kind: 'stuck',
		},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer})),
	};
	const sidecarPath = sidecarPathFor(item);
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `seed answered stuck-question ${slug}`], repo);
	return {repo, sidecarPath, item};
}

function stubHandler(result: StuckActionResult): {
	handler: StuckActionHandler;
	calls: StuckActionInput[];
} {
	const calls: StuckActionInput[] = [];
	const handler: StuckActionHandler = async (input) => {
		calls.push(input);
		return result;
	};
	return {handler, calls};
}

describe('apply rung — answered stuck-question dispatches the runner-action layer', () => {
	it('answer=keep + `keep` ⇒ falls through to the normal resolve (sidecar gone, `needsAnswers` cleared, branch untouched)', async () => {
		const {repo, sidecarPath} = seedAnsweredStuckQuestion('alpha', 'keep');
		const {handler, calls} = stubHandler({
			outcome: 'keep',
			message: 'keep — leaving work/task-alpha untouched',
		});

		const result = await performAdvance({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			stuckAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('keep');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('answer=reset + `reset` ⇒ falls through to the normal resolve (sidecar gone, `needsAnswers` cleared)', async () => {
		const {repo, sidecarPath} = seedAnsweredStuckQuestion('beta', 'reset');
		const {handler, calls} = stubHandler({
			outcome: 'reset',
			message: 'deleted work/task-beta on arbiter',
		});

		const result = await performAdvance({
			arg: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			stuckAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('reset');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('answer=reset + `refused` ⇒ SHORT-CIRCUITS (sidecar stays surfaced; `needsAnswers` stays)', async () => {
		const {repo, sidecarPath} = seedAnsweredStuckQuestion('gamma', 'reset');
		const {handler, calls} = stubHandler({
			outcome: 'refused',
			message:
				'the arbiter delete failed; NOT clearing needsAnswers; sidecar stays',
		});

		const result = await performAdvance({
			arg: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			stuckAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.rung).toBe('apply');
		expect(calls).toHaveLength(1);
		// the sidecar STAYS: the open answer surfaces for follow-up
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});

	it('answer=cancel + `cancel` ⇒ dispatches through the `dispose` terminal (task -> tasks/cancelled/)', async () => {
		const {repo, sidecarPath} = seedAnsweredStuckQuestion(
			'delta',
			'cancel — stale',
		);
		const {handler, calls} = stubHandler({
			outcome: 'cancel',
			message: 'cancel — dispatching through dispose',
		});

		const result = await performAdvance({
			arg: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			stuckAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('cancel');
		// dispose: task body moved to tasks/cancelled/, sidecar rm-ed
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(
			existsSync(join(repo, 'work', 'tasks', 'cancelled', 'delta.md')),
		).toBe(true);
		expect(existsSync(join(repo, 'work', 'tasks', 'ready', 'delta.md'))).toBe(
			false,
		);
	});
});

// --- end-to-end: real performStuckAction + real branch discard ---------------

/**
 * Seed a bounced-task fixture WITH a real `work/task-<slug>` branch pushed to
 * the arbiter (the shape a bounce leaves behind). Returns the repo path,
 * sidecar path, and the branch name so tests can assert on the branch's
 * before/after presence on the arbiter.
 */
async function seedBouncedTaskWithWorkBranch(
	slug: string,
	answer: string,
): Promise<{
	repo: string;
	sidecarPath: string;
	item: string;
	workBranch: string;
}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug], {
		needsAnswers: true,
	});
	const repo = seeded.repo;
	const item = `task:${slug}`;
	const workBranch = `work/task-${slug}`;

	// Claim + build a work branch + push it to the arbiter (the bounced-task
	// shape: the branch is on the arbiter awaiting a keep/reset decision).
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', workBranch, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'wip.txt'), 'partial work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `wip(${slug}): partial work`], repo);
	gitIn(['push', '-q', ARBITER, workBranch], repo);

	// Switch back to main and seed the answered stuck-question sidecar + the
	// needsAnswers:true body (the surfaced state after the bounce).
	gitIn(['switch', '-q', 'main'], repo);
	mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
	writeFileSync(
		join(repo, 'work', 'tasks', 'ready', `${slug}.md`),
		[
			'---',
			`title: ${slug}`,
			`slug: ${slug}`,
			'needsAnswers: true',
			'blockedBy: []',
			'---',
			'',
			'## What to build',
			'',
			'thing',
			'',
		].join('\n'),
	);
	let model = newSidecar(item, [
		{
			question: `'${item}' was bounced — how should we proceed?`,
			context: 'stream ended before message_stop',
			kind: 'stuck',
		},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer})),
	};
	const sidecarPath = sidecarPathFor(item);
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `seed bounced ${slug}`], repo);

	return {repo, sidecarPath, item, workBranch};
}

/** Ask the arbiter (via ls-remote) whether the named branch exists. */
function branchExistsOnArbiter(repo: string, branch: string): boolean {
	const out = gitIn(
		['ls-remote', '--heads', ARBITER, `refs/heads/${branch}`],
		repo,
	).trim();
	return out !== '';
}

describe('apply rung — real stuck-action drives deleteRemoteWorkBranchIfPresent', () => {
	it('reset WITH a work branch on the arbiter ⇒ the branch is DELETED FIRST, then needsAnswers is cleared', async () => {
		const {repo, sidecarPath, workBranch} = await seedBouncedTaskWithWorkBranch(
			'epsilon',
			'reset',
		);
		expect(branchExistsOnArbiter(repo, workBranch)).toBe(true);

		const result = await performAdvance({
			arg: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			// production stuckAction (not stubbed) — drives the real
			// deleteRemoteWorkBranchIfPresent primitive.
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// Branch gone on the arbiter.
		expect(branchExistsOnArbiter(repo, workBranch)).toBe(false);
		// needsAnswers cleared / sidecar deleted (resolved-fully).
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it("keep (no flag) ⇒ the branch SURVIVES on the arbiter (today's continue-from-WIP)", async () => {
		const {repo, sidecarPath, workBranch} = await seedBouncedTaskWithWorkBranch(
			'zeta',
			'keep',
		);
		expect(branchExistsOnArbiter(repo, workBranch)).toBe(true);

		const result = await performAdvance({
			arg: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// Branch UNTOUCHED on the arbiter.
		expect(branchExistsOnArbiter(repo, workBranch)).toBe(true);
		// needsAnswers cleared / sidecar deleted.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('reset WITHOUT a work branch ⇒ harmless no-op (already-gone); needsAnswers still clears', async () => {
		// Seed a bounced task shape WITHOUT ever pushing a work branch to the
		// arbiter — the "task never built" / observation-shape case.
		const seeded = seedRepoWithArbiter(scratch.root, ['eta'], {
			needsAnswers: true,
		});
		const repo = seeded.repo;
		const item = 'task:eta';
		const workBranch = 'work/task-eta';
		let model = newSidecar(item, [
			{
				question: `'${item}' was bounced — how should we proceed?`,
				context: 'stream ended before message_stop',
				kind: 'stuck',
			},
		]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'reset'})),
		};
		const sidecarPath = sidecarPathFor(item);
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed bounced eta (no branch)'], repo);

		expect(branchExistsOnArbiter(repo, workBranch)).toBe(false);

		const result = await performAdvance({
			arg: 'eta',
			cwd: repo,
			arbiter: ARBITER,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		// Still no branch on the arbiter (harmless no-op).
		expect(branchExistsOnArbiter(repo, workBranch)).toBe(false);
		// needsAnswers cleared / sidecar deleted.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});
});

// --- direct primitive test: shared branch-delete stays idempotent -----------

describe('deleteRemoteWorkBranchIfPresent — the shared branch-delete primitive', () => {
	it('deletes the branch on the arbiter and reports `deleted`', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['theta'], {});
		const repo = seeded.repo;
		const branch = 'work/task-theta';
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'x.txt'), 'x\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip'], repo);
		gitIn(['push', '-q', ARBITER, branch], repo);
		gitIn(['switch', '-q', 'main'], repo);

		const res = await deleteRemoteWorkBranchIfPresent({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'theta',
			env: gitEnv(),
		});
		expect(res.status).toBe('deleted');
		expect(res.branch).toBe(branch);
	});

	it('reports `already-gone` when the arbiter branch does not exist (idempotent no-op)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['iota'], {});
		const res = await deleteRemoteWorkBranchIfPresent({
			cwd: seeded.repo,
			arbiter: ARBITER,
			slug: 'iota',
			env: gitEnv(),
		});
		expect(res.status).toBe('already-gone');
	});
});
