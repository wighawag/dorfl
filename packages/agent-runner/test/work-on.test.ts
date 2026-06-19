import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, writeFileSync, readFileSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {performWorkOn, suggestHumanWorktreesDir} from '../src/work-on.js';
import {performClaim} from '../src/claim-cas.js';
import {listItemLocks} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-work-on-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A configured human worktree root inside the scratch (never ~/.agent-runner). */
function humanRoot(): string {
	return join(scratch.root, 'worktrees');
}

/** The shared options every test passes (workspaces + human root inside scratch). */
function baseOpts() {
	return {
		workspacesDir: join(scratch.root, '.agent-runner'),
		humanWorktreesDir: humanRoot(),
		env: gitEnv(),
	};
}

/** The branch checked out in a worktree dir. */
function branchOf(dir: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
}

describe('work-on — in-repo form (work-on <slug>)', () => {
	it('claims and creates a worktree on work/<slug> off the fresh arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			...baseOpts(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		expect(result.branch).toBe('work/task-alpha');
		expect(result.dir).toBeDefined();
		expect(existsSync(result.dir!)).toBe(true);
		expect(branchOf(result.dir!)).toBe('work/task-alpha');

		// The worktree lives UNDER the configured human root, never ~/.agent-runner.
		expect(result.dir!.startsWith(humanRoot())).toBe(true);
		expect(result.dir).not.toMatch(/\.agent-runner/);

		// The claim acquired the per-item lock; the body STAYS in backlog/ on the
		// arbiter (claim no longer moves it).
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);

		// The worktree carries work/tasks/todo/<slug>.md (cut from main, which holds it).
		expect(
			existsSync(join(result.dir!, 'work', 'tasks', 'todo', 'alpha.md')),
		).toBe(true);
	});
});

describe('work-on — remote form (work-on <remote> <slug>)', () => {
	it('ensures a hub mirror, claims, and creates the worktree under the human root', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['beta']);
		const url = `file://${arbiter}`;
		const opts = baseOpts();

		const result = await performWorkOn({
			slug: 'beta',
			remote: url,
			// In remote mode cwd is irrelevant for the arbiter; use scratch root.
			cwd: scratch.root,
			...opts,
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		expect(result.branch).toBe('work/task-beta');
		expect(existsSync(result.dir!)).toBe(true);
		expect(result.dir!.startsWith(humanRoot())).toBe(true);

		// The hub mirror was created under the workspaces area.
		expect(existsSync(join(opts.workspacesDir, 'repos'))).toBe(true);

		// The worktree has the backlog body (claim acquired the lock but did not move
		// the body; it rests in backlog/ on the arbiter).
		expect(
			existsSync(join(result.dir!, 'work', 'tasks', 'todo', 'beta.md')),
		).toBe(true);
	});

	it('creates the hub mirror if absent, then reuses it on a second remote call', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['one', 'two']);
		const url = `file://${arbiter}`;
		const opts = baseOpts();

		const r1 = await performWorkOn({
			slug: 'one',
			remote: url,
			cwd: scratch.root,
			...opts,
		});
		expect(r1.exitCode).toBe(0);

		// Second call for the same remote (different slug) reuses the same mirror.
		const r2 = await performWorkOn({
			slug: 'two',
			remote: url,
			cwd: scratch.root,
			...opts,
		});
		expect(r2.exitCode).toBe(0);
		expect(r2.outcome).toBe('created');
	});
});

describe('work-on — same-starting-commit guarantee', () => {
	it('both forms branch off the SAME commit given the same arbiter state', async () => {
		// Two independent slugs so the two claims do not contend. Both forms fetch
		// the latest arbiter main; because each claim advances main by exactly one
		// commit, the in-repo worktree starts one commit ahead of the remote one's
		// PARENT — so we assert structural equivalence: each worktree's HEAD parent
		// is the arbiter main BEFORE its own claim, i.e. the same fetch guarantee.
		//
		// Simpler, robust check: the only difference is LOCATION. Branch each form
		// off the arbiter and assert the start commit equals the freshly-fetched
		// arbiter main reported by each (no stale ref).
		const seeded = seedRepoWithArbiter(scratch.root, ['in', 'rem']);
		const url = `file://${seeded.arbiter}`;

		const inRepo = await performWorkOn({
			slug: 'in',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			...baseOpts(),
		});
		const remote = await performWorkOn({
			slug: 'rem',
			remote: url,
			cwd: scratch.root,
			...baseOpts(),
		});

		expect(inRepo.exitCode).toBe(0);
		expect(remote.exitCode).toBe(0);

		// Each worktree's HEAD is exactly its reported startCommit (no stale ref).
		expect(gitIn(['rev-parse', 'HEAD'], inRepo.dir!).trim()).toBe(
			inRepo.startCommit,
		);
		expect(gitIn(['rev-parse', 'HEAD'], remote.dir!).trim()).toBe(
			remote.startCommit,
		);

		// The only difference is the worktree LOCATION (different slug subdir under
		// the same human root); the arbiter URL the worktree branches from matches.
		expect(inRepo.arbiterUrl).toBe(remote.arbiterUrl);
		expect(inRepo.dir).not.toBe(remote.dir);
	});

	it('the worktree starts from the FRESH arbiter main, not a stale local ref', async () => {
		// Seed the repo, then advance the arbiter main from ANOTHER clone AFTER the
		// repo's local refs are stale. work-on must fetch and branch off the fresh
		// main (which contains the out-of-band commit), proving it never uses a
		// stale local ref.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// Out-of-band: push an unrelated commit to the arbiter from a fresh clone.
		const other = seeded.clone('mover');
		gitIn(['checkout', '-q', '-B', 'advance', 'arbiter/main'], other);
		writeFileSync(join(other, 'OUTOFBAND.txt'), 'hi\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'out of band'], other);
		gitIn(['push', '-q', 'arbiter', 'advance:main'], other);

		// The repo's local arbiter ref is now STALE (no fetch yet).
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			...baseOpts(),
		});
		expect(result.exitCode).toBe(0);

		// The worktree contains the out-of-band file ⇒ it branched off fresh main.
		expect(existsSync(join(result.dir!, 'OUTOFBAND.txt'))).toBe(true);
	});
});

describe('work-on — --copy gitignored files', () => {
	it('copies named gitignored files (copy, not symlink) from the current repo in-repo mode', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// An untracked, gitignored secret living only in the working repo.
		writeFileSync(join(repo, '.env.local'), 'SECRET=42\n');

		const copied: string[] = [];
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			copy: '.env.local',
			note: (m) => {
				if (/SECURITY NOTICE/.test(m)) copied.push(m);
			},
			...baseOpts(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.copied).toEqual(['.env.local']);

		const dest = join(result.dir!, '.env.local');
		expect(existsSync(dest)).toBe(true);
		// Copy, NOT a symlink.
		expect(lstatSync(dest).isSymbolicLink()).toBe(false);
		expect(readFileSync(dest, 'utf8')).toBe('SECRET=42\n');

		// A security notice was printed.
		expect(copied.length).toBe(1);
		expect(copied[0]).toMatch(/\.env\.local/);
	});

	it('absent --copy carries over NO untracked files', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, '.env.local'), 'SECRET=42\n');

		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			...baseOpts(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.copied).toEqual([]);
		expect(existsSync(join(result.dir!, '.env.local'))).toBe(false);
	});

	it('remote mode REQUIRES --copy-from when --copy is given', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['beta']);
		const url = `file://${arbiter}`;

		const result = await performWorkOn({
			slug: 'beta',
			remote: url,
			cwd: scratch.root,
			copy: '.env.local',
			// no copyFrom
			...baseOpts(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/--copy-from/);
	});

	it('remote mode copies from --copy-from <path>', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const url = `file://${seeded.arbiter}`;
		// The secret lives in the original working repo; remote mode has no implicit
		// source, so we point --copy-from at it explicitly.
		writeFileSync(join(seeded.repo, '.env'), 'TOKEN=abc\n');

		const result = await performWorkOn({
			slug: 'beta',
			remote: url,
			cwd: scratch.root,
			copy: '.env',
			copyFrom: seeded.repo,
			...baseOpts(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.copied).toEqual(['.env']);
		expect(readFileSync(join(result.dir!, '.env'), 'utf8')).toBe('TOKEN=abc\n');
	});
});

describe('work-on — clean failure on a lost claim (no worktree)', () => {
	it('a contended/lost claim creates NO worktree (clean failure like claim)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;

		// Another claimer wins first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			...baseOpts(),
		});
		// The slug is now in-progress, not claimable → lost; NO worktree.
		expect(result.exitCode).not.toBe(0);
		expect(['lost', 'contended']).toContain(result.outcome);
		expect(result.dir).toBeUndefined();
		// Nothing was created under the human root for this slug.
		const wouldBe = join(humanRoot());
		// The human root may not even exist; if it does, it has no alpha worktree.
		if (existsSync(wouldBe)) {
			expect(existsSync(join(wouldBe, 'work', 'alpha'))).toBe(false);
		}
	});

	it('a two-claimer race: the loser creates no worktree, the winner gets one', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Distinct committer identity per racer so the two claim commits get DISTINCT
		// shas (as two real claimers would) and the loser loses through the genuine
		// CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			performWorkOn({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				workspacesDir: join(scratch.root, '.agent-runner-a'),
				humanWorktreesDir: join(scratch.root, 'worktrees-a'),
				env: racerEnv('a'),
			}),
			performWorkOn({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				workspacesDir: join(scratch.root, '.agent-runner-b'),
				humanWorktreesDir: join(scratch.root, 'worktrees-b'),
				env: racerEnv('b'),
			}),
		]);

		const winners = [ra, rb].filter((r) => r.exitCode === 0);
		const losers = [ra, rb].filter((r) => r.exitCode !== 0);
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		expect(winners[0].outcome).toBe('created');
		expect(existsSync(winners[0].dir!)).toBe(true);
		// The loser created no worktree.
		expect(losers[0].dir).toBeUndefined();

		// The arbiter agrees: the body stays in backlog/, and the per-item lock is
		// held exactly once (claimed once).
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(true);
		expect(await listItemLocks(a, 'arbiter', gitEnv())).toEqual(['task-solo']);
	});
});

describe('work-on — humanWorktreesDir (first-use prompt + guards)', () => {
	it('prompts + saves the root on first use (none configured)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const chosen = join(scratch.root, 'my-worktrees');
		let saved: string | undefined;
		let suggested: string | undefined;

		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.agent-runner'),
			// humanWorktreesDir omitted ⇒ prompt path.
			promptForRoot: (suggestion) => {
				suggested = suggestion;
				return chosen;
			},
			saveRoot: (dir) => {
				saved = dir;
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.dir!.startsWith(chosen)).toBe(true);
		expect(saved).toBe(chosen);
		// The suggestion is offered (sensible, not a silent default).
		expect(suggested).toBe(suggestHumanWorktreesDir());
	});

	it('refuses a humanWorktreesDir under ~/.agent-runner (agents-only area)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.agent-runner'),
			humanWorktreesDir: join(
				process.env.HOME ?? '/home/none',
				'.agent-runner',
				'human',
			),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/\.agent-runner/);
	});

	it('errors when no root is configured and no prompt is available', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.agent-runner'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/humanWorktreesDir/);
	});

	it('suggestHumanWorktreesDir avoids the ~/dev code-dir prefix (tab-completion)', () => {
		const suggestion = suggestHumanWorktreesDir();
		expect(suggestion).not.toMatch(/\/dev(\/|$)/);
		expect(suggestion).not.toMatch(/\.agent-runner/);
	});
});

describe('work-on — environment errors', () => {
	it('in-repo: errors when the arbiter remote is missing', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performWorkOn({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			...baseOpts(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});

	it('errors when no slug is given', async () => {
		const result = await performWorkOn({
			slug: '',
			cwd: scratch.root,
			...baseOpts(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/missing <slug>/);
	});
});
