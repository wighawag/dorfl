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
	TASK_RESOLUTION_FOLDERS,
	TASK_LIFECYCLE_FOLDERS,
	LEDGER_STATUS_FOLDERS,
	BRIEF_FOLDERS,
} from '../src/work-layout.js';

describe('work-layout — the single source of every work/ path + folder union', () => {
	it('the symbolic KEYS read in the new task/brief vocabulary; the VALUES are unchanged', () => {
		// The key-vocabulary cutover slice
		// (`work-layout-keys-and-folder-union-names-to-new-vocabulary`) flips only the
		// KEYS to the new task/brief words (`pre-backlog` -> `tasks-backlog`,
		// `backlog` -> `tasks-todo`, `pre-prd` -> `briefs-proposed`,
		// `prd` -> `briefs-ready`, `prd-sliced` -> `briefs-tasked`). It is a PURE in-code
		// symbol rename: every VALUE string below is byte-identical to before the slice,
		// so NO on-disk folder moved. The already-clean keys (`done`/`cancelled`/
		// `briefs-dropped`/`questions`/`protocol` and the lock-ref-state keys
		// `in-progress`/`needs-attention`) are unchanged.
		expect(WORK_ROOT).toBe('work');
		expect(WORK_FOLDER_NAME).toEqual({
			'tasks-backlog': 'tasks/backlog',
			'tasks-todo': 'tasks/todo',
			'in-progress': 'in-progress',
			'needs-attention': 'needs-attention',
			done: 'tasks/done',
			cancelled: 'tasks/cancelled',
			'briefs-proposed': 'briefs/proposed',
			'briefs-ready': 'briefs/ready',
			'briefs-tasked': 'briefs/tasked',
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
		expect(workFolderName('briefs-proposed')).toBe('briefs/proposed');
		expect(workFolderName('briefs-ready')).toBe('briefs/ready');
		expect(workFolderName('briefs-tasked')).toBe('briefs/tasked');
		// The two PER-REGIME won't-proceed terminals (the slug-collision fix): a
		// dropped task and a dropped brief sharing a slug resolve to DIFFERENT paths.
		expect(workFolderName('cancelled')).toBe('tasks/cancelled');
		expect(workFolderName('briefs-dropped')).toBe('briefs/dropped');
	});

	it('workFolderName resolves a symbolic key to its on-disk name', () => {
		expect(workFolderName('tasks-todo')).toBe('tasks/todo');
		expect(workFolderName('briefs-tasked')).toBe('briefs/tasked');
	});

	it('workFolderPath builds <root>/work/<folder>', () => {
		expect(workFolderPath('/repo', 'tasks-todo')).toBe(
			join('/repo', 'work', 'tasks', 'todo'),
		);
		expect(workFolderPath('/repo', 'briefs-ready')).toBe(
			join('/repo', 'work', 'briefs', 'ready'),
		);
	});

	it('workItemPath builds <root>/work/<folder>/<slug>.md (appends .md)', () => {
		expect(workItemPath('/repo', 'done', 'my-slug')).toBe(
			join('/repo', 'work', 'tasks', 'done', 'my-slug.md'),
		);
	});

	it('workFolderRel / workItemRel build the repo-relative forms', () => {
		expect(workFolderRel('tasks-backlog')).toBe('work/tasks/backlog');
		expect(workItemRel('needs-attention', 'foo.md')).toBe(
			'work/needs-attention/foo.md',
		);
	});

	it('workFolderPrefix carries a trailing slash', () => {
		expect(workFolderPrefix('tasks-backlog')).toBe('work/tasks/backlog/');
		expect(workFolderPrefix('observations')).toBe('work/notes/observations/');
	});

	it('stripWorkFolderPrefix recovers the filename under a folder', () => {
		expect(
			stripWorkFolderPrefix(
				'work/tasks/backlog/some-slice.md',
				'tasks-backlog',
			),
		).toBe('some-slice.md');
		// Equivalent to the hand-written `path.slice('work/tasks/backlog/'.length)`.
		const path = 'work/tasks/backlog/some-slice.md';
		expect(stripWorkFolderPrefix(path, 'tasks-backlog')).toBe(
			path.slice('work/tasks/backlog/'.length),
		);
	});

	it('stripWorkFolderPrefix returns undefined when the path is not under the folder', () => {
		expect(stripWorkFolderPrefix('work/tasks/todo/x.md', 'tasks-backlog')).toBe(
			undefined,
		);
		expect(stripWorkFolderPrefix('src/foo.ts', 'tasks-todo')).toBe(undefined);
	});

	it('isWorkItemFile is the single item-scan predicate (case-insensitive .md)', () => {
		expect(isWorkItemFile('foo.md')).toBe(true);
		expect(isWorkItemFile('FOO.MD')).toBe(true);
		expect(isWorkItemFile('foo.txt')).toBe(false);
		expect(isWorkItemFile('foo')).toBe(false);
	});

	it('the folder unions/arrays match their original scattered definitions', () => {
		expect([...TASK_RESOLUTION_FOLDERS]).toEqual([
			'in-progress',
			'tasks-todo',
			'done',
		]);
		expect([...TASK_LIFECYCLE_FOLDERS]).toEqual([
			'tasks-todo',
			'in-progress',
			'needs-attention',
			'done',
		]);
		expect([...LEDGER_STATUS_FOLDERS]).toEqual([
			'tasks-todo',
			'done',
			'cancelled',
		]);
		expect([...BRIEF_FOLDERS]).toEqual(['briefs-ready', 'briefs-tasked']);
	});
});
