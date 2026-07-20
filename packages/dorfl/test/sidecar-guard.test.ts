import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rmrf} from './helpers/gitRepo.js';
import {workFolderName, type WorkFolderKey} from '../src/work-layout.js';
import {
	detectColocatedSidecars,
	formatSidecarGuardReason,
} from '../src/sidecar-guard.js';

/**
 * The co-located task/spec sidecar GUARD (WORK-CONTRACT.md rule 8, the
 * `notes/*`-only scoping) — the DETECTOR half. A `<slug>/` asset sidecar beside a
 * FLOWING task/spec item is FORBIDDEN (it strands on the `ready → done` /
 * `ready → tasked` `git mv`); a `notes/*` sidecar (notes do not flow) and the
 * tooling-owned `work/questions/*` status-mechanism file are ALLOWED / not scanned.
 */

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-sidecar-guard-'));
});

afterEach(() => {
	rmrf(root);
});

/** Write `work/<folder>/<slug>.md` (a minimal item body). */
function placeItem(folder: WorkFolderKey, slug: string): void {
	const dir = join(root, 'work', workFolderName(folder));
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\n---\n\nbody`);
}

/** Create a co-located `<slug>/` sidecar folder holding one asset file. */
function placeSidecar(
	folder: WorkFolderKey,
	slug: string,
	asset: string,
): void {
	const dir = join(root, 'work', workFolderName(folder), slug);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, asset), 'asset contents');
}

describe('detectColocatedSidecars — flags a FLOWING task/spec sidecar', () => {
	it('flags a task in tasks/ready with a co-located <slug>/ sidecar', () => {
		placeItem('tasks-ready', 'my-task');
		placeSidecar('tasks-ready', 'my-task', 'fix.patch');

		const found = detectColocatedSidecars(root, 'my-task');
		expect(found).toHaveLength(1);
		expect(found[0].slug).toBe('my-task');
		expect(found[0].folder).toBe('tasks-ready');
		expect(found[0].dirRel).toBe('work/tasks/ready/my-task/');
	});

	it('flags a task in tasks/done (terminal is still a flowing folder)', () => {
		placeItem('done', 'landed-task');
		placeSidecar('done', 'landed-task', 'measurement.json');

		const found = detectColocatedSidecars(root, 'landed-task');
		expect(found).toHaveLength(1);
		expect(found[0].folder).toBe('done');
	});

	it('flags a spec in specs/ready with a co-located <slug>/ sidecar', () => {
		placeItem('specs-ready', 'my-spec');
		placeSidecar('specs-ready', 'my-spec', 'build.sh');

		const found = detectColocatedSidecars(root, 'my-spec');
		expect(found).toHaveLength(1);
		expect(found[0].folder).toBe('specs-ready');
		expect(found[0].dirRel).toBe('work/specs/ready/my-spec/');
	});
});

describe('detectColocatedSidecars — does NOT flag the allowed cases', () => {
	it('ALLOWS a note (ideas) with a co-located sidecar — notes do not flow', () => {
		placeItem('ideas', 'my-idea');
		placeSidecar('ideas', 'my-idea', 'fix.patch');

		expect(detectColocatedSidecars(root, 'my-idea')).toEqual([]);
	});

	it('ALLOWS an observation / finding sidecar (notes/* buckets)', () => {
		placeItem('observations', 'spotted');
		placeSidecar('observations', 'spotted', 'trace.txt');
		placeItem('findings', 'external-api');
		placeSidecar('findings', 'external-api', 'capture.json');

		expect(detectColocatedSidecars(root, 'spotted')).toEqual([]);
		expect(detectColocatedSidecars(root, 'external-api')).toEqual([]);
	});

	it('does NOT flag the work/questions/<type>-<slug>.md status-mechanism file', () => {
		// A task exists AND a needs-attention sidecar FILE for it — the questions
		// file is NOT an asset sidecar folder and is not under a flowing folder, so
		// it must never trip the guard.
		placeItem('tasks-ready', 'blocked-task');
		const qdir = join(root, 'work', workFolderName('questions'));
		mkdirSync(qdir, {recursive: true});
		writeFileSync(
			join(qdir, 'task-blocked-task.md'),
			'<!-- dorfl-sidecar: item=task:blocked-task -->\n',
		);

		expect(detectColocatedSidecars(root, 'blocked-task')).toEqual([]);
	});

	it('does NOT flag a docs/spikes/<slug>/ outside work/ (the sanctioned home)', () => {
		placeItem('done', 'landed-task');
		// The DURABLE artifacts live here — the guard must never look outside work/.
		const spikes = join(root, 'docs', 'spikes', 'landed-task');
		mkdirSync(spikes, {recursive: true});
		writeFileSync(join(spikes, 'fix.patch'), 'patch');

		expect(detectColocatedSidecars(root, 'landed-task')).toEqual([]);
	});

	it('does NOT flag a lone <slug>/ directory with no sibling <slug>.md', () => {
		// A stray directory that is not an item's sidecar (no `<slug>.md` beside it).
		placeSidecar('tasks-ready', 'orphan-dir', 'stray.txt');
		expect(detectColocatedSidecars(root, 'orphan-dir')).toEqual([]);
	});

	it('is clean when a flowing item has NO sidecar', () => {
		placeItem('tasks-ready', 'plain-task');
		expect(detectColocatedSidecars(root, 'plain-task')).toEqual([]);
	});
});

describe('formatSidecarGuardReason — actionable relocate message', () => {
	it('names the offending path, docs/spikes/<slug>/, and the fix', () => {
		placeItem('tasks-ready', 'my-task');
		placeSidecar('tasks-ready', 'my-task', 'fix.patch');
		const reason = formatSidecarGuardReason(
			detectColocatedSidecars(root, 'my-task'),
		);
		expect(reason).toContain('docs/spikes/my-task/');
		expect(reason).toContain('work/tasks/ready/my-task/');
		expect(reason).toContain('only notes/* may carry a sidecar');
		expect(reason).toContain('WORK-CONTRACT rule 8');
	});

	it('returns empty string for no offenders', () => {
		expect(formatSidecarGuardReason([])).toBe('');
	});
});
