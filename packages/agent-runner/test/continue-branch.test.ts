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
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('is true when the branch exists ahead of main (work to continue)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Cut a work branch with a commit beyond main, push it to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior attempt\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(true);
	});

	it('is false when the branch is fully merged into main (nothing beyond)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// A work branch at the SAME tip as main (no commits beyond).
		gitIn(['branch', 'work/slice-alpha', 'arbiter/main'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			branchAheadOf(repo, 'arbiter/work/slice-alpha', 'arbiter/main', gitEnv()),
		).toBe(false);
	});

	it('works against a BARE mirror with local heads (job-worktree refs)', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Push a work branch ahead of main to the arbiter.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'prior.txt'), 'prior\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior work'], repo);
		gitIn(['push', '-q', 'arbiter', 'work/slice-alpha:work/slice-alpha'], repo);

		// A bare mirror clone of the arbiter — local heads `main` + `work/slice-alpha`.
		const mirror = join(scratch.root, 'mirror.git');
		gitIn(['clone', '-q', '--bare', `file://${arbiter}`, mirror], scratch.root);
		expect(branchAheadOf(mirror, 'work/slice-alpha', 'main', gitEnv())).toBe(
			true,
		);
	});
});

describe('rebaseContinuedBranchOntoMain', () => {
	it('replays a clean continued branch onto a moved main', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Prior attempt branch off the original main.
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
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

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			'slice-alpha',
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
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
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

		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			'slice-alpha',
			gitEnv(),
		);
		expect(result.kind).toBe('conflict');
		// The rebase was aborted: HEAD is back on a clean work/slice-alpha (no rebase
		// in progress), still on its own tip.
		const status = gitIn(['status', '--porcelain'], repo);
		expect(status.trim()).toBe('');
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'work/slice-alpha',
		);
	});

	// --- Regression: drop runner-authored bookkeeping move-only commits -------
	//
	// Live failure shape: a kept work branch carries `chore(<slug>): route to
	// needs-attention; <reason>` move-only commits (the runner's own surfacing
	// bookkeeping). The runner ALSO tree-lessly advances `main`'s `.md` slot on
	// the next claim (needs-attention→backlog→in-progress). A plain rebase replays
	// the bookkeeping move onto a main that holds the slug in a DIFFERENT folder
	// → rename/content conflict → needs-attention. The agent self-conflicted with
	// the runner's own protocol bookkeeping. The fix DROPS those move-only
	// commits on replay (slug-anchored subject match) so the wip / `→done` survive
	// and replay cleanly. Genuine code conflicts (post-drop) still surface.

	/** Move `work/<from>/<slug>.md` → `work/<to>/<slug>.md` on the checked-out
	 * branch as a runner-style tree-less mv + commit, with the GIVEN subject. */
	function moveLedger(
		repo: string,
		slug: string,
		from: string,
		to: string,
		subject: string,
	): void {
		const toDir = join(repo, 'work', to);
		mkdirSync(toDir, {recursive: true});
		gitIn(['mv', `work/${from}/${slug}.md`, `work/${to}/${slug}.md`], repo);
		gitIn(['commit', '-q', '-m', subject], repo);
	}

	/** Seed a repo with `work/in-progress/<slug>.md` so a ledger move has
	 * something to move (mirrors the runner's claim state at the moment of
	 * routing-to-needs-attention). Cuts a branch off main and switches HEAD to it. */
	function seedInProgress(slug: string): {
		repo: string;
		arbiter: string;
		branch: string;
	} {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [slug]);
		const branch = `work/slice-${slug}`;
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Move backlog→in-progress on MAIN first, push.
		gitIn(['switch', '-q', 'main'], repo);
		moveLedger(repo, slug, 'backlog', 'in-progress', `claim(${slug})`);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		// Cut work branch off main— the agent's starting point.
		gitIn(['switch', '-q', '-c', branch, 'arbiter/main'], repo);
		return {repo, arbiter, branch};
	}

	it("drops the kept branch's stale `route to needs-attention` move-only commits and replays cleanly (live regression)", () => {
		const slug = 'slice-alpha';
		const {repo, branch} = seedInProgress('alpha');

		// Branch: a wip code commit, then TWO runner-authored route-to-needs-attention
		// move-only commits (mirroring the live trace 61ea593 + 9e9847c).
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(slice-alpha): agent feature'], repo);
		const wipSha = gitIn(['rev-parse', 'HEAD'], repo).trim();
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'needs-attention',
			`chore(${slug}): route to needs-attention; acceptance gate failed (exit 1)`,
		);
		// A SECOND route-NA commit (a re-route). It moves needs-attention→needs-attention
		// in the live trace via edits to the body; here we just edit the body in place
		// to keep the test focused on the SUBJECT-anchored sed (the dropping logic).
		writeFileSync(
			join(repo, 'work', 'needs-attention', `alpha.md`),
			readFileSync(join(repo, 'work', 'needs-attention', 'alpha.md'), 'utf8') +
				'\n## Needs attention\n\ncontinuing the kept rebase conflicted\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(
			[
				'commit',
				'-q',
				'-m',
				`chore(${slug}): route to needs-attention; continuing the kept rebase conflicted`,
			],
			repo,
		);

		// Main moves the ledger tree-lessly: needs-attention→backlog→in-progress
		// (the requeue + next-claim sequence). A plain rebase of the branch's two
		// move-only commits onto this main would conflict; the drop avoids it.
		gitIn(['switch', '-q', 'main'], repo);
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'needs-attention',
			`chore(${slug}): route to needs-attention; surfaced by runner`,
		);
		moveLedger(repo, 'alpha', 'needs-attention', 'backlog', `requeue(${slug})`);
		moveLedger(
			repo,
			'alpha',
			'backlog',
			'in-progress',
			`claim(${slug}) re-claim`,
		);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', branch], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			slug,
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// The wip code commit was preserved (feature.txt content reachable).
		expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe(
			'agent feature\n',
		);
		// The slug's `.md` is in `work/in-progress/` (from main), NOT `needs-attention/`
		// (the bookkeeping commits that moved it there were dropped).
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);
		// No `route to needs-attention` commit survives anywhere in the rebased history.
		const subjects = gitIn(['log', '--format=%s', `arbiter/main..HEAD`], repo);
		expect(subjects).not.toMatch(/route to needs-attention/);
		// The wip's SHA was rewritten (rebased onto a moved main), so it differs.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).not.toBe(wipSha);
	});

	it('preserves an UNRELATED-slug `route to needs-attention` bookkeeping commit (slug-anchored drop)', () => {
		const slug = 'slice-alpha';
		const {repo, branch} = seedInProgress('alpha');

		// On the branch: a wip commit, then a route-NA commit for ANOTHER slug.
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(slice-alpha): feature'], repo);
		// Seed work/in-progress/beta.md so a route-NA for `beta` has something to move.
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'in-progress', 'beta.md'),
			'---\nslug: beta\n---\nbeta\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip: seed beta'], repo);
		moveLedger(
			repo,
			'beta',
			'in-progress',
			'needs-attention',
			`chore(slice-beta): route to needs-attention; unrelated`,
		);

		// Main moves only OUR slug, leaving beta alone.
		gitIn(['switch', '-q', 'main'], repo);
		moveLedger(repo, 'alpha', 'in-progress', 'backlog', `requeue(${slug})`);
		moveLedger(repo, 'alpha', 'backlog', 'in-progress', `claim(${slug})`);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', branch], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			slug,
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// The OTHER slug's route-NA commit was NOT dropped (different slug in subject).
		const subjects = gitIn(['log', '--format=%s', `arbiter/main..HEAD`], repo);
		expect(subjects).toMatch(/chore\(slice-beta\): route to needs-attention/);
	});

	it('still surfaces a GENUINE code conflict (after dropping bookkeeping)', () => {
		const slug = 'slice-alpha';
		const {repo, branch} = seedInProgress('alpha');

		// Branch: wip edits shared.txt one way + a bookkeeping route-NA move.
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(slice-alpha): edits shared'], repo);
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'needs-attention',
			`chore(${slug}): route to needs-attention; gate failed`,
		);

		// Main edits the SAME file differently — a real CODE conflict.
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main edits shared'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', branch], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			slug,
			gitEnv(),
		);
		expect(result.kind).toBe('conflict');
		// The rebase was aborted (no rebase-in-progress dir), HEAD is clean on branch.
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			branch,
		);
	});

	it('NEVER drops a completed-state `→done` move (atomicity invariant)', () => {
		const slug = 'slice-alpha';
		const {repo, branch} = seedInProgress('alpha');

		// Branch: wip code + a `→done` lifecycle move (the slug landed done with
		// its code) + a later spurious `route to needs-attention` bookkeeping move.
		writeFileSync(join(repo, 'feature.txt'), 'agent feature\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `feat(${slug}): agent feature`], repo);
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'done',
			`feat(${slug}): agent feature; done`,
		);
		moveLedger(
			repo,
			'alpha',
			'done',
			'needs-attention',
			`chore(${slug}): route to needs-attention; post-done re-route`,
		);

		// Main: tree-lessly moves the ledger needs-attention→backlog→in-progress
		// (requeue+claim) so the route-NA on the branch would conflict.
		gitIn(['switch', '-q', 'main'], repo);
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'needs-attention',
			`chore(${slug}): route to needs-attention; surfaced`,
		);
		moveLedger(repo, 'alpha', 'needs-attention', 'backlog', `requeue(${slug})`);
		moveLedger(repo, 'alpha', 'backlog', 'in-progress', `claim(${slug})`);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', branch], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			slug,
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// The `→done` move SURVIVED: the slug's `.md` lands in `work/done/` with
		// the code, atomically (the artifact the done-move asserts).
		expect(existsSync(join(repo, 'work', 'done', 'alpha.md'))).toBe(true);
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
		expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe(
			'agent feature\n',
		);
		// And the `route to needs-attention` commits are gone; the `feat … done` is not.
		const subjects = gitIn(['log', '--format=%s', `arbiter/main..HEAD`], repo);
		expect(subjects).not.toMatch(/route to needs-attention/);
		expect(subjects).toMatch(new RegExp(`feat\\(${slug}\\).*done`));
	});

	it('drops INTERLEAVED bookkeeping commits, preserving every wip / `→done` in order', () => {
		const slug = 'slice-alpha';
		const {repo, branch} = seedInProgress('alpha');

		// Branch shape (matches the real live shape: route-NA bodies don't move the
		// `.md` between wips — only the first surface does the actual mv; subsequent
		// route-NA commits just re-stamp the reason body in place):
		//   wip-1 (a.txt) → route-NA → wip-2 (b.txt) → route-NA (body re-stamp)
		//                                                 → done-move (→done)
		writeFileSync(join(repo, 'a.txt'), 'wip-1\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(slice-alpha): step 1'], repo);
		moveLedger(
			repo,
			'alpha',
			'in-progress',
			'needs-attention',
			`chore(${slug}): route to needs-attention; first surface`,
		);
		writeFileSync(join(repo, 'b.txt'), 'wip-2\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip(slice-alpha): step 2'], repo);
		// A second route-NA that just edits the .md body in place (the re-route
		// pattern observed live), NOT a second mv. Subject still matches the anchor.
		writeFileSync(
			join(repo, 'work', 'needs-attention', 'alpha.md'),
			'slug: alpha\nupdated reason\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(
			[
				'commit',
				'-q',
				'-m',
				`chore(${slug}): route to needs-attention; second surface`,
			],
			repo,
		);

		// Main: tree-lessly progress to in-progress (so the slug `.md` survives on main).
		gitIn(['switch', '-q', 'main'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);

		gitIn(['switch', '-q', branch], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			slug,
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
		// Every wip file is present in the final tree (a.txt + b.txt).
		expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('wip-1\n');
		expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('wip-2\n');
		// Subjects: NO route-NA, BOTH wip commits remain in order.
		const subjects = gitIn(
			['log', '--format=%s', '--reverse', `arbiter/main..HEAD`],
			repo,
		)
			.split('\n')
			.filter((l) => l.trim() !== '');
		expect(subjects.some((s) => /route to needs-attention/.test(s))).toBe(
			false,
		);
		const wipIdx1 = subjects.findIndex((s) => /step 1/.test(s));
		const wipIdx2 = subjects.findIndex((s) => /step 2/.test(s));
		expect(wipIdx1).toBeGreaterThanOrEqual(0);
		expect(wipIdx2).toBeGreaterThan(wipIdx1);
	});

	it('degrades to a plain rebase when slug is empty (back-compat for non-slice callers)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-alpha', 'arbiter/main'], repo);
		writeFileSync(join(repo, 'feature.txt'), 'f\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'wip'], repo);
		gitIn(['switch', '-q', 'main'], repo);
		writeFileSync(join(repo, 'unrelated.txt'), 'u\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'main moved'], repo);
		gitIn(['push', '-q', 'arbiter', 'main:main'], repo);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', 'work/slice-alpha'], repo);
		const result = rebaseContinuedBranchOntoMain(
			repo,
			'arbiter/main',
			'',
			gitEnv(),
		);
		expect(result.kind).toBe('clean');
	});
});

/**
 * Build the job-worktree topology of `createJob`'s CONTINUE path: an arbiter
 * holding `work/slice-<slug>` ahead of `main`, a BARE mirror cloned from it, and
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
	const branch = `work/slice-${slug}`;
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
			slug: 'happy',
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
			slug: 'happy',
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
			slug: 'happy',
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
				slug: 'happy',
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
				slug: 'happy',
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
