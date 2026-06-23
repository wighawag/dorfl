import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	chmodSync,
	readFileSync,
	existsSync,
} from 'node:fs';
import {join} from 'node:path';
import {
	branchAheadOf,
	rebaseContinuedBranchOntoMain,
	pushContinuedBranchWithStaleLeaseRetry,
} from '../src/continue-branch.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-continue-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('branchAheadOf', () => {
	it('is false when the branch ref is absent (fresh cut, no continue)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/task-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('is true when the branch exists ahead of main (work to continue)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Cut a work branch with a commit beyond main, push it to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/task-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior attempt\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/task-alpha:work/task-alpha'], repo);
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/task-alpha', 'arbiter/main', gitEnv()),
		).toBe(true);
	});

	it('is false when the branch is fully merged into main (nothing beyond)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// A work branch at the SAME tip as main (no commits beyond).
		gitIn(['branch', 'work/task-alpha', 'arbiter/main'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/task-alpha:work/task-alpha'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/task-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('works against a BARE mirror with local heads (job-worktree refs)', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Push a work branch ahead of main to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/task-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/task-alpha:work/task-alpha'], repo);

		// A bare mirror clone of the arbiter — local heads `main` + `work/task-alpha`.
		const mirror = join(scratch.root, 'mirror.git');
		gitIn(['clone', '-q', '--bare', `file://${arbiter}`, mirror], scratch.root);
		expect(branchAheadOf(mirror, 'work/task-alpha', 'main', gitEnv())).toBe(
			true,
		);
	});
});

describe('rebaseContinuedBranchOntoMain', () => {
	it('replays a clean continued branch onto a moved main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Prior attempt branch off the original main.
		gitIn(['switch', '-q', '-c', 'work/task-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();

		// Main moves (a non-conflicting file) on the arbiter.
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'unrelated.txt'), 'unrelated\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main moved'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/task-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// The work commit was replayed onto the moved main: feature.txt present,
		// unrelated.txt (from main) present, and the tip moved (rewritten SHA).
		expect(gitIn(['cat-file', '-e', 'HEAD:feature.txt'], repo)).toBe('');
		expect(gitIn(['cat-file', '-e', 'HEAD:unrelated.txt'], repo)).toBe('');
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).not.toBe(priorTip);
	});

	it('aborts a conflicting rebase (never auto-resolves) and reports conflict', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Prior attempt edits shared.txt.
		gitIn(['switch', '-q', '-c', 'work/task-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work edits shared'], repo);

		// Main edits the SAME file differently on the arbiter.
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main edits shared'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/task-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			gitEnv(),
		);
		expect(result.kind).toBe('conflict');
		// The rebase was aborted: HEAD is back on a clean work/task-alpha (no rebase
		// in progress), still on its own tip.
		const status = gitIn(['status', '--porcelain'], repo);
		expect(status.trim()).toBe('');
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'work/task-alpha',
		);
	});

	// --- Plain rebase: no transient status on the branch, nothing to drop -------
	//
	// After the per-item-lock cut-over (PRD `ledger-status-per-item-lock-refs`,
	// tasks 9a–9d) NO transient status lands on a work branch: claim does not move
	// the body (it rests in `backlog/`), needs-attention is the lock `state: stuck`
	// (not a `git mv`), and the tasking/advancing markers are gone. So a branch cut
	// from `main` inherits NO runner-authored move-only bookkeeping commit, and a
	// continue/rebase onto a freshly-advanced `main` is a PLAIN rebase — there is
	// nothing to drop and no rename/rename ledger conflict. This proves the
	// `drop-bookkeeping-rebase` machinery is genuinely dead (9d).

	it('is a PLAIN continue-rebase: a branch carrying only agent work (the body stays in backlog/) replays clean onto a moved main with no ledger conflict', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		// The body RESTS in `backlog/` on main (claim no longer moves it, task 9a).
		// Cut the work branch off main — it inherits the SAME `work/tasks/todo/alpha.md`
		// main has, so there is NO transient-status file unique to the branch.
		gitIn(['switch', '-q', '-c', 'work/task-alpha', 'arbiter/main'], repo);
		expect(existsSync(join(repo, 'work', 'tasks', 'todo', 'alpha.md'))).toBe(
			true,
		);
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(alpha): agent feature'], repo);

		// main advances DURABLY and independently: another task lands a durable
		// `backlog → done` move for a SIBLING item + an unrelated content change. None
		// of this touches our slug's `backlog/alpha.md`, so a plain replay is clean.
		gitIn(['switch', '-q', 'main'], repo);
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'tasks', 'todo', 'beta.md'),
			'---\nslug: beta\n---\nbeta\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed beta'], repo);
		gitIn(['mv', 'work/tasks/todo/beta.md', 'work/tasks/done/beta.md'], repo);
		gitIn(['commit', '-q', '-m', 'feat(beta): sibling; done'], repo);
		writeFileSync(join(repo, 'unrelated.txt'), 'unrelated main change\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main moved'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		// The continue-rebase is now a PLAIN rebase (no drop step).
		gitIn(['switch', '-q', 'work/task-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			gitEnv(),
		);
		expect(result.kind).toBe('clean');

		// The agent's wip replayed onto the moved main; main's durable moves came
		// along; our slug's body is STILL in backlog/ (it never had a transient move).
		expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe(
			'agent feature\n',
		);
		expect(existsSync(join(repo, 'unrelated.txt'))).toBe(true);
		expect(existsSync(join(repo, 'work', 'tasks', 'done', 'beta.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'tasks', 'todo', 'alpha.md'))).toBe(
			true,
		);
		// No needs-attention / transient move ever existed on the branch to conflict.
		const subjects = gitIn(['log', '--format=%s', 'arbiter/main..HEAD'], repo);
		expect(subjects).not.toMatch(/route to needs-attention/);
		expect(subjects).toMatch(/wip\(alpha\): agent feature/);
	});
});

/**
 * Build the job-worktree topology of `createJob`'s CONTINUE path: an arbiter
 * holding `work/task-<slug>` ahead of `main`, a BARE mirror cloned from it, and
 * a worktree of that mirror checked out ON the work branch (its `origin` is the
 * real arbiter). Returns the worktree dir, the arbiter path, and the arbiter
 * `work/<branch>` tip the mirror fetched (the value a --force-with-lease push
 * expects). The caller then adds the green work commit + (optionally) advances
 * the arbiter ref to make the lease STALE.
 */
function continueWorktree(slug: string): {
	dir: string;
	branch: string;
	arbiter: string;
	mirror: string;
	repo: string;
	fetchedTip: string;
} {
	const branch = `work/task-${slug}`;
	const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [slug]);
	// Put a prior-attempt commit on the work branch on the arbiter (the requeue
	// keeps it) so the branch is ahead of main — the CONTINUE precondition.
	gitIn(['fetch', '-q', 'arbiter'], repo);
	gitIn(['switch', '-q', '-c', branch, 'arbiter/main'], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	gitIn(['push', '-q', 'arbiter', `${branch}:${branch}`], repo);

	// A bare mirror cloned from the arbiter, then a worktree on the work branch
	// (its `origin` is the arbiter — exactly the createJob job-worktree shape).
	const mirror = join(scratch.root, `mirror-${slug}.git`);
	gitIn(['clone', '-q', '--bare', `file://${arbiter}`, mirror], scratch.root);
	const dir = join(scratch.root, `wt-${slug}`);
	gitIn(['worktree', 'add', '-q', dir, branch], mirror);
	const fetchedTip = gitIn(['rev-parse', branch], mirror).trim();
	return {dir, branch, arbiter, mirror, repo, fetchedTip};
}

/** A throwaway clone of the arbiter that advances `work/<branch>` behind our back. */
function advanceArbiterWorkBranch(
	arbiter: string,
	branch: string,
	label: string,
	file: string,
): string {
	const dest = join(scratch.root, `mover-${label}`);
	gitIn(['clone', '-q', `file://${arbiter}`, dest], scratch.root);
	gitIn(['switch', '-q', '-C', branch, `origin/${branch}`], dest);
	writeFileSync(join(dest, file), `${file}\n`);
	gitIn(['add', '-A'], dest);
	gitIn(['commit', '-q', '-m', `arbiter moved ${branch}`], dest);
	gitIn(['push', '-q', 'origin', `${branch}:${branch}`], dest);
	return arbiterTip(arbiter, branch);
}

/** The arbiter's current sha for `work/<branch>`. */
function arbiterTip(arbiter: string, branch: string): string {
	const out = gitIn(
		['ls-remote', `file://${arbiter}`, `refs/heads/${branch}`],
		scratch.root,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

describe('pushContinuedBranchWithStaleLeaseRetry', () => {
	it('pushes on the first try when the lease is NOT stale (no retry needed)', () => {
		const {dir, branch, arbiter, fetchedTip} = continueWorktree('happy');
		// Our green work on the (current) work branch tip.
		writeFileSync(join(dir, 'green.txt'), 'green work\n');
		gitIn(['add', '-A'], dir);
		gitIn(['commit', '-q', '-m', 'green build'], dir);
		const ourTip = gitIn(['rev-parse', 'HEAD'], dir).trim();

		const result = pushContinuedBranchWithStaleLeaseRetry({
			cwd: dir,
			branch,
			arbiter: 'origin',
			mainRef: 'main',
			expectedRemoteTip: fetchedTip,
			env: gitEnv(),
		});
		expect(result.kind).toBe('pushed');
		expect(arbiterTip(arbiter, branch)).toBe(ourTip);
	});

	it('survives a STALE-LEASE rejection: re-fetches, re-rebases cleanly, retries, and lands the green work', () => {
		const {dir, branch, arbiter, fetchedTip} = continueWorktree('stale');
		// Our green work, committed in the worktree (the recoverable artifact).
		writeFileSync(join(dir, 'green.txt'), 'green work\n');
		gitIn(['add', '-A'], dir);
		gitIn(['commit', '-q', '-m', 'green build (1467 tests, approved)'], dir);

		// The arbiter work ref MOVES (a requeue-continue churned it) AFTER the mirror
		// fetch — a non-conflicting file — so our lease's expected tip is now STALE.
		advanceArbiterWorkBranch(arbiter, branch, 'stale', 'churned.txt');
		expect(arbiterTip(arbiter, branch)).not.toBe(fetchedTip);

		const notes: string[] = [];
		const result = pushContinuedBranchWithStaleLeaseRetry({
			cwd: dir,
			branch,
			arbiter: 'origin',
			mainRef: 'main',
			expectedRemoteTip: fetchedTip,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.kind).toBe('pushed');
		// The retry fired (a stale-lease note was emitted), and the arbiter now holds
		// OUR green work (green.txt reachable from the new tip).
		expect(notes.join('\n')).toMatch(/stale lease/i);
		const landed = arbiterTip(arbiter, branch);
		expect(landed).not.toBe(fetchedTip);
		expect(landed).toBe(gitIn(['rev-parse', 'HEAD'], dir).trim());
		expect(gitIn(['cat-file', '-e', `${landed}:green.txt`], dir)).toBe('');
	});

	it('routes a CONFLICTING re-rebase on retry to the caller (needs-attention), never auto-resolving', () => {
		const {dir, branch, arbiter, fetchedTip} = continueWorktree('conflict');
		// Our green work edits shared.txt one way.
		writeFileSync(join(dir, 'shared.txt'), 'worktree version\n');
		gitIn(['add', '-A'], dir);
		gitIn(['commit', '-q', '-m', 'green build edits shared'], dir);

		// The arbiter work ref advances editing shared.txt DIFFERENTLY (a conflict on
		// the re-rebase onto the moved main), AND main moves to that tip so the
		// re-rebase replays onto it.
		const mover = join(scratch.root, 'mover-conflict');
		gitIn(['clone', '-q', `file://${arbiter}`, mover], scratch.root);
		gitIn(['switch', '-q', '-C', 'mv-main', 'origin/main'], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main edits shared'], mover);
		// Advance BOTH main and the work branch to that conflicting tip (force the
		// work ref — it diverges from the prior-attempt tip it currently holds).
		gitIn(['push', '-q', 'origin', 'mv-main:main'], mover);
		gitIn(['push', '-q', '--force', 'origin', `mv-main:${branch}`], mover);
		expect(arbiterTip(arbiter, branch)).not.toBe(fetchedTip);

		const result = pushContinuedBranchWithStaleLeaseRetry({
			cwd: dir,
			branch,
			arbiter: 'origin',
			mainRef: 'main',
			expectedRemoteTip: fetchedTip,
			env: gitEnv(),
		});
		expect(result.kind).toBe('conflict');
		// The rebase was ABORTED (never auto-resolved): the worktree is clean and our
		// green work is still committed on the branch (recoverable).
		expect(gitIn(['status', '--porcelain'], dir).trim()).toBe('');
		expect(gitIn(['log', '--format=%s', 'HEAD'], dir)).toMatch(
			/green build edits shared/,
		);
	});

	it('fails with a CLEAR terminal message after the retry cap, leaving the green work recoverable', () => {
		const {dir, branch, arbiter, fetchedTip} = continueWorktree('cap');
		writeFileSync(join(dir, 'green.txt'), 'green work\n');
		gitIn(['add', '-A'], dir);
		gitIn(['commit', '-q', '-m', 'green build'], dir);
		const ourSubject = gitIn(['log', '--format=%s', 'HEAD'], dir).trim();

		// The lease is stale (the arbiter moved past our expected tip). With retries: 0
		// the helper makes ONE push attempt, sees the stale-lease rejection, and — the
		// cap being 0 — gives up at once with a clear terminal error (no re-fetch).
		advanceArbiterWorkBranch(arbiter, branch, 'cap', 'churned.txt');
		expect(() =>
			pushContinuedBranchWithStaleLeaseRetry({
				cwd: dir,
				branch,
				arbiter: 'origin',
				mainRef: 'main',
				expectedRemoteTip: fetchedTip,
				retries: 0,
				env: gitEnv(),
			}),
		).toThrow(/stale .*--force-with-lease|needs-attention/i);
		// The green work is STILL committed on the branch (recoverable, never lost),
		// and the arbiter still holds ITS tip (our work was NOT blind-overwritten).
		expect(gitIn(['log', '--format=%s', 'HEAD'], dir).trim()).toBe(ourSubject);
	});

	it('NEVER uses bare --force and NEVER targets main (guardrails)', () => {
		const {dir, branch, arbiter, fetchedTip} = continueWorktree('guard');
		writeFileSync(join(dir, 'green.txt'), 'green work\n');
		gitIn(['add', '-A'], dir);
		gitIn(['commit', '-q', '-m', 'green build'], dir);
		const mainBefore = arbiterTip(arbiter, 'main');

		// Stale the lease so the RETRY path (the new code) is exercised too.
		advanceArbiterWorkBranch(arbiter, branch, 'guard', 'churned.txt');

		// Record every `git` argv the helper runs via a PATH-shimmed git, so we can
		// assert the EXACT push flags (no bare --force, no `:main`).
		const commands: string[][] = [];
		const result = traceGit(commands, (tracedEnv) =>
			pushContinuedBranchWithStaleLeaseRetry({
				cwd: dir,
				branch,
				arbiter: 'origin',
				mainRef: 'main',
				expectedRemoteTip: fetchedTip,
				env: tracedEnv,
			}),
		);
		expect(result.kind).toBe('pushed');
		const pushes = commands.filter((c) => c.includes('push'));
		expect(pushes.length).toBeGreaterThan(0);
		for (const cmd of pushes) {
			const joined = cmd.join(' ');
			// Every force is a --force-with-lease, NEVER a bare --force / -f.
			expect(cmd).not.toContain('--force');
			expect(cmd).not.toContain('-f');
			expect(joined).toMatch(/--force-with-lease=/);
			// NEVER a push whose DESTINATION ref is main.
			expect(joined).not.toMatch(/:main(\s|$)/);
		}
		// main is untouched on the arbiter.
		expect(arbiterTip(arbiter, 'main')).toBe(mainBefore);
	});
});

/**
 * Run `fn(env)` with a PATH-shimmed `git` (passed via the returned `env`) that
 * records every argv into `sink`, then delegates to the real git. Lets a test
 * assert the EXACT push flags the helper used (no bare --force, no `:main`)
 * without parsing GIT_TRACE. The shim is wired through the `env` the helper
 * spawns with (NOT process.env), so it is robust to the call-time env capture.
 */
function traceGit<T>(sink: string[][], fn: (env: NodeJS.ProcessEnv) => T): T {
	const shimDir = join(
		scratch.root,
		`git-shim-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(shimDir, {recursive: true});
	const logFile = join(shimDir, 'argv.log');
	const shim = join(shimDir, 'git');
	// The shim records argv (US/RS-separated) then execs the REAL git found on the
	// caller's original PATH (threaded in as REAL_PATH so the shim never recurses).
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
