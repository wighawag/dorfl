import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git} from '../src/git.js';
import {sweepOrphanSidecars} from '../src/orphan-sidecar.js';
import {sidecarPathFor} from '../src/sidecar.js';
import {makeScratch, gitEnv, type Scratch} from './helpers/gitRepo.js';

/**
 * The orphan-sidecar sweep (prd
 * `agentic-question-resolution-retire-disposition-vocabulary`, US #10): reaps a
 * `work/questions/<type>-<slug>.md` whose source item is GONE (deleted out-of-band),
 * leaving sidecars whose source still exists. It is the WORKING-TREE counterpart of
 * the worktree/remote-branch reapers, folded into `dorfl gc`.
 *
 * Every test ISOLATES its work in a throwaway repo under a scratch root and asserts
 * NO shared/global location is touched (gitEnv pins GIT_CONFIG_GLOBAL/SYSTEM to
 * /dev/null, so the only thing any git invocation can see is the repo-local config).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-orphan-sidecar-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A throwaway repo with one initial commit, returns its path. */
function seedRepo(): string {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	git(['init', '-q', '-b', 'main'], repo, {env: gitEnv()});
	writeFileSync(join(repo, 'README.md'), '# project\n');
	git(['add', '-A'], repo, {env: gitEnv()});
	git(['commit', '-q', '-m', 'seed'], repo, {env: gitEnv()});
	return repo;
}

/** Write + commit a sidecar for `item` (`<namespace>:<slug>`). Returns its repo-rel path. */
function commitSidecar(repo: string, item: string): string {
	const rel = sidecarPathFor(item);
	const abs = join(repo, rel);
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, `# sidecar for ${item}\n`);
	git(['add', '-A'], repo, {env: gitEnv()});
	git(['commit', '-q', '-m', `sidecar ${item}`], repo, {env: gitEnv()});
	return rel;
}

/** Write + commit a source item under `work/<folder>/<slug>.md`. */
function commitSource(repo: string, folder: string, slug: string): void {
	const dir = join(repo, 'work', ...folder.split('/'));
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `# ${slug}\n`);
	git(['add', '-A'], repo, {env: gitEnv()});
	git(['commit', '-q', '-m', `source ${folder}/${slug}`], repo, {
		env: gitEnv(),
	});
}

describe('sweepOrphanSidecars — reap a sidecar whose source is gone, keep the live one', () => {
	it('reaps an ORPHAN (source absent) via git rm and reports it', () => {
		const repo = seedRepo();
		const rel = commitSidecar(repo, 'observation:gone');

		const result = sweepOrphanSidecars({cwd: repo, env: gitEnv()});

		expect(result.reaped.map((r) => r.item)).toEqual(['observation:gone']);
		expect(result.reaped[0].path).toBe(rel);
		expect(result.retained).toEqual([]);
		// The sidecar file is removed from the working tree.
		expect(existsSync(join(repo, rel))).toBe(false);
		// And it is a git DELETION (staged rm), not an untracked delete.
		const status = git(['status', '--porcelain'], repo, {env: gitEnv()});
		expect(status).toMatch(
			new RegExp(`^D\\s+${rel.replace(/\//g, '\\/')}`, 'm'),
		);
	});

	it('LEAVES a sidecar whose source item EXISTS untouched', () => {
		const repo = seedRepo();
		commitSource(repo, 'tasks/ready', 'live');
		const rel = commitSidecar(repo, 'task:live');

		const result = sweepOrphanSidecars({cwd: repo, env: gitEnv()});

		expect(result.reaped).toEqual([]);
		expect(result.retained.map((r) => r.item)).toEqual(['task:live']);
		expect(result.retained[0].sourcePath).toBe('work/tasks/ready/live.md');
		expect(existsSync(join(repo, rel))).toBe(true);
		// Clean tree: nothing staged or removed.
		expect(git(['status', '--porcelain'], repo, {env: gitEnv()}).trim()).toBe(
			'',
		);
	});

	it('reaps ONLY the orphans in a mixed set (live ones survive)', () => {
		const repo = seedRepo();
		// live: source present across DIFFERENT lifecycle folders
		commitSource(repo, 'tasks/ready', 'task-live');
		commitSource(repo, 'specs/proposed', 'prd-live');
		commitSource(repo, 'notes/observations', 'obs-live');
		commitSidecar(repo, 'task:task-live');
		commitSidecar(repo, 'prd:prd-live');
		commitSidecar(repo, 'observation:obs-live');
		// orphans: no source anywhere
		const orphanA = commitSidecar(repo, 'observation:obs-gone');
		const orphanB = commitSidecar(repo, 'task:task-gone');

		const result = sweepOrphanSidecars({cwd: repo, env: gitEnv()});

		expect(new Set(result.reaped.map((r) => r.item))).toEqual(
			new Set(['observation:obs-gone', 'task:task-gone']),
		);
		expect(new Set(result.retained.map((r) => r.item))).toEqual(
			new Set(['task:task-live', 'prd:prd-live', 'observation:obs-live']),
		);
		expect(existsSync(join(repo, orphanA))).toBe(false);
		expect(existsSync(join(repo, orphanB))).toBe(false);
	});

	it('treats a slug that contains hyphens correctly (identity round-trip)', () => {
		const repo = seedRepo();
		commitSource(repo, 'tasks/ready', 'multi-word-slug');
		const live = commitSidecar(repo, 'task:multi-word-slug');
		const orphan = commitSidecar(repo, 'observation:another-multi-hyphen');

		const result = sweepOrphanSidecars({cwd: repo, env: gitEnv()});

		expect(result.reaped.map((r) => r.item)).toEqual([
			'observation:another-multi-hyphen',
		]);
		expect(result.retained.map((r) => r.item)).toEqual([
			'task:multi-word-slug',
		]);
		expect(existsSync(join(repo, live))).toBe(true);
		expect(existsSync(join(repo, orphan))).toBe(false);
	});

	it('dry-run REPORTS the orphan but removes nothing', () => {
		const repo = seedRepo();
		const rel = commitSidecar(repo, 'observation:gone');

		const result = sweepOrphanSidecars({
			cwd: repo,
			dryRun: true,
			env: gitEnv(),
		});

		expect(result.wouldReap.map((r) => r.item)).toEqual(['observation:gone']);
		expect(result.reaped).toEqual([]);
		expect(existsSync(join(repo, rel))).toBe(true);
		expect(git(['status', '--porcelain'], repo, {env: gitEnv()}).trim()).toBe(
			'',
		);
	});

	it('is a no-op when there is no work/questions/ dir at all', () => {
		const repo = seedRepo();
		const result = sweepOrphanSidecars({cwd: repo, env: gitEnv()});
		expect(result).toEqual({reaped: [], retained: [], wouldReap: []});
	});

	it('ISOLATES to the throwaway repo — no path outside scratch.root is touched', () => {
		const repo = seedRepo();
		commitSidecar(repo, 'observation:gone');
		sweepOrphanSidecars({cwd: repo, env: gitEnv()});
		// Every effect is confined to the scratch repo: the reaped path is under it,
		// and the repo itself is under scratch.root.
		expect(repo.startsWith(scratch.root)).toBe(true);
	});
});
