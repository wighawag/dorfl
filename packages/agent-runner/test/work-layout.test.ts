import {describe, it, expect} from 'vitest';
import {join} from 'node:path';
import {
	WORK_ROOT,
	WORK_FOLDER_NAME,
	workFolderName,
	workFolderPath,
	workItemPath,
	workFolderRel,
	workItemRel,
	workFolderPrefix,
	stripWorkFolderPrefix,
	isWorkItemFile,
	SLICE_RESOLUTION_FOLDERS,
	SLICE_LIFECYCLE_FOLDERS,
	LEDGER_STATUS_FOLDERS,
	PRD_FOLDERS,
} from '../src/work-layout.js';

describe('work-layout — the single source of every work/ path + folder union', () => {
	it('folder NAMES are byte-identical to today (no rename in Phase 0)', () => {
		// This is the de-risking checkpoint's invariant: the values must be EXACTLY
		// the live names. A later rename slice flips these and ONLY these.
		expect(WORK_ROOT).toBe('work');
		expect(WORK_FOLDER_NAME).toEqual({
			'pre-backlog': 'pre-backlog',
			backlog: 'backlog',
			'in-progress': 'in-progress',
			'needs-attention': 'needs-attention',
			done: 'done',
			dropped: 'dropped',
			'pre-prd': 'pre-prd',
			prd: 'prd',
			'prd-sliced': 'prd-sliced',
			observations: 'observations',
			ideas: 'ideas',
			findings: 'findings',
			questions: 'questions',
			protocol: 'protocol',
		});
	});

	it('workFolderName resolves a symbolic key to its on-disk name', () => {
		expect(workFolderName('backlog')).toBe('backlog');
		expect(workFolderName('prd-sliced')).toBe('prd-sliced');
	});

	it('workFolderPath builds <root>/work/<folder>', () => {
		expect(workFolderPath('/repo', 'backlog')).toBe(
			join('/repo', 'work', 'backlog'),
		);
		expect(workFolderPath('/repo', 'prd')).toBe(join('/repo', 'work', 'prd'));
	});

	it('workItemPath builds <root>/work/<folder>/<slug>.md (appends .md)', () => {
		expect(workItemPath('/repo', 'done', 'my-slug')).toBe(
			join('/repo', 'work', 'done', 'my-slug.md'),
		);
	});

	it('workFolderRel / workItemRel build the repo-relative forms', () => {
		expect(workFolderRel('pre-backlog')).toBe('work/pre-backlog');
		expect(workItemRel('needs-attention', 'foo.md')).toBe(
			'work/needs-attention/foo.md',
		);
	});

	it('workFolderPrefix carries a trailing slash', () => {
		expect(workFolderPrefix('pre-backlog')).toBe('work/pre-backlog/');
		expect(workFolderPrefix('observations')).toBe('work/observations/');
	});

	it('stripWorkFolderPrefix recovers the filename under a folder', () => {
		expect(
			stripWorkFolderPrefix('work/pre-backlog/some-slice.md', 'pre-backlog'),
		).toBe('some-slice.md');
		// Equivalent to the hand-written `path.slice('work/pre-backlog/'.length)`.
		const path = 'work/pre-backlog/some-slice.md';
		expect(stripWorkFolderPrefix(path, 'pre-backlog')).toBe(
			path.slice('work/pre-backlog/'.length),
		);
	});

	it('stripWorkFolderPrefix returns undefined when the path is not under the folder', () => {
		expect(stripWorkFolderPrefix('work/backlog/x.md', 'pre-backlog')).toBe(
			undefined,
		);
		expect(stripWorkFolderPrefix('src/foo.ts', 'backlog')).toBe(undefined);
	});

	it('isWorkItemFile is the single item-scan predicate (case-insensitive .md)', () => {
		expect(isWorkItemFile('foo.md')).toBe(true);
		expect(isWorkItemFile('FOO.MD')).toBe(true);
		expect(isWorkItemFile('foo.txt')).toBe(false);
		expect(isWorkItemFile('foo')).toBe(false);
	});

	it('the folder unions/arrays match their original scattered definitions', () => {
		expect([...SLICE_RESOLUTION_FOLDERS]).toEqual([
			'in-progress',
			'backlog',
			'done',
		]);
		expect([...SLICE_LIFECYCLE_FOLDERS]).toEqual([
			'backlog',
			'in-progress',
			'needs-attention',
			'done',
		]);
		expect([...LEDGER_STATUS_FOLDERS]).toEqual(['backlog', 'done', 'dropped']);
		expect([...PRD_FOLDERS]).toEqual(['prd', 'prd-sliced']);
	});
});
