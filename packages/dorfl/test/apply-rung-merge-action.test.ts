import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {performAdvance} from '../src/advance.js';
import {
	parseMergeAnswer,
	detectAnsweredMergeAction,
	performMergeAction,
	type MergeActionHandler,
	type MergeActionInput,
	type MergeActionResult,
} from '../src/apply-merge-action.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
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
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * Task `apply-rung-merge-disposition` (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, covers stories #15 + #16) —
 * the DETERMINISTIC, ANSWER-DRIVEN RUNNER-ACTION dispatch the apply rung calls
 * BEFORE the agentic decider when a sidecar entry stamped `kind: merge` (the
 * merge-question surfacer's mark) is answered.
 *
 * House-style tests assert on the EXTERNAL behaviour the prd pins down:
 *
 *   - clean apply on a current main → LANDS (the kept commit on
 *     `<arbiter>/main`);
 *   - moved-main + green re-verify on the rebased tip → LANDS (the OQ6 default:
 *     honour the prior approval, the cheap "green-re-verify-is-enough" path);
 *   - moved-main + RED re-verify on the rebased tip → REFUSES (`main` never
 *     receives a tree that fails `verify`);
 *
 * + smaller stub tests asserting on the routing the dispatcher hands back to
 * the apply rung (`hold`/`drop` fall through to the normal answer-recording
 * path; `refused` short-circuits and leaves the sidecar for human follow-up).
 *
 * Tests isolate global locations: every git op runs in a throwaway scratch
 * dir under `tmpdir()`, with `gitEnv()`'s deterministic identity and no
 * touch of `~/.gitconfig` / `~/.dorfl`.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-apply-rung-merge-');
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

describe('parseMergeAnswer — deterministic choice parsing', () => {
	it('accepts the three plain verbs (case-insensitive, leading whitespace tolerated)', () => {
		expect(parseMergeAnswer('merge')).toBe('merge');
		expect(parseMergeAnswer('  HOLD  ')).toBe('hold');
		expect(parseMergeAnswer('Drop')).toBe('drop');
	});

	it('reads the first whole word (commentary after is ignored)', () => {
		expect(parseMergeAnswer('merge — yes, ship it')).toBe('merge');
		expect(parseMergeAnswer('drop, the branch is stale')).toBe('drop');
	});

	it('refuses anything else (empty / typo / narrative) — NEVER invents a verb', () => {
		expect(parseMergeAnswer('')).toBeUndefined();
		expect(parseMergeAnswer('   ')).toBeUndefined();
		expect(parseMergeAnswer('maybe later')).toBeUndefined();
		expect(parseMergeAnswer('mrge')).toBeUndefined();
	});
});

describe('detectAnsweredMergeAction — the kind-check', () => {
	it('returns the first answered `kind: merge` entry verb; ignores answered content entries', () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const item = 'task:foo';
		let model = newSidecar(item, [
			{question: 'plain content?', context: ''},
			{
				question: 'Land work/foo?',
				context: '',
				default: 'merge | hold | drop',
				kind: 'merge',
			},
		]);
		model = {
			...model,
			entries: model.entries.map((e, i) => ({
				...e,
				answer: i === 0 ? 'yes' : 'merge — ship it',
			})),
		};
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPathFor(item)), serialiseSidecar(model));

		const detected = detectAnsweredMergeAction(repo, item);
		expect(detected?.verb).toBe('merge');
		expect(detected?.entry.kind).toBe('merge');
	});

	it('returns undefined when no `kind: merge` entry exists', () => {
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

		expect(detectAnsweredMergeAction(repo, item)).toBeUndefined();
	});

	it('returns undefined when the `kind: merge` entry is unanswered (subset)', () => {
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const item = 'task:baz';
		const model = newSidecar(item, [
			{question: 'Land?', context: '', kind: 'merge'},
		]);
		// answer empty
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPathFor(item)), serialiseSidecar(model));
		expect(detectAnsweredMergeAction(repo, item)).toBeUndefined();
	});
});

// --- apply-rung routing (stub handler) ---------------------------------------

/**
 * Seed a working repo carrying:
 *  - a task body in `work/tasks/ready/<slug>.md` with `needsAnswers: true`;
 *  - an answered `kind: merge` sidecar carrying the supplied answer text.
 *
 * The repo is its own arbiter remote (a `--bare` clone next to it); the work
 * branch + the unmerged-branch reachability shape are NOT needed for the
 * stub-handler routing tests (which inject a fake handler), so this fixture is
 * the cheap shape every routing test reuses.
 */
function seedAnsweredMergeQuestion(
	slug: string,
	answer: string,
): {repo: string; sidecarPath: string} {
	const seeded = seedRepoWithArbiter(scratch.root, [slug], {
		needsAnswers: true,
	});
	const repo = seeded.repo;
	const item = `task:${slug}`;

	let model = newSidecar(item, [
		{
			question: `Land \`work/${slug}\`?`,
			context: 'An unmerged work/* branch is awaiting an integration decision.',
			default: 'merge | hold | drop',
			kind: 'merge',
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
	gitIn(['commit', '-q', '-m', `seed answered merge-question ${slug}`], repo);
	return {repo, sidecarPath};
}

/** A stub merge-action handler that records the call + returns a canned result. */
function stubHandler(result: MergeActionResult): {
	handler: MergeActionHandler;
	calls: MergeActionInput[];
} {
	const calls: MergeActionInput[] = [];
	const handler: MergeActionHandler = async (input) => {
		calls.push(input);
		return result;
	};
	return {handler, calls};
}

describe('apply rung — answered merge-question dispatches the runner-action layer', () => {
	it('answer=merge + `landed` ⇒ apply rung falls through to the normal resolve (sidecar gone, item body carries the answer)', async () => {
		const {repo, sidecarPath} = seedAnsweredMergeQuestion('alpha', 'merge');
		const {handler, calls} = stubHandler({
			outcome: 'landed',
			message: 'landed alpha on arbiter/main',
		});

		const result = await performAdvance({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: 'file:///does-not-matter',
			mergeAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// the dispatcher saw the answered merge-question (kind=merge, verb=merge)
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('merge');
		expect(calls[0].action.entry.kind).toBe('merge');
		// the normal resolve ran AFTER the land: sidecar deleted, answer recorded
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('answer=merge + `refused` ⇒ apply rung SHORT-CIRCUITS (no resolve; sidecar stays surfaced for human follow-up)', async () => {
		const {repo, sidecarPath} = seedAnsweredMergeQuestion('beta', 'merge');
		const {handler, calls} = stubHandler({
			outcome: 'refused',
			message: 'verify failed on the rebased tip; routed to needs-attention',
		});

		const result = await performAdvance({
			arg: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: 'file:///does-not-matter',
			mergeAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.rung).toBe('apply');
		expect(calls).toHaveLength(1);
		// the sidecar STAYS (not resolved): the open answer surfaces for follow-up
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});

	it('answer=hold ⇒ no land; apply rung resolves the sidecar normally (the answer is recorded; the branch stays unmerged)', async () => {
		const {repo, sidecarPath} = seedAnsweredMergeQuestion('gamma', 'hold');
		const {handler, calls} = stubHandler({
			outcome: 'hold',
			message: 'hold — left work/gamma unmerged',
		});

		const result = await performAdvance({
			arg: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: 'file:///does-not-matter',
			mergeAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('hold');
		// sidecar resolved (the answer is recorded in body via the normal apply)
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('answer=drop ⇒ no land; apply rung resolves the sidecar normally', async () => {
		const {repo, sidecarPath} = seedAnsweredMergeQuestion('delta', 'drop');
		const {handler, calls} = stubHandler({
			outcome: 'drop',
			message: 'drop — left work/delta unmerged',
		});

		const result = await performAdvance({
			arg: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: 'file:///does-not-matter',
			mergeAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(calls).toHaveLength(1);
		expect(calls[0].action.verb).toBe('drop');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('answer=merge + `restale` (strictMergeApproval ON, merge-base moved) ⇒ apply rung RE-SURFACES (re-pause; sidecar stays with a new pending follow-up)', async () => {
		const {repo, sidecarPath} = seedAnsweredMergeQuestion('eps', 'merge');
		const {handler, calls} = stubHandler({
			outcome: 'restale',
			message: 'merge-base moved; re-surfacing',
		});

		const result = await performAdvance({
			arg: 'eps',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: 'file:///does-not-matter',
			strictMergeApproval: true,
			mergeAction: handler,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		// re-pause is a no-op rung outcome (the sidecar still has a pending entry)
		expect(result.outcome).toBe('no-op');
		expect(calls).toHaveLength(1);
		expect(calls[0].strictMergeApproval).toBe(true);
		// sidecar still present (re-paused with a follow-up)
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});
});

// --- end-to-end: real createJob + real performIntegration --------------------

/**
 * Seed the answered-merge state: a task body on main with `needsAnswers: true`
 * + an answered `kind: merge` sidecar (`answer=merge`), AND a pushed
 * `work/task-<slug>` branch whose tip carries a build + the `; done` move
 * (the surfacer would only enumerate it because its tip is NOT reachable from
 * main). The arbiter is bare and PR-less (NoneProvider).
 */
async function seedAnsweredMergeLand(slug: string): Promise<{
	repo: string;
	seeded: SeededRepo;
	workTip: string;
	sidecarPath: string;
}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;

	// Claim → branch → build → done-move → commit → PUSH the work branch so
	// the surfacer's reachability check (= the prd's git-alone floor) sees an
	// unmerged work branch on the arbiter.
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
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
		repo,
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], repo);
	const workTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	gitIn(['push', '-q', ARBITER, `work/task-${slug}`], repo);

	// Switch back to main and seed the answered merge-question sidecar there.
	gitIn(['switch', '-q', 'main'], repo);
	// Re-seed the body on main (claim itself didn't remove it; the body lives
	// in tasks/ready/ on main). Set `needsAnswers: true` so the classifier
	// picks `apply`.
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
	const item = `task:${slug}`;
	let model = newSidecar(item, [
		{
			question: `Land \`work/task-${slug}\`?`,
			context: 'unmerged work/* branch — integration decision',
			default: 'merge | hold | drop',
			kind: 'merge',
		},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer: 'merge'})),
	};
	const sidecarPath = sidecarPathFor(item);
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
	gitIn(['add', '-A'], repo);
	gitIn(
		['commit', '-q', '-m', `surface ${item}: answered merge-question (merge)`],
		repo,
	);
	gitIn(['push', '-q', ARBITER, 'main:main'], repo);

	return {repo, seeded, workTip, sidecarPath};
}

/** Push a non-conflicting commit onto `<arbiter>/main` via a throwaway clone. */
function advanceMainWithFile(
	seeded: SeededRepo,
	label: string,
	relPath: string,
	content: string,
): void {
	const dest = join(scratch.root, `arbiter-advance-${label}`);
	gitIn(['clone', '-q', `file://${seeded.arbiter}`, dest], scratch.root);
	gitIn(['checkout', '-q', 'main'], dest);
	const abs = join(dest, relPath);
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, content);
	gitIn(['add', '-A'], dest);
	gitIn(['commit', '-q', '-m', `arbiter advance ${label}`], dest);
	gitIn(['push', '-q', 'origin', 'main:main'], dest);
	rmSync(dest, {recursive: true, force: true});
}

describe('apply rung — answered merge-question LANDS via the existing land primitive (end-to-end)', () => {
	it('clean apply on current main → LANDS the kept commit on `<arbiter>/main` (verify ran on the rebased tip)', async () => {
		const {repo, seeded, workTip} = await seedAnsweredMergeLand('clean');

		const result = await performAdvance({
			arg: 'clean',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: `file://${seeded.arbiter}`,
			// A verify command that PROVES the rebased tip carried the kept commit.
			verify: 'test "$(cat feature.txt)" = "the work"',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		expect(existsOnArbiterMain(repo, 'done', 'clean')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		// the integrated tip carries the kept commit's payload
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		void workTip;
	}, 30_000);

	it('moved main + GREEN re-verify on the rebased tip (OQ6 default policy) → LANDS', async () => {
		const {repo, seeded} = await seedAnsweredMergeLand('stale-green');

		// Main moved AFTER the merge-question was answered, but the rebased tip
		// still verifies green (a non-conflicting, non-breaking sibling commit).
		advanceMainWithFile(seeded, 'benign', 'sibling.txt', 'benign sibling\n');

		const result = await performAdvance({
			arg: 'stale-green',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: `file://${seeded.arbiter}`,
			verify: 'test "$(cat feature.txt)" = "the work"',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(existsOnArbiterMain(repo, 'done', 'stale-green')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		// the sibling's file is preserved (the rebase composed cleanly with it)
		expect(gitIn(['show', `${ARBITER}/main:sibling.txt`], repo).trim()).toBe(
			'benign sibling',
		);
	}, 30_000);

	it('moved main + RED re-verify on the rebased tip → REFUSES; `<arbiter>/main` never receives the failing tree', async () => {
		const {repo, seeded, workTip} = await seedAnsweredMergeLand('stale-red');

		// Main moved with a file that BREAKS verify on the rebased tip.
		advanceMainWithFile(seeded, 'broke', 'must-not-exist.txt', 'oops\n');

		const result = await performAdvance({
			arg: 'stale-red',
			cwd: repo,
			arbiter: ARBITER,
			workspacesDir: join(scratch.root, 'ws'),
			arbiterUrl: `file://${seeded.arbiter}`,
			// PRE-rebase verify in `repo` would PASS (the file is not in `cwd` yet);
			// gating the REBASED tip is the load-bearing check — that worktree DOES
			// carry the file, so verify FAILS there.
			verify: '! test -f must-not-exist.txt',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});

		// External behaviour: refusal, main never received the failing tree.
		expect(result.exitCode).toBe(1);
		expect(result.rung).toBe('apply');
		expect(existsOnArbiterMain(repo, 'done', 'stale-red')).toBe(false);
		// The kept tip is NOT reachable on `<arbiter>/main` (the work that would
		// have failed verify is not on main).
		gitIn(['fetch', '-q', ARBITER], repo);
		const isAncestor = spawnSync(
			'git',
			['merge-base', '--is-ancestor', workTip, `${ARBITER}/main`],
			{cwd: repo, env: gitEnv()},
		);
		expect(isAncestor.status).not.toBe(0);
	}, 30_000);
});

// --- performMergeAction direct: hold/drop short-circuit (no createJob) -------

describe('performMergeAction — hold / drop early-return (no worktree spun up)', () => {
	it('hold ⇒ outcome `hold`, no integration result', async () => {
		const detected = {
			verb: 'hold' as const,
			entry: {
				id: 'q1',
				question: 'Land?',
				context: '',
				answer: 'hold',
				kind: 'merge' as const,
			},
		};
		const result = await performMergeAction({
			action: detected,
			item: 'task:noop',
			slug: 'noop',
			cwd: scratch.root,
			arbiter: 'origin',
			arbiterUrl: 'file:///nope',
			workspacesDir: join(scratch.root, 'ws'),
		});
		expect(result.outcome).toBe('hold');
		expect(result.integration).toBeUndefined();
	});

	it('drop ⇒ outcome `drop`, no integration result', async () => {
		const detected = {
			verb: 'drop' as const,
			entry: {
				id: 'q1',
				question: 'Land?',
				context: '',
				answer: 'drop',
				kind: 'merge' as const,
			},
		};
		const result = await performMergeAction({
			action: detected,
			item: 'task:noop',
			slug: 'noop',
			cwd: scratch.root,
			arbiter: 'origin',
			arbiterUrl: 'file:///nope',
			workspacesDir: join(scratch.root, 'ws'),
		});
		expect(result.outcome).toBe('drop');
		expect(result.integration).toBeUndefined();
	});
});
