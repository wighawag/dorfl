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
	SPEC_FOLDERS,
} from '../src/work-layout.js';

describe('work-layout — the single source of every work/ path + folder union', () => {
	it('the symbolic KEYS read in the task/spec vocabulary; the spec VALUES are under work/specs', () => {
		// The prd→spec cutover migrate-batch 1
		// (`rename-spec-work-layout-and-folders`) flips the spec-regime KEYS to the
		// `spec` words (`prds-proposed` -> `specs-proposed`, `prds-ready` ->
		// `specs-ready`, `prds-tasked` -> `specs-tasked`, `prds-dropped` ->
		// `specs-dropped`) AND their VALUES (`prds/*` -> `specs/*`) in lockstep with the
		// on-disk `git mv work/prds/* -> work/specs/*`. The task-regime keys/values and
		// the lock-ref-state keys (`in-progress`/`needs-attention`) are unchanged.
		expect(WORK_ROOT).toBe('work');
		expect(WORK_FOLDER_NAME).toEqual({
			'tasks-backlog': 'tasks/backlog',
			'tasks-ready': 'tasks/ready',
			'in-progress': 'in-progress',
			'needs-attention': 'needs-attention',
			done: 'tasks/done',
			cancelled: 'tasks/cancelled',
			'specs-proposed': 'specs/proposed',
			'specs-ready': 'specs/ready',
			'specs-tasked': 'specs/tasked',
			'specs-dropped': 'specs/dropped',
			observations: 'notes/observations',
			ideas: 'notes/ideas',
			findings: 'notes/findings',
			questions: 'questions',
			protocol: 'protocol',
		});
	});

	it('the spec regime resolves to staging / pool / resting, and the terminals are per-regime', () => {
		// The spec lifecycle: proposed (staging) -> ready (pool) -> tasked (resting).
		expect(workFolderName('specs-proposed')).toBe('specs/proposed');
		expect(workFolderName('specs-ready')).toBe('specs/ready');
		expect(workFolderName('specs-tasked')).toBe('specs/tasked');
		// The two PER-REGIME won't-proceed terminals (the slug-collision fix): a
		// dropped task and a dropped spec sharing a slug resolve to DIFFERENT paths.
		expect(workFolderName('cancelled')).toBe('tasks/cancelled');
		expect(workFolderName('specs-dropped')).toBe('specs/dropped');
	});

	it('workFolderName resolves a symbolic key to its on-disk name', () => {
		expect(workFolderName('tasks-ready')).toBe('tasks/ready');
		expect(workFolderName('specs-tasked')).toBe('specs/tasked');
	});

	it('workFolderPath builds <root>/work/<folder>', () => {
		expect(workFolderPath('/repo', 'tasks-ready')).toBe(
			join('/repo', 'work', 'tasks', 'ready'),
		);
		expect(workFolderPath('/repo', 'specs-ready')).toBe(
			join('/repo', 'work', 'specs', 'ready'),
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
			stripWorkFolderPrefix('work/tasks/backlog/some-task.md', 'tasks-backlog'),
		).toBe('some-task.md');
		// Equivalent to the hand-written `path.slice('work/tasks/backlog/'.length)`.
		const path = 'work/tasks/backlog/some-task.md';
		expect(stripWorkFolderPrefix(path, 'tasks-backlog')).toBe(
			path.slice('work/tasks/backlog/'.length),
		);
	});

	it('stripWorkFolderPrefix returns undefined when the path is not under the folder', () => {
		expect(
			stripWorkFolderPrefix('work/tasks/ready/x.md', 'tasks-backlog'),
		).toBe(undefined);
		expect(stripWorkFolderPrefix('src/foo.ts', 'tasks-ready')).toBe(undefined);
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
			'tasks-ready',
			'done',
		]);
		// `needs-attention` was dropped post-cutover
		// (`finish-needs-attention-folder-cutover-remove-legacy-recovery-readers`,
		// ADR `needs-attention-folder-cutover-followup-nits`): the folder is retired.
		expect([...TASK_LIFECYCLE_FOLDERS]).toEqual([
			'tasks-ready',
			'in-progress',
			'done',
		]);
		expect([...LEDGER_STATUS_FOLDERS]).toEqual([
			'tasks-ready',
			'done',
			'cancelled',
		]);
		expect([...SPEC_FOLDERS]).toEqual(['specs-ready', 'specs-tasked']);
	});
});
