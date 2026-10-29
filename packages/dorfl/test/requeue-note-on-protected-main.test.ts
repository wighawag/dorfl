import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	readFileSync,
	mkdirSync,
	chmodSync,
	existsSync,
} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {currentLedgerWrite} from '../src/ledger-write.js';
import {refWrite, currentRefWrite} from '../src/ref-write.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {resolveContinueContext, resolveTask} from '../src/prompt.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	heldLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `requeue -m` against a PROTECTED `main` (a branch-protection rule refuses every
 * direct push; everything lands through PRs in propose mode).
 *
 * The arbiter is a local `--bare` repo whose `pre-receive` hook refuses any update
 * of `refs/heads/main` with a branch-protection style error, the same shape a
 * hosted remote produces (`! [remote rejected] main -> main (... declined)`).
 * Lock refs and `work/*` branches stay writable, exactly as on a hosted remote
 * whose protection rule covers `main` only. Nothing outside the scratch dir is
 * touched.
 */

const ARBITER = 'arbiter';
const REFUSAL = 'GH006: Protected branch update failed for refs/heads/main.';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-protected-');
});
afterEach(() => {
	refWrite.pushLeasedWorkBranch = currentRefWrite.pushLeasedWorkBranch;
	scratch.cleanup();
});

/** Install a pre-receive hook on the bare arbiter that refuses `main` updates. */
function protectMain(arbiter: string): void {
	const hooks = join(arbiter, 'hooks');
	mkdirSync(hooks, {recursive: true});
	const hook = join(hooks, 'pre-receive');
	writeFileSync(
		hook,
		[
			'#!/bin/sh',
			'while read old new ref; do',
			'  if [ "$ref" = "refs/heads/main" ]; then',
			`    echo "error: ${REFUSAL}" >&2`,
			'    exit 1',
			'  fi',
			'done',
			'exit 0',
			'',
		].join('\n'),
	);
	chmodSync(hook, 0o755);
}

/**
 * The observed state: the task was claimed (lock held), built, done-moved and
 * pushed on its kept `work/task-<slug>` branch (a propose PR is open, its CI
 * failed). `main` is protected. The body still rests in `tasks/ready/` on main.
 */
async function claimedWithOpenProposePr(
	slug: string,
	opts: {doneMove?: boolean} = {},
): Promise<{seeded: SeededRepo; repo: string}> {
	const doneMove = opts.doneMove ?? true;
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
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	if (doneMove) {
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(
			['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
			repo,
		);
	}
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): first attempt`], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	protectMain(seeded.arbiter);
	return {seeded, repo};
}

function showOnArbiter(repo: string, rev: string): string | undefined {
	const shown = run('git', ['show', rev], repo, {env: gitEnv()});
	return shown.status === 0 ? shown.stdout : undefined;
}

describe('the ledger write seam: a REFUSED push is not a lost race', () => {
	it('classifies a push the remote refused (main unmoved) as refused, with the remote error text', async () => {
		const {seeded, repo} = await claimedWithOpenProposePr('seam');
		void seeded;
		gitIn(['fetch', '-q', ARBITER], repo);
		const base = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		// A trivial commit on top of main to publish.
		const head = run(
			'git',
			['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'chore: noop'],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		gitIn(['update-ref', 'refs/dorfl-test/publish', head], repo);
		const result = await currentLedgerWrite.applyTransition({
			kind: 'requeue',
			arbiter: ARBITER,
			localBranch: 'refs/dorfl-test/publish',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(result.kind).toBe('refused');
		expect(result.message).toContain(REFUSAL);
	});

	it('when the arbiter cannot be re-read, does not claim main stayed put', async () => {
		const {repo} = await claimedWithOpenProposePr('seam-gone');
		gitIn(['fetch', '-q', ARBITER], repo);
		const base = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		const head = run(
			'git',
			['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'chore: noop'],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		gitIn(['update-ref', 'refs/dorfl-test/publish', head], repo);
		// A remote that does not exist: both the push and the re-read fail.
		gitIn(
			['remote', 'add', 'gone', `file://${join(scratch.root, 'no-such.git')}`],
			repo,
		);
		const result = await currentLedgerWrite.applyTransition({
			kind: 'requeue',
			arbiter: 'gone',
			localBranch: 'refs/dorfl-test/publish',
			expectedBase: base,
			head,
			cwd: repo,
			env: gitEnv(),
		});
		expect(result.kind).toBe('refused');
		expect(result.message).toMatch(/could not be re-read/);
		expect(result.message).not.toMatch(/main did not move/);
	});
});

describe('requeue -m on a PROTECTED main', () => {
	it('does not misread the refusal as main moving, and delivers the note on the kept branch the next claim continues from', async () => {
		const slug = 'guarded';
		const {seeded, repo} = await claimedWithOpenProposePr(slug);
		const handoff = 'CI failed on the lint job; fix the import order first';
		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug,
			arbiter: ARBITER,
			message: handoff,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.moved).toBe(true);

		// (a) Not a race: main never moved, so no retry chatter.
		expect(notes.some((n) => /main advanced under us/.test(n))).toBe(false);
		// (b) Reported as what it is, with the remote's own error text.
		expect(notes.some((n) => /refused/i.test(n) && n.includes(REFUSAL))).toBe(
			true,
		);
		// (c) The lock is released (the requeue still recovers the item).
		expect(heldLockOnArbiter(repo, slug, ARBITER)).toBe(false);

		// (d) The note rides the KEPT branch, on the body the branch carries.
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchBody = showOnArbiter(
			repo,
			`${ARBITER}/work/task-${slug}:work/tasks/done/${slug}.md`,
		);
		expect(branchBody).toBeDefined();
		expect(branchBody).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(branchBody).toContain(handoff);
		// main is untouched (it is protected).
		const mainBody = showOnArbiter(
			repo,
			`${ARBITER}/main:work/tasks/ready/${slug}.md`,
		);
		expect(mainBody).toBeDefined();
		expect(mainBody).not.toContain(handoff);

		// (e) The EXISTING continue path reads it: a fresh machine continues from the
		// kept branch and the continue context carries the note.
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug,
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
		const gate = {
			cwd: fresh,
			branchRef: `${ARBITER}/work/task-${slug}`,
			mainRef: `${ARBITER}/main`,
			env: gitEnv(),
		};
		const task = resolveTask(fresh, slug, gate);
		const ctx = resolveContinueContext({
			cwd: fresh,
			slug,
			arbiter: ARBITER,
			branchRef: gate.branchRef,
			mainRef: gate.mainRef,
			content: readFileSync(task.path, 'utf8'),
			env: gitEnv(),
		});
		expect(ctx).toBeDefined();
		expect(ctx!.requeueNotes.join('\n')).toContain(handoff);
	});

	it('delivers the note on a kept branch whose body is still in tasks/ready/ (not done-moved)', async () => {
		const slug = 'guarded-ready';
		const {repo} = await claimedWithOpenProposePr(slug, {doneMove: false});
		const handoff = 'the build is half done; finish the parser';
		const result = await returnToBacklog({
			cwd: repo,
			slug,
			arbiter: ARBITER,
			message: handoff,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.handoffNoteDeliveredTo).toBe('work-branch');
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchBody = showOnArbiter(
			repo,
			`${ARBITER}/work/task-${slug}:work/tasks/ready/${slug}.md`,
		);
		expect(branchBody).toContain(handoff);
	});

	it('when the branch push loses its lease, prints the note in full instead of dropping it', async () => {
		const slug = 'guarded-lease';
		const {repo} = await claimedWithOpenProposePr(slug);
		// The branch moved between the read and the push: the leased push fails.
		refWrite.pushLeasedWorkBranch = async () => ({
			status: 1,
			stdout: '',
			stderr: ` ! [rejected]        work/task-${slug} (stale info)\n`,
		});
		const handoff = 'a note that must survive a lost lease';
		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug,
			arbiter: ARBITER,
			message: handoff,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.moved).toBe(true);
		expect(result.handoffNoteUndelivered).toBe(handoff);
		const undelivered = notes.find((n) =>
			/could not append the -m handoff note/.test(n),
		);
		expect(undelivered).toContain(handoff);
		expect(undelivered).toContain('stale info');
		// The refusal is reported once, not echoed by the move loop as well.
		expect(notes.filter((n) => n.includes(REFUSAL)).length).toBe(1);
	});

	it('with no kept branch to carry it (--reset), prints the note IN FULL rather than dropping it', async () => {
		const slug = 'guarded-reset';
		const {repo} = await claimedWithOpenProposePr(slug);
		const handoff =
			'Line one of a long steer.\nLine two: the approach was wrong, try X.';
		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug,
			arbiter: ARBITER,
			reset: true,
			message: handoff,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.moved).toBe(true);
		expect(notes.some((n) => /main advanced under us/.test(n))).toBe(false);
		const undelivered = notes.find((n) =>
			/could not append the -m handoff note/.test(n),
		);
		expect(undelivered).toBeDefined();
		// The full note text is in the output, so it is never silently lost.
		expect(undelivered).toContain(handoff);
		expect(undelivered).toContain(REFUSAL);
		expect(result.handoffNoteUndelivered).toBe(handoff);
	});
});
