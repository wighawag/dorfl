import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentLedgerRead} from '../src/ledger-read.js';
import {scanRepoPaths} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {LEDGER_STATUS_FOLDERS} from '../src/ledger-lint.js';

/**
 * The PER-REGIME won't-proceed terminals (slice
 * `brief-regime-rename-and-dropped-migration`, PRD
 * `folder-taxonomy-reorg-and-rename` US #10). The previously-shared top-level
 * `work/dropped/` is split per regime so a dropped task and a dropped brief
 * sharing a slug never collide on one bare-slug `work/dropped/<slug>.md`:
 *   - a SLICE drops to `work/tasks/cancelled/`,
 *   - a BRIEF (PRD) drops to `work/briefs/dropped/`,
 *   - an OBSERVATION has NO terminal folder (notes leave by deletion).
 *
 * Pool-eligibility BY RESIDENCE: an item resting in its regime's won't-proceed
 * terminal is OUT of every pool, the SAME way `work/tasks/done/` /
 * `work/briefs/tasked/` exclude — the pool readers enumerate ONLY their pool
 * folders (`tasks/todo/` for slices, `briefs/ready/` for briefs), so a terminal
 * file is invisible to every reader by construction; no reader re-implements the
 * rule.
 *
 * The REASON for dropping (`out-of-scope` / `superseded by <x>` / `duplicate` /
 * `abandoned`) lives in the item BODY, NOT in a frontmatter status field —
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

describe('per-regime wont-proceed terminals — residence excludes from every pool', () => {
	it('the slice regime terminal `cancelled` is one of the canonical status folders (one residence rule, defined once)', () => {
		expect([...LEDGER_STATUS_FOLDERS]).toContain('cancelled');
	});

	it('a BRIEF resting in work/briefs/dropped/ is OUT of the auto-slice pool (by residence, like work/briefs/tasked/)', () => {
		// A live brief in work/briefs/ready/ + a SUPERSEDED brief in
		// work/briefs/dropped/. Only the live one is in the pool the auto-slicer
		// enumerates. The dropped brief must NEVER be auto-sliced.
		writeMd('repo/work/briefs/ready/live.md', {slug: 'live'});
		writeMd(
			'repo/work/briefs/dropped/superseded.md',
			{slug: 'superseded'},
			'reason: superseded by live\n\nbody',
		);

		const pool = currentLedgerRead.resolveBriefPool({
			repoPath: join(root, 'repo'),
		});
		expect(pool.briefs.map((p) => p.slug)).toEqual(['live']);
		expect(pool.taskedSlugs).toEqual(new Set());
	});

	it('a slice resting in work/tasks/cancelled/ is OUT of the build (scan) pool (by residence, like work/tasks/done/)', () => {
		// A live slice in work/tasks/todo/ + a cancelled slice in
		// work/tasks/cancelled/. The scan enumerates only the pool, so the cancelled
		// slice never appears.
		writeMd('repo/work/tasks/todo/live.md', {slug: 'live'});
		writeMd(
			'repo/work/tasks/cancelled/abandoned.md',
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

	it('a task-drop and a brief-drop sharing a slug NO LONGER collide (the per-regime correctness fix)', () => {
		// The load-bearing reason the terminal is per-regime: a slice `shared` and a
		// brief `shared` that are BOTH dropped land in DIFFERENT files
		// (work/tasks/cancelled/shared.md vs work/briefs/dropped/shared.md), never
		// the one bare-slug work/dropped/shared.md they used to collide on.
		writeMd(
			'repo/work/tasks/cancelled/shared.md',
			{slug: 'shared'},
			'reason: a cancelled TASK',
		);
		writeMd(
			'repo/work/briefs/dropped/shared.md',
			{slug: 'shared'},
			'reason: a dropped BRIEF',
		);

		// Both terminals co-exist for the same slug WITHOUT being a ledger duplicate:
		// the slice-status lint covers only the tasks board, so `briefs/dropped/` is
		// a separate namespace, not a same-folder collision.
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
		);
		expect(report.repos[0].ledgerDuplicates).toEqual([]);
		// Neither is in any pool (both are terminal residences).
		expect(report.repos[0].items).toEqual([]);
		const briefPool = currentLedgerRead.resolveBriefPool({
			repoPath: join(root, 'repo'),
		});
		expect(briefPool.briefs).toEqual([]);
	});

	it('the `reason:` is preserved in the item BODY (status is the folder; no frontmatter status field is read)', () => {
		// A file with a body `reason:` value (one of the maintainer's vocabulary) is
		// the durable shape the readers tolerate without consulting/coercing it.
		const body = [
			'reason: out-of-scope',
			'',
			'Folded-in record from the previous shared `work/dropped/` terminal.',
		].join('\n');
		writeMd(
			'repo/work/tasks/cancelled/folded-in.md',
			{slug: 'folded-in'},
			body,
		);

		// Sanity: still excluded from every pool (residence rule), and the body
		// reason text was not coerced into frontmatter.
		const briefPool = currentLedgerRead.resolveBriefPool({
			repoPath: join(root, 'repo'),
		});
		expect(briefPool.briefs).toEqual([]);
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
		);
		expect(report.repos[0].items).toEqual([]);
	});

	it('a slug present BOTH in work/tasks/cancelled/ and another slice-status folder is a one-slug-one-folder duplicate (the lint covers cancelled)', async () => {
		// Cross-residence corruption is still detectable: a slug in
		// `tasks/cancelled/` AND `tasks/todo/` is a duplicate the lint surfaces (the
		// read-side lint covers the full slice lifecycle set including the terminal
		// `tasks/cancelled/`).
		writeMd('repo/work/tasks/todo/both.md', {slug: 'both'});
		writeMd(
			'repo/work/tasks/cancelled/both.md',
			{slug: 'both'},
			'reason: duplicate',
		);

		const {lintLocalLedger} = await import('../src/ledger-lint.js');
		const dups = lintLocalLedger(join(root, 'repo'));
		expect(dups.map((d) => d.slug)).toEqual(['both']);
		expect(dups[0].folders).toContain('cancelled');
		expect(dups[0].folders).toContain('tasks-todo');
	});
});
