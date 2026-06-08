import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {backfillSlicedPrds} from '../src/prd-sliced-migration.js';
import {makeScratch, gitEnv, type Scratch} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * The `prd-sliced/` BACKFILL migration tests (`backfillSlicedPrds`, slice
 * `prd-sliced-folder-step-a` / PRD `slicing-coherence` US #11). House style: a
 * throwaway git repo (the migration uses `git mv`, so the PRD files must be
 * tracked), seeded with a mix of sliced + unsliced PRDs.
 */

let scratch: Scratch;
let repo: string;

beforeEach(() => {
	scratch = makeScratch('agent-runner-prd-sliced-backfill-');
	repo = join(scratch.root, 'repo');
	mkdirSync(repo, {recursive: true});
	run('git', ['init', '-q', '-b', 'main'], repo, {env: gitEnv()});
});
afterEach(() => {
	scratch.cleanup();
});

/** Seed (and commit) a `work/prd/<slug>.md` with optional `sliced:` marker. */
function seedPrd(slug: string, sliced?: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (sliced) lines.push(`sliced: ${sliced}`);
	lines.push('---', '', `# PRD ${slug}`, '');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

function commitAll(message: string): void {
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', message], repo, {env: gitEnv()});
}

const exists = (rel: string): boolean => existsSync(join(repo, rel));
const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8');

describe('backfillSlicedPrds — moves sliced PRDs prd/ -> prd-sliced/', () => {
	it('moves every `sliced:` PRD into prd-sliced/, leaves unsliced PRDs in prd/', async () => {
		seedPrd('auto-slice', '2026-06-04');
		seedPrd('done-prd', '2026-06-01');
		seedPrd('still-to-slice'); // no sliced marker
		commitAll('seed PRDs');

		const result = await backfillSlicedPrds(repo, gitEnv());

		// The two sliced PRDs moved into prd-sliced/ (the source of truth).
		expect(exists('work/prd-sliced/auto-slice.md')).toBe(true);
		expect(exists('work/prd-sliced/done-prd.md')).toBe(true);
		expect(exists('work/prd/auto-slice.md')).toBe(false);
		expect(exists('work/prd/done-prd.md')).toBe(false);
		// The unsliced PRD stays in prd/ (still to-slice).
		expect(exists('work/prd/still-to-slice.md')).toBe(true);
		expect(exists('work/prd-sliced/still-to-slice.md')).toBe(false);

		// The result names the moves (sorted by slug).
		expect(result.moved.map((m) => m.slug)).toEqual(['auto-slice', 'done-prd']);
		expect(result.moved[0]).toMatchObject({
			slug: 'auto-slice',
			from: 'work/prd/auto-slice.md',
			to: 'work/prd-sliced/auto-slice.md',
		});
	});

	it('lands `auto-slice` in prd-sliced/ (the acceptance-criterion assertion)', async () => {
		seedPrd('auto-slice', '2026-06-04');
		commitAll('seed auto-slice');

		await backfillSlicedPrds(repo, gitEnv());

		expect(exists('work/prd-sliced/auto-slice.md')).toBe(true);
		expect(exists('work/prd/auto-slice.md')).toBe(false);
	});

	it('KEEPS the `sliced:` derived copy on the moved file (Step A, not Step B)', async () => {
		seedPrd('auto-slice', '2026-06-04');
		commitAll('seed auto-slice');

		await backfillSlicedPrds(repo, gitEnv());

		// The marker is retained on the resting PRD (a derived copy in Step A; its
		// removal is the separate remove-sliced-marker-step-b slice).
		expect(read('work/prd-sliced/auto-slice.md')).toMatch(/sliced: 2026-06-04/);
	});

	it('records the move as a `git mv` rename (staged in the index)', async () => {
		seedPrd('auto-slice', '2026-06-04');
		commitAll('seed auto-slice');

		await backfillSlicedPrds(repo, gitEnv());

		// The move is staged (git mv adds it) and git sees it as a rename.
		const status = run('git', ['status', '--porcelain'], repo, {
			env: gitEnv(),
		}).stdout;
		expect(status).toMatch(/^R/m);
		expect(status).toMatch(/work\/prd-sliced\/auto-slice\.md/);
	});

	it('is idempotent: a second run is a no-op (does not clobber prd-sliced/)', async () => {
		seedPrd('auto-slice', '2026-06-04');
		commitAll('seed auto-slice');

		const first = await backfillSlicedPrds(repo, gitEnv());
		expect(first.moved).toHaveLength(1);
		commitAll('backfill');

		const second = await backfillSlicedPrds(repo, gitEnv());
		expect(second.moved).toEqual([]);
		expect(exists('work/prd-sliced/auto-slice.md')).toBe(true);
	});

	it('an absent work/prd folder is an empty no-op', async () => {
		const result = await backfillSlicedPrds(repo, gitEnv());
		expect(result.moved).toEqual([]);
	});
});
