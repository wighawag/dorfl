import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {performTask, type TaskAgentRunner} from '../src/tasking.js';
import {
	type AcquireTaskingLockResult,
	type ReleaseTaskingLockResult,
} from '../src/tasking-lock.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';
import type {
	TaskReviewGate,
	TaskReviewVerdict,
} from '../src/tasker-review-loop.js';

/**
 * `do brief:<slug>` tasking-path tests (`performTask`, task `autoslice-command`).
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED agent
 * (the injected `agentRunner` writes task files directly, never a real harness).
 * The real-git tests drive the lock CAS + write `main`, so this file is in the
 * NON-PARALLEL vitest project (see vitest.config.ts); the gate-refusal tests stub
 * the lock entirely so they stay pure.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-');
	// Test-isolation (shared-write rule): point pi's session storage at scratch so
	// no task-file/session write touches the real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Seed a `work/briefs/ready/<slug>.md` (committed onto the arbiter) with frontmatter. */
function seedBrief(
	repo: string,
	slug: string,
	fm: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		briefAfter?: string[];
		/**
		 * Emit an INERT `tasked:` line (the marker was removed in
		 * remove-tasked-marker-step-b — the parser ignores it). Only used to PROVE a
		 * leftover marker does NOT count toward tasked-ness (residence does).
		 */
		tasked?: string;
		/** Seed into `work/briefs/tasked/` (the tasked resting state) instead of `brief/`. */
		inBriefTasked?: boolean;
	} = {},
): void {
	const dir = join(
		repo,
		'work',
		'briefs',
		fm.inBriefTasked ? 'tasked' : 'ready',
	);
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `title: ${slug}`, `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	if (fm.briefAfter && fm.briefAfter.length > 0) {
		lines.push(`briefAfter: [${fm.briefAfter.join(', ')}]`);
	}
	if (fm.tasked) lines.push(`sliced: ${fm.tasked}`);
	lines.push(
		'---',
		'',
		'## Problem Statement',
		'',
		`PRD body for ${slug}.`,
		'',
	);
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `brief: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one STAGED task file under `work/tasks/backlog/` (no git). */
function taskingAgent(file = 'child', extra?: () => void): TaskAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'brief: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		extra?.();
		return {ok: true};
	};
}

const onArbiter = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};
const showArbiter = (repo: string, path: string): string =>
	run('git', ['show', `${ARBITER}/main:${path}`], repo, {env: gitEnv()}).stdout;

// --- Gate refusal (agent path) — stub the lock so these stay pure ----------

describe('performTask — agent gate refusal (honest, names why it skipped)', () => {
	/** A lock seam that must NOT be touched (the gate refuses before the lock). */
	const noLock = {
		acquire(): Promise<AcquireTaskingLockResult> {
			throw new Error('lock acquire must not be reached on a gate refusal');
		},
		release(): Promise<ReleaseTaskingLockResult> {
			throw new Error('lock release must not be reached on a gate refusal');
		},
	};

	it('refuses a humanOnly PRD (names humanOnly), no agent, no lock', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {humanOnly: true});
		let agentRan = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: noLock,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/humanOnly/);
		expect(agentRan).toBe(false);
	});

	it('refuses a needsAnswers PRD (names needsAnswers)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {needsAnswers: true});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/needsAnswers/);
	});

	it('refuses when autoTask is off on the AUTO-PICK pool path (names autoTask)', async () => {
		// The NON-explicit (pool) dispatch: `explicit` unset ⇒ the `autoTask` POLICY
		// still gates. (The pool itself never selects such a brief; this asserts the
		// per-invocation gate's policy term survives for the pool path.)
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: false,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/autoTask/);
	});

	it('an EXPLICITLY-named PRD slices with autoTask OFF (no config, no env) — naming IS the authorization', async () => {
		// The task-path mirror of `do <task>` building regardless of `autoBuild`:
		// `explicit: true` (the `do brief:<slug>` dispatch) drops the `autoTask` POLICY
		// term, so an explicit task-now proceeds to the lock/agent with the policy
		// unset. (A real lock is taken here — the gate does NOT refuse, so the noLock
		// stub would throw; we let the real CAS run and assert it tasked.)
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		let agentRan = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			// autoTask deliberately OMITTED (defaults off) — explicit alone authorizes.
			explicit: true,
			integration: 'merge',
			agentRunner: taskingAgent('it-explicit', () => {
				agentRan = true;
			}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(agentRan).toBe(true);
		expect(onArbiter(repo, 'work/tasks/backlog/it-explicit.md')).toBe(true);
	});

	it('EXPLICIT still refuses a humanOnly PRD (the readiness axis binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {humanOnly: true});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/humanOnly/);
	});

	it('EXPLICIT still refuses a needsAnswers PRD (the readiness axis binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {needsAnswers: true});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/needsAnswers/);
	});

	it('EXPLICIT still refuses an unsatisfied briefAfter (ordering binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'dep');
		seedBrief(repo, 'it', {briefAfter: ['dep']});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/dep/);
		expect(result.message).toMatch(/briefAfter/);
		// The autoTask policy is NEVER the named reason on the explicit path.
		expect(result.message).not.toMatch(/autoTask/);
	});

	it('refuses when a briefAfter PRD is not yet sliced (names it)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// `dep` exists but is NOT tasked; `it` briefAfter: [dep].
		seedBrief(repo, 'dep');
		seedBrief(repo, 'it', {briefAfter: ['dep']});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/dep/);
		expect(result.message).toMatch(/briefAfter/);
	});

	it('passes the gate once the briefAfter PRD IS sliced', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// `dep` is SLICED — it RESIDES in work/briefs/tasked/ (the source of truth), not
		// a `tasked:` marker in work/briefs/ready/. `it`'s briefAfter resolves against that
		// folder residence (mirroring blockedBy -> done/).
		seedBrief(repo, 'dep', {inBriefTasked: true});
		seedBrief(repo, 'it', {briefAfter: ['dep']});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
	});

	it('STILL refuses when the briefAfter PRD only carries an INERT `sliced:` line in prd/ (folder, not marker)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// `dep` sits in work/briefs/ready/ with a leftover (INERT) `tasked:` line but is NOT in
		// brief-tasked/. Folder residence is the SOLE source of truth — the marker was
		// removed in remove-tasked-marker-step-b, so the line is ignored and does NOT
		// satisfy briefAfter.
		seedBrief(repo, 'dep', {tasked: '2026-06-01'});
		seedBrief(repo, 'it', {briefAfter: ['dep']});
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: noLock,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/dep/);
	});

	it('the HUMAN path is unbound by the gate (slices a humanOnly PRD, no lock)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {humanOnly: true});
		let acquired = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			doer: 'human',
			lock: {
				acquire() {
					acquired = true;
					throw new Error('human-no-contention must not take the lock');
				},
				release() {
					throw new Error('human-no-contention must not release the lock');
				},
			},
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The human path tasks WITHOUT the lock.
		expect(acquired).toBe(false);
	});
});

// --- The completing transition (real git, lock taken/released) -------------

describe('performTask — slices + commits the runner-owned transition', () => {
	it('takes the lock, runs the agent, lands slices in pre-backlog/ (STAGED), rests PRD in prd-sliced/', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			// `--merge`: land the produced tasks on the arbiter main (the output now
			// integrates through the shared core; propose would open a PR instead).
			integration: 'merge',
			agentRunner: taskingAgent('it-first'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toEqual(['work/tasks/backlog/it-first.md']);

		// The produced task landed STAGED on the arbiter (work/tasks/backlog/ — the
		// agent-eligible pool work/tasks/todo/ is the runner-owned promotion target,
		// task `pre-backlog-staging-folder-and-promote-step-a`).
		expect(onArbiter(repo, 'work/tasks/backlog/it-first.md')).toBe(true);
		expect(onArbiter(repo, 'work/tasks/todo/it-first.md')).toBe(false);
		// The lock was released into the SLICED resting state: the brief now resides in
		// work/briefs/tasked/ (the source of truth, like done/), NOT back in brief/; tasking/
		// is empty.
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		// Tasked-ness is RESIDENCE in brief-tasked/ (asserted above). The `tasked:` marker
		// was removed in remove-tasked-marker-step-b, so the resting brief carries NO
		// tasked: line.
		expect(showArbiter(repo, 'work/briefs/tasked/it.md')).not.toMatch(
			/^sliced:/m,
		);
	});

	it('the RUNNER (not the agent) authored the commits/moves', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		// An agent that ASSERTS it does no git: the tree must NOT already be
		// committed by it — it only writes the file; the runner commits.
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: ({cwd}) => {
				// The lock already moved the brief to tasking/ on the arbiter; the agent
				// must not have committed anything itself.
				const dir = join(cwd, 'work', 'tasks', 'backlog');
				mkdirSync(dir, {recursive: true});
				writeFileSync(
					join(dir, 'it-a.md'),
					'---\nslug: it-a\nprd: it\n---\n\n## Prompt\n\n> x\n',
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');

		// The completing commit on the arbiter is the runner's tasking INTEGRATE
		// commit (it carries BOTH the backlog task AND the tasking→brief-tasked move),
		// now landed through the shared core (`tasking(<slug>): …; tasked`).
		const subject = run(
			'git',
			['log', '-1', '--format=%s', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(subject).toMatch(/^slicing\(it\):/);
		expect(subject).toMatch(/; sliced$/);
		// The completing commit carries BOTH the emitted backlog task AND the
		// tasking→brief-tasked move (a rename), in ONE runner-owned commit (rename
		// detection shows the move as `work/briefs/tasked/it.md`; tasking/ verified empty).
		const files = run(
			'git',
			['show', '--name-status', '--format=', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(files).toMatch(/work\/tasks\/backlog\/it-a\.md/);
		expect(files).toMatch(/work\/briefs\/tasked\/it\.md/);
		// The brief is no longer held in tasking/ (the lock was released in this commit)
		// and now rests in brief-tasked/ (the source of truth), NOT back in brief/.
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(false);
	});

	it('REGRESSION (`do prd:` titlePath read): the commit subject carries the PRD `title:` (read from titlePath, NOT the generic fallback)', async () => {
		// The intake lone-task fix threads its drafted title EXPLICITLY (its output
		// file does not exist at title-read time). The `do brief:` TASKING path is
		// UNCHANGED: its `titlePath` is the already-existing held brief, so the core still
		// READS the title from the file. This guards that read path keeps deriving the
		// subject from the brief `title:` (never degrading to `complete work task`).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// A DISTINCT multi-word title (not just the slug) so the subject is provably
		// derived from the brief title, not a generic fallback.
		const dir = join(repo, 'work', 'briefs', 'ready');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'it.md'),
			[
				'---',
				'title: Quiet and verbose output modes for the CLI',
				'slug: it',
				'---',
				'',
				'## Problem Statement',
				'',
				'PRD body.',
				'',
			].join('\n'),
		);
		run('git', ['add', '-A'], repo, {env: gitEnv()});
		run('git', ['commit', '-q', '-m', 'brief: it'], repo, {env: gitEnv()});
		run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});

		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: ({cwd}) => {
				const out = join(cwd, 'work', 'tasks', 'backlog');
				mkdirSync(out, {recursive: true});
				writeFileSync(
					join(out, 'it-a.md'),
					'---\nslug: it-a\nprd: it\n---\n\n## Prompt\n\n> x\n',
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');

		const subject = run(
			'git',
			['log', '-1', '--format=%s', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(subject).toBe(
			'slicing(it): Quiet and verbose output modes for the CLI; sliced',
		);
		expect(subject).not.toContain('complete work slice');
	});

	it('the content-identity stale check fires on a concurrent edit of the held PRD', async () => {
		// The OUTPUT now integrates through the shared core (not the lock release), so
		// the read-stability backstop is owned at the integrate seam. An agent that
		// EDITS the held work/tasking/<slug>.md body on the arbiter (a concurrent
		// writer, under the lock) must make the tasking STALE — fail loud, touch
		// NOTHING (the lock stays held; no tasks land).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: ({cwd}) => {
				// Write a task (as normal)…
				taskingAgent('child')({cwd, prompt: '', slug: 'it'});
				// …then, from a throwaway clone, EDIT the held brief body on the arbiter
				// while the lock is held (the concurrent-edit the backstop must catch).
				editHeldBriefOnArbiter(scratch.root, 'it');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(4);
		expect(result.outcome).toBe('stale');
		// The arbiter was NOT modified by the tasking: the brief body stays in brief/ (the
		// lock is still held on the ref), and no backlog task landed on main. The brief
		// did NOT move to brief-tasked/.
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('RE-SLICE round-trip: prd-sliced/ -> prd/ reopens a sliced PRD into the slice pool', async () => {
		// Task `it` ONCE: it lands in work/briefs/tasked/ (the tasked resting state).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const first = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('it-first'),
			env: gitEnv(),
		});
		expect(first.outcome).toBe('sliced');
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(true);

		// REOPEN-TO-READY: git mv work/briefs/tasked/it.md -> work/briefs/ready/it.md (mirroring
		// done/ -> backlog/), so the reshaped brief re-enters the task pool with no
		// special case. Do it on a throwaway clone + push (the runner owns git; this is
		// a test's own throwaway repo).
		reopenTaskedBrief(scratch.root, 'it');
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(false);
		// Sync the local checkout to the reopened arbiter main so its working tree has
		// work/briefs/ready/it.md (the to-task source `performTask` reads at step 0).
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		run('git', ['reset', '-q', '--hard', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		});

		// Task it AGAIN: it is back in the pool (the gate sees it in brief/), so the
		// agent path tasks it once more, landing it back in brief-tasked/.
		const second = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('it-second'),
			env: gitEnv(),
		});
		expect(second.outcome).toBe('sliced');
		expect(onArbiter(repo, 'work/tasks/backlog/it-second.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(false);
	});
});

/**
 * REOPEN a tasked brief to ready: from a throwaway clone of the arbiter,
 * `git mv work/briefs/tasked/<slug>.md -> work/briefs/ready/<slug>.md` and push it to `main`
 * (the re-task / reopen-to-ready move, mirroring done/ -> backlog/).
 */
function reopenTaskedBrief(root: string, slug: string): void {
	const dest = join(root, `reopen-${slug}`);
	run(
		'git',
		['clone', '-q', `file://${join(root, 'project-work.git')}`, dest],
		root,
		{env: gitEnv()},
	);
	run('git', ['fetch', '-q', 'origin'], dest, {env: gitEnv()});
	run('git', ['checkout', '-q', '-B', 'reopen', 'origin/main'], dest, {
		env: gitEnv(),
	});
	mkdirSync(join(dest, 'work', 'briefs', 'ready'), {recursive: true});
	run(
		'git',
		['mv', `work/briefs/tasked/${slug}.md`, `work/briefs/ready/${slug}.md`],
		dest,
		{env: gitEnv()},
	);
	run('git', ['commit', '-q', '-m', `reopen ${slug} to ready`], dest, {
		env: gitEnv(),
	});
	run('git', ['push', '-q', 'origin', 'reopen:main'], dest, {env: gitEnv()});
}

/**
 * From a throwaway clone of the arbiter, EDIT the held `work/briefs/ready/<slug>.md` body
 * and push it to `main` — simulating a concurrent writer editing the brief under the
 * tasking lock (the body stays in `work/briefs/ready/` now; the read-stability backstop must
 * detect the changed blob and fail the integrate as `stale`).
 */
function editHeldBriefOnArbiter(root: string, slug: string): void {
	const dest = join(root, `concurrent-edit-${slug}`);
	run(
		'git',
		['clone', '-q', `file://${join(root, 'project-work.git')}`, dest],
		root,
		{env: gitEnv()},
	);
	run('git', ['fetch', '-q', 'origin'], dest, {env: gitEnv()});
	run('git', ['checkout', '-q', '-B', 'edit', 'origin/main'], dest, {
		env: gitEnv(),
	});
	const held = join(dest, 'work', 'briefs', 'ready', `${slug}.md`);
	writeFileSync(
		held,
		readFileSync(held, 'utf8') + '\nCONCURRENT EDIT under the lock.\n',
	);
	run('git', ['add', '-A'], dest, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', 'concurrent edit'], dest, {env: gitEnv()});
	run('git', ['push', '-q', 'origin', 'edit:main'], dest, {env: gitEnv()});
}

// --- Lock contention + agent failure ---------------------------------------

describe('performTask — lock lost / agent failed', () => {
	it('a lost lock is reported (lock-lost), the agent never runs', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		let agentRan = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: {
				acquire: async () => ({
					exitCode: 2,
					outcome: 'lost',
					message: 'someone holds the slicing lock',
				}),
				release: () => {
					throw new Error('release must not run when acquire lost');
				},
			},
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lock-lost');
		expect(agentRan).toBe(false);
	});

	it('an agent failure is reported (agent-failed); the lock is NOT released', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		let released = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			lock: {
				acquire: async () => ({
					exitCode: 0,
					outcome: 'acquired',
					message: 'locked',
					lockedBlob: 'a'.repeat(40),
				}),
				release: async () => {
					released = true;
					return {exitCode: 0, outcome: 'released', message: 'released'};
				},
			},
			agentRunner: () => ({ok: false, detail: 'boom'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/boom/);
		// The runner did NOT release the lock on a failed task (recoverable/re-run).
		expect(released).toBe(false);
	});
});

// --- The tasker review→edit→converge LOOP (tasker-review-edit-loop) -----------

describe('performTask — the slicer review→edit→converge loop', () => {
	/** A loop gate returning a scripted sequence of verdicts (one per pass). */
	function loopGate(verdicts: TaskReviewVerdict[]): TaskReviewGate {
		let i = 0;
		return async () => {
			const v = verdicts[Math.min(i, verdicts.length - 1)];
			i++;
			return v;
		};
	}

	it('a converging loop (findings → edits → clean) LANDS the IMPROVED slices', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('child'),
			reviewLoop: loopGate([
				// Pass 1: block + improve the candidate task in place.
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'thin prompt'}],
					edits: [
						{
							path: 'work/tasks/backlog/child.md',
							content:
								'---\nslug: child\nprd: it\n---\n\n## Prompt\n\n> IMPROVED by the loop\n',
						},
					],
				},
				// Pass 2: converged.
				{verdict: 'approve', findings: []},
			]),
			taskerLoopMax: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('converged');
		// The IMPROVED task landed STAGED on the arbiter (not the pre-loop draft).
		expect(onArbiter(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(showArbiter(repo, 'work/tasks/backlog/child.md')).toMatch(
			/IMPROVED by the loop/,
		);
		// The lock was released + the brief now rests in brief-tasked/ (residence = the SOLE
		// tasked-ness signal; the `tasked:` marker was removed in
		// remove-tasked-marker-step-b).
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(true);
	});

	it('a persistent block hits slicerLoopMax → emits the uncertain slice needsAnswers + questions', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('child'),
			reviewLoop: loopGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'unresolved seam'}],
					uncertainTasks: [
						{
							path: 'work/tasks/backlog/child.md',
							questions: ['which seam does this reuse?'],
						},
					],
				},
			]),
			taskerLoopMax: 2,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('uncertain-slices');
		// The task landed STAGED BUT is flagged needsAnswers with the questions in its body.
		const body = showArbiter(repo, 'work/tasks/backlog/child.md');
		expect(body).toMatch(/needsAnswers: true/);
		expect(body).toMatch(/which seam does this reuse\?/);
		expect(body).toMatch(/## Open questions/);
	});

	it('decomposition-unclear → routes the PRD to needs-attention, emits NO slices', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			agentRunner: taskingAgent('child'),
			reviewLoop: loopGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'wrong shape'}],
					decompositionUnclear: {
						questions: ['should this be split across two PRDs?'],
					},
				},
			]),
			taskerLoopMax: 2,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		// The needs-attention surface is the per-item lock `state: stuck` now (task
		// `cutover-...-trim-folder-sets`), NOT a folder move: the brief body STAYS in
		// work/briefs/ready/ (it never moved under the lock), and NO needs-attention/ or
		// tasking/ folder file is written.
		expect(onArbiter(repo, 'work/briefs/ready/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/needs-attention/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/briefs/tasked/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		// No guessed tasks emitted (neither staged nor in the pool).
		expect(onArbiter(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(onArbiter(repo, 'work/tasks/todo/child.md')).toBe(false);
		// The brief's per-item lock is held STUCK, carrying the questions as the reason.
		const entry = await readItemLock({
			item: 'brief:it',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toMatch(/should this be split across two PRDs\?/);
	});

	it('M>1 runs the loop in fresh contexts (the loop seam is invoked per execution)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const executions: number[] = [];
		const gate: TaskReviewGate = async (input) => {
			executions.push(input.execution);
			// Execution 1 never converges; execution 2 converges on pass 1.
			if (input.execution === 1) {
				return {
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'try again fresh'}],
				};
			}
			return {verdict: 'approve', findings: []};
		};
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			agentRunner: taskingAgent('child'),
			reviewLoop: gate,
			taskerLoopMax: 2,
			reviewExecutions: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('converged');
		// Execution 1 ran twice (slicerLoopMax), execution 2 once (converged), 3 never.
		expect(executions).toEqual([1, 1, 2]);
	});

	it('the HUMAN path is UNAFFECTED by the loop (no loop runs even when a gate is wired)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it', {humanOnly: true});
		let loopRan = false;
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			doer: 'human',
			agentRunner: taskingAgent('child'),
			reviewLoop: async () => {
				loopRan = true;
				return {verdict: 'approve', findings: []};
			},
			taskerLoopMax: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBeUndefined();
		// The loop seam was never invoked on the human path.
		expect(loopRan).toBe(false);
	});

	it('no loop seam wired ⇒ the candidate slices land as-is (pre-loop behaviour)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedBrief(repo, 'it');
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBeUndefined();
		expect(onArbiter(repo, 'work/tasks/backlog/child.md')).toBe(true);
	});

	it('on a POPULATED pool, the loop’s edit attempts to a pool slice are FENCED OUT (the loop only touches pre-backlog/)', async () => {
		// The requeue fix (regression): seed a POPULATED backlog — a pre-existing,
		// already-LANDED task committed on the arbiter — then task. The loop must
		// review/edit/flag ONLY the task THIS run produced; the pre-existing task
		// must be left completely alone (not edited, not needsAnswers-flagged, not
		// re-committed into the runner-owned tasking release).
		const {repo} = seedRepoWithArbiter(scratch.root, ['landed']);
		const landedBefore = showArbiter(repo, 'work/tasks/todo/landed.md');
		seedBrief(repo, 'it');
		const seenByGate: string[][] = [];
		// A loop gate that, given the chance, would HIJACK + flag a landed POOL
		// task — only the pre-backlog/ prefix fence stops it. The agent's own task
		// is in pre-backlog/, so that edit IS in scope and lands.
		const gate: TaskReviewGate = async (input) => {
			seenByGate.push(input.candidateTasks);
			return {
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'rewrite everything'}],
				edits: [
					// Try to overwrite the pre-existing POOL task (must be REFUSED
					// — outside the pre-backlog/ fence)…
					{path: 'work/tasks/todo/landed.md', content: 'HIJACKED landed'},
					// …and improve the run's own task (allowed), keeping valid frontmatter.
					...input.candidateTasks.map((path) => ({
						path,
						content:
							'---\nslug: child\nprd: it\n---\n\n## Prompt\n\n> IMPROVED by the loop\n',
					})),
				],
				// Also try to flag the pre-existing task directly by name.
				uncertainTasks: [
					{path: 'work/tasks/todo/landed.md', questions: ['hijack flag']},
					...input.candidateTasks.map((path) => ({
						path,
						questions: ['own flag'],
					})),
				],
			};
		};
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: taskingAgent('child'),
			reviewLoop: gate,
			taskerLoopMax: 1,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('uncertain-slices');
		// The gate was only ever shown THIS run's own produced STAGED task.
		for (const seen of seenByGate) {
			expect(seen).toEqual(['work/tasks/backlog/child.md']);
		}
		// The pre-existing landed task on the arbiter is BYTE-FOR-BYTE unchanged:
		// not hijacked, not needsAnswers-flagged, not re-committed.
		expect(showArbiter(repo, 'work/tasks/todo/landed.md')).toBe(landedBefore);
		expect(showArbiter(repo, 'work/tasks/todo/landed.md')).not.toMatch(
			/HIJACKED/,
		);
		expect(showArbiter(repo, 'work/tasks/todo/landed.md')).not.toMatch(
			/needsAnswers/,
		);
		// THIS run's own STAGED task WAS the one flagged needsAnswers (cap hit).
		const child = showArbiter(repo, 'work/tasks/backlog/child.md');
		expect(child).toMatch(/needsAnswers: true/);
		expect(child).toMatch(/own flag/);
	});
});

describe('performTask — usage', () => {
	it('errors when the brief does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performTask({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			agentRunner: taskingAgent(),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no brief/);
	});
});
