import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	computeBookkeepingDropSet,
	rebaseDroppingBookkeepingMoves,
	BOOKKEEPING_TRAILER,
	BOOKKEEPING_TRAILER_KEY,
	BOOKKEEPING_TRAILER_VALUE,
} from '../src/drop-bookkeeping-rebase.js';
import {
	routeToNeedsAttention,
	surfaceToNeedsAttention,
} from '../src/needs-attention.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-drop-bk-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Whether the commit's RAW message body carries the bookkeeping trailer line.
 * We scan `%B` (what `git show` displays) rather than `%(trailers:…)` because a
 * tree-less-published commit also carries a `CAS-Nonce` trailer in its own
 * block, and `%(trailers:…)` only recognises the LAST contiguous block. The raw
 * body is still the recorded marker on the commit OBJECT (plumbing), never the
 * rendered rebase-todo text.
 */
function hasTrailerLine(repo: string, rev: string): boolean {
	const body = gitIn(['log', '-1', '--format=%B', rev], repo);
	return new RegExp(
		`^${BOOKKEEPING_TRAILER_KEY}: ${BOOKKEEPING_TRAILER_VALUE}$`,
		'm',
	).test(body);
}

/** The subject (`%s`) of a commit. */
function subjectOf(repo: string, rev: string): string {
	return gitIn(['log', '-1', '--format=%s', rev], repo).trim();
}

// ---------------------------------------------------------------------------
// PRODUCER: both author sites stamp the trailer (distinct from the reason prose)
// ---------------------------------------------------------------------------

describe('producer stamps the Agent-Runner-Bookkeeping trailer', () => {
	it('routeToNeedsAttention (in-worktree) stamps the trailer on the move-only commit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Claim: move backlog→in-progress on a work branch (the routing precondition).
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha)'], repo);

		const reason = 'acceptance gate failed (exit 1)';
		const result = await routeToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			reason,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The move-only commit carries the trailer...
		expect(hasTrailerLine(repo, 'HEAD')).toBe(true);
		// ...the subject is the human-facing route message...
		expect(subjectOf(repo, 'HEAD')).toBe(
			`chore(alpha): route to needs-attention; ${reason}`,
		);
		// ...and the trailer is DISTINCT from the reason prose (the reason text does
		// not contain the trailer string).
		expect(reason).not.toContain(BOOKKEEPING_TRAILER);
		// The returned commitMessage is the bare subject (no trailer) for reporting.
		expect(result.commitMessage).toBe(
			`chore(alpha): route to needs-attention; ${reason}`,
		);
		expect(result.commitMessage).not.toContain(BOOKKEEPING_TRAILER_KEY);
	});

	it('surfaceToNeedsAttention (tree-less) stamps the trailer on the move-only commit', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Move backlog→in-progress on MAIN (the tree-less surface relocates from
		// in-progress on the arbiter's main).
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha)'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		const reason = 'continue push failed terminally';
		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			reason,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// Read the surfaced commit off the arbiter's main (the tree-less CAS published it).
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(hasTrailerLine(repo, 'arbiter/main')).toBe(true);
		expect(subjectOf(repo, 'arbiter/main')).toBe(
			`chore(alpha): route to needs-attention; ${reason}`,
		);
		expect(result.commitMessage).toBe(
			`chore(alpha): route to needs-attention; ${reason}`,
		);
		// The body holds the reason as PROSE (under the heading), distinct from the trailer.
		const body = gitIn(
			['show', 'arbiter/main:work/needs-attention/alpha.md'],
			repo,
		);
		expect(body).toContain(reason);
		expect(body).not.toContain(BOOKKEEPING_TRAILER_KEY);
		void arbiter;
	});
});

// ---------------------------------------------------------------------------
// CONSUMER: drop-set computed from plumbing (trailer + legacy subject), no
// dependence on git's rendered todo text.
// ---------------------------------------------------------------------------

/**
 * Author a move-only-style commit on the checked-out branch. When `trailer` is
 * true the message carries the Agent-Runner-Bookkeeping trailer (the producer
 * shape); otherwise it is a legacy un-trailered commit. The file change is
 * arbitrary (a stamp) — the test cares about the SUBJECT + TRAILER, not the mv.
 */
function commitWith(
	repo: string,
	subject: string,
	stampFile: string,
	trailer: boolean,
): string {
	writeFileSync(join(repo, stampFile), `${stampFile}\n`);
	gitIn(['add', '-A'], repo);
	const message = trailer ? `${subject}\n\n${BOOKKEEPING_TRAILER}` : subject;
	gitIn(['commit', '-q', '-m', message], repo);
	return gitIn(['rev-parse', 'HEAD'], repo).trim();
}

describe('computeBookkeepingDropSet (plumbing identification, no rendered todo)', () => {
	it('drops a TRAILER-stamped route-to-needs-attention commit; keeps feat/wip/→done', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const base = gitIn(['rev-parse', 'HEAD'], repo).trim();
		gitIn(['switch', '-q', '-c', 'work/slice-alpha'], repo);

		const wip = commitWith(repo, 'wip(alpha): agent feature', 'wip.txt', false);
		const routeNA = commitWith(
			repo,
			'chore(alpha): route to needs-attention; gate failed',
			'route.txt',
			true,
		);
		const done = commitWith(
			repo,
			'feat(alpha): agent feature; done',
			'done.txt',
			false,
		);

		const {keep, drop} = computeBookkeepingDropSet({
			cwd: repo,
			base,
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(drop).toEqual([routeNA]);
		expect(keep).toEqual([wip, done]);
	});

	it('drops a LEGACY un-trailered route-to-needs-attention commit (back-compat for pre-change branches)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const base = gitIn(['rev-parse', 'HEAD'], repo).trim();
		gitIn(['switch', '-q', '-c', 'work/slice-alpha'], repo);

		const wip = commitWith(repo, 'wip(alpha): feature', 'wip.txt', false);
		// An OLD move-only commit: the route subject, but NO trailer.
		const legacy = commitWith(
			repo,
			'chore(alpha): route to needs-attention; old surface',
			'route.txt',
			false,
		);

		const {keep, drop} = computeBookkeepingDropSet({
			cwd: repo,
			base,
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(drop).toEqual([legacy]);
		expect(keep).toEqual([wip]);
	});

	it("NEVER drops an UNRELATED slug's trailer-stamped route commit (slug-anchored)", () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const base = gitIn(['rev-parse', 'HEAD'], repo).trim();
		gitIn(['switch', '-q', '-c', 'work/slice-alpha'], repo);

		const mine = commitWith(
			repo,
			'chore(alpha): route to needs-attention; mine',
			'mine.txt',
			true,
		);
		// Another slug's bookkeeping commit (trailer present, but DIFFERENT slug).
		const other = commitWith(
			repo,
			'chore(beta): route to needs-attention; theirs',
			'other.txt',
			true,
		);

		const {keep, drop} = computeBookkeepingDropSet({
			cwd: repo,
			base,
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(drop).toEqual([mine]);
		expect(keep).toEqual([other]);
	});

	it('drops nothing when slug is empty (non-slice back-compat caller)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const base = gitIn(['rev-parse', 'HEAD'], repo).trim();
		gitIn(['switch', '-q', '-c', 'work/slice-alpha'], repo);
		const route = commitWith(
			repo,
			'chore(alpha): route to needs-attention; gate failed',
			'route.txt',
			true,
		);
		const {keep, drop} = computeBookkeepingDropSet({
			cwd: repo,
			base,
			slug: '',
			env: gitEnv(),
		});
		expect(drop).toEqual([]);
		expect(keep).toEqual([route]);
	});
});

// ---------------------------------------------------------------------------
// END-TO-END: the rebase drops the trailer'd commit by SHA, independent of the
// ambient git's todo rendering.
// ---------------------------------------------------------------------------

describe('rebaseDroppingBookkeepingMoves (trailer-driven, version-robust)', () => {
	it('drops a TRAILER-stamped route-to-needs-attention move-only commit and replays clean', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Claim on main, push.
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha)'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Work branch off main: wip + a TRAILER-stamped route-NA move (the producer shape).
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(alpha): feature'], repo);
		mkdirSync(join(repo, 'work', 'needs-attention'), {recursive: true});
		gitIn(
			['mv', 'work/in-progress/alpha.md', 'work/needs-attention/alpha.md'],
			repo,
		);
		gitIn(
			[
				'commit',
				'-q',
				'-m',
				`chore(alpha): route to needs-attention; gate failed\n\n${BOOKKEEPING_TRAILER}`,
			],
			repo,
		);

		// Main tree-lessly advances needs-attention→backlog→in-progress (requeue+claim)
		// so a plain replay of the move would conflict.
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['mv', 'work/in-progress/alpha.md', 'work/backlog/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'requeue(alpha)'], repo);
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha) re-claim'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseDroppingBookkeepingMoves({
			cwd: repo,
			ontoRef: 'arbiter/main',
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(result.status).toBe(0);
		// The wip survived; the bookkeeping move did NOT replay (slug `.md` stays in-progress).
		expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe(
			'agent feature\n',
		);
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);
		const subjects = gitIn(['log', '--format=%s', 'arbiter/main..HEAD'], repo);
		expect(subjects).not.toMatch(/route to needs-attention/);
		expect(subjects).toMatch(/wip\(alpha\): feature/);
	});

	it("drives the rebase by a self-generated todo (GIT_SEQUENCE_EDITOR never reads git's rendered line)", () => {
		// VERSION-ROBUSTNESS proof: force the modern full-subject instructionFormat
		// (`# %s`, the git-2.54 default that broke the old regex) AND command
		// abbreviation. Because we REGENERATE the todo from our own `pick <fullsha>`
		// list, the drop is unaffected by however git would have rendered the line.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['config', 'rebase.instructionFormat', '# %s'], repo);
		gitIn(['config', 'rebase.abbreviateCommands', 'true'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha)'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(alpha): feature'], repo);
		mkdirSync(join(repo, 'work', 'needs-attention'), {recursive: true});
		gitIn(
			['mv', 'work/in-progress/alpha.md', 'work/needs-attention/alpha.md'],
			repo,
		);
		gitIn(
			[
				'commit',
				'-q',
				'-m',
				`chore(alpha): route to needs-attention; gate failed\n\n${BOOKKEEPING_TRAILER}`,
			],
			repo,
		);
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['mv', 'work/in-progress/alpha.md', 'work/backlog/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'requeue(alpha)'], repo);
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha) re-claim'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseDroppingBookkeepingMoves({
			cwd: repo,
			ontoRef: 'arbiter/main',
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(result.status).toBe(0);
		const subjects = gitIn(['log', '--format=%s', 'arbiter/main..HEAD'], repo);
		expect(subjects).not.toMatch(/route to needs-attention/);
		expect(subjects).toMatch(/wip\(alpha\): feature/);
	});

	it('CROSS-MACHINE: drops the bookkeeping commit on a continue-rebase cut in a FRESH clone', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Claim on main, push.
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha)'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Build the kept work branch ON THE FIRST MACHINE and push it to the arbiter.
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(alpha): feature'], repo);
		mkdirSync(join(repo, 'work', 'needs-attention'), {recursive: true});
		gitIn(
			['mv', 'work/in-progress/alpha.md', 'work/needs-attention/alpha.md'],
			repo,
		);
		gitIn(
			[
				'commit',
				'-q',
				'-m',
				`chore(alpha): route to needs-attention; gate failed\n\n${BOOKKEEPING_TRAILER}`,
			],
			repo,
		);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		// Main advances on the arbiter (requeue+claim).
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['mv', 'work/in-progress/alpha.md', 'work/backlog/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'requeue(alpha)'], repo);
		gitIn(['mv', 'work/backlog/alpha.md', 'work/in-progress/alpha.md'], repo);
		gitIn(['commit', '-q', '-m', 'claim(alpha) re-claim'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);

		// A DIFFERENT machine: a fresh clone that has NEVER seen the in-memory sha.
		const machine2 = join(scratch.root, 'machine2');
		gitIn(['clone', '-q', `file://${arbiter}`, machine2], scratch.root);
		gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], machine2);
		gitIn(['fetch', '-q', 'arbiter'], machine2);
		gitIn(
			['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/work/slice-alpha'],
			machine2,
		);

		const result = rebaseDroppingBookkeepingMoves({
			cwd: machine2,
			ontoRef: 'arbiter/main',
			slug: 'alpha',
			env: gitEnv(),
		});
		expect(result.status).toBe(0);
		// The trailer (on the commit object) travelled with the branch to machine2,
		// so the drop happened with NO in-process value.
		expect(readFileSync(join(machine2, 'feature.txt'), 'utf8')).toBe(
			'agent feature\n',
		);
		expect(existsSync(join(machine2, 'work', 'in-progress', 'alpha.md'))).toBe(
			true,
		);
		const subjects = gitIn(
			['log', '--format=%s', 'arbiter/main..HEAD'],
			machine2,
		);
		expect(subjects).not.toMatch(/route to needs-attention/);
	});
});
