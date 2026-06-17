import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentLedgerRead} from '../src/ledger-read.js';
import {scanRepoPaths} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {LEDGER_STATUS_FOLDERS} from '../src/ledger-lint.js';

/**
 * Slice `generic-terminal-dropped-folder-generalising-out-of-scope`
 * (PRD `staging-pool-position-gate-and-trust-model`, US #16/17/18).
 *
 * Pool-eligibility BY RESIDENCE: an item resting in `work/dropped/` is OUT of
 * every pool, the SAME way `work/done/` excludes \u2014 there is ONE residence rule
 * (the pool readers enumerate ONLY their pool folders, `backlog/` for slices,
 * `prd/` for PRDs), so a `dropped/` file is invisible to every reader by
 * construction; no reader re-implements the rule.
 *
 * The REASON for dropping (`out-of-scope` / `superseded by <x>` / `duplicate` /
 * `abandoned`) lives in the item BODY, NOT in a frontmatter status field \u2014
 * WORK-CONTRACT rule 3 ("status = the folder"). This file asserts the body
 * `reason:` line is preserved verbatim by the readers (they do not consult or
 * coerce it).
 */

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-dropped-folder-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function writeMd(rel: string, fm: Record<string, string>, body = 'body'): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, '..'), {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(fm)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', body);
	writeFileSync(abs, lines.join('\n'));
}

describe('work/dropped/ — a generic terminal residence excludes from every pool', () => {
	it('is one of the canonical status folders (one residence rule, defined once)', () => {
		expect([...LEDGER_STATUS_FOLDERS]).toContain('dropped');
	});

	it('a PRD resting in work/dropped/ is OUT of the auto-slice PRD pool (by residence, like work/prd-sliced/)', () => {
		// A live PRD in work/prd/ + a SUPERSEDED PRD in work/dropped/. Only the live
		// one is in the pool the auto-slicer enumerates. The dropped PRD must NEVER
		// be auto-sliced.
		writeMd('repo/work/prd/live.md', {slug: 'live'});
		writeMd(
			'repo/work/dropped/superseded.md',
			{slug: 'superseded'},
			'reason: superseded by live\n\nbody',
		);

		const pool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.prds.map((p) => p.slug)).toEqual(['live']);
		expect(pool.slicedSlugs).toEqual(new Set());
	});

	it('a slice resting in work/dropped/ is OUT of the build (scan) pool (by residence, like work/done/)', () => {
		// A live slice in work/backlog/ + a dropped slice in work/dropped/. The scan
		// enumerates only the backlog pool, so the dropped slice never appears.
		writeMd('repo/work/backlog/live.md', {slug: 'live'});
		writeMd(
			'repo/work/dropped/abandoned.md',
			{slug: 'abandoned'},
			'reason: abandoned\n\nbody',
		);

		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
		);
		const slugs = report.repos[0].items.map((i) => i.slug);
		expect(slugs).toEqual(['live']);
		expect(slugs).not.toContain('abandoned');
	});

	it('the `reason:` is preserved in the item BODY (status is the folder; no frontmatter status field is read)', () => {
		// An existing record `migrates cleanly` if folded in: a file with a body
		// `reason:` value (one of the maintainer's vocabulary) is the durable shape
		// the readers tolerate without consulting/coercing it.
		const body = [
			'reason: out-of-scope',
			'',
			'Folded-in record from the previous `work/out-of-scope/` folder.',
		].join('\n');
		writeMd('repo/work/dropped/folded-in.md', {slug: 'folded-in'}, body);

		// Sanity: still excluded from every pool (residence rule), and the body
		// reason text was not coerced into frontmatter.
		const prdPool = currentLedgerRead.resolvePrdPool({
			repoPath: join(root, 'repo'),
		});
		expect(prdPool.prds).toEqual([]);
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
		);
		expect(report.repos[0].items).toEqual([]);
	});

	it('and a slug present BOTH in work/dropped/ and another status folder is a one-slug-one-folder duplicate (the lint covers dropped)', async () => {
		// Cross-residence corruption is still detectable: a slug in `dropped/`
		// AND `backlog/` is a duplicate the lint surfaces (the read-side lint covers
		// the full lifecycle set including the terminal `dropped/`).
		writeMd('repo/work/backlog/both.md', {slug: 'both'});
		writeMd('repo/work/dropped/both.md', {slug: 'both'}, 'reason: duplicate');

		const {lintLocalLedger} = await import('../src/ledger-lint.js');
		const dups = lintLocalLedger(join(root, 'repo'));
		expect(dups.map((d) => d.slug)).toEqual(['both']);
		expect(dups[0].folders).toContain('dropped');
		expect(dups[0].folders).toContain('backlog');
	});
});
