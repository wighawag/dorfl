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
	it('folder VALUES reflect the brief-regime rename + per-regime terminals (Phase 1)', () => {
		// The brief-regime-rename slice flips the BRIEF lifecycle values
		// (`pre-prd`-key -> `briefs/proposed`, `prd`-key -> `briefs/ready`,
		// `prd-sliced`-key -> `briefs/tasked`) and splits the previously-shared
		// top-level `work/dropped/` into PER-REGIME won't-proceed terminals: the slice
		// regime's `cancelled` key -> `tasks/cancelled`, the brief regime's
		// `briefs-dropped` key -> `briefs/dropped`. The generic `dropped` key is GONE
		// (no reader resolves a bare-slug `work/dropped/` path anymore). The SYMBOLIC
		// KEYS for the brief lifecycle are deliberately unchanged (the key-name
		// vocabulary cutover is a sibling slice), so no call site moves. The task-board
		// keys (`pre-backlog`/`backlog`/`done`), `questions`/`protocol`, and the
		// lock-ref-state keys (`in-progress`/`needs-attention`) are unchanged here.
		expect(WORK_ROOT).toBe('work');
		expect(WORK_FOLDER_NAME).toEqual({
			'pre-backlog': 'tasks/backlog',
			backlog: 'tasks/todo',
			'in-progress': 'in-progress',
			'needs-attention': 'needs-attention',
			done: 'tasks/done',
			cancelled: 'tasks/cancelled',
			'pre-prd': 'briefs/proposed',
			prd: 'briefs/ready',
			'prd-sliced': 'briefs/tasked',
			'briefs-dropped': 'briefs/dropped',
			observations: 'notes/observations',
			ideas: 'notes/ideas',
			findings: 'notes/findings',
			questions: 'questions',
			protocol: 'protocol',
		});
	});

	it('the brief regime resolves to staging / pool / resting, and the terminals are per-regime', () => {
		// The brief lifecycle: proposed (staging) -> ready (pool) -> tasked (resting).
		expect(workFolderName('pre-prd')).toBe('briefs/proposed');
		expect(workFolderName('prd')).toBe('briefs/ready');
		expect(workFolderName('prd-sliced')).toBe('briefs/tasked');
		// The two PER-REGIME won't-proceed terminals (the slug-collision fix): a
		// dropped task and a dropped brief sharing a slug resolve to DIFFERENT paths.
		expect(workFolderName('cancelled')).toBe('tasks/cancelled');
		expect(workFolderName('briefs-dropped')).toBe('briefs/dropped');
	});

	it('workFolderName resolves a symbolic key to its on-disk name', () => {
		expect(workFolderName('backlog')).toBe('tasks/todo');
		expect(workFolderName('prd-sliced')).toBe('briefs/tasked');
	});

	it('workFolderPath builds <root>/work/<folder>', () => {
		expect(workFolderPath('/repo', 'backlog')).toBe(
			join('/repo', 'work', 'tasks', 'todo'),
		);
		expect(workFolderPath('/repo', 'prd')).toBe(
			join('/repo', 'work', 'briefs', 'ready'),
		);
	});

	it('workItemPath builds <root>/work/<folder>/<slug>.md (appends .md)', () => {
		expect(workItemPath('/repo', 'done', 'my-slug')).toBe(
			join('/repo', 'work', 'tasks', 'done', 'my-slug.md'),
		);
	});

	it('workFolderRel / workItemRel build the repo-relative forms', () => {
		expect(workFolderRel('pre-backlog')).toBe('work/tasks/backlog');
		expect(workItemRel('needs-attention', 'foo.md')).toBe(
			'work/needs-attention/foo.md',
		);
	});

	it('workFolderPrefix carries a trailing slash', () => {
		expect(workFolderPrefix('pre-backlog')).toBe('work/tasks/backlog/');
		expect(workFolderPrefix('observations')).toBe('work/notes/observations/');
	});

	it('stripWorkFolderPrefix recovers the filename under a folder', () => {
		expect(
			stripWorkFolderPrefix('work/tasks/backlog/some-slice.md', 'pre-backlog'),
		).toBe('some-slice.md');
		// Equivalent to the hand-written `path.slice('work/tasks/backlog/'.length)`.
		const path = 'work/tasks/backlog/some-slice.md';
		expect(stripWorkFolderPrefix(path, 'pre-backlog')).toBe(
			path.slice('work/tasks/backlog/'.length),
		);
	});

	it('stripWorkFolderPrefix returns undefined when the path is not under the folder', () => {
		expect(stripWorkFolderPrefix('work/tasks/todo/x.md', 'pre-backlog')).toBe(
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
		expect([...LEDGER_STATUS_FOLDERS]).toEqual([
			'backlog',
			'done',
			'cancelled',
		]);
		expect([...PRD_FOLDERS]).toEqual(['prd', 'prd-sliced']);
	});
});
