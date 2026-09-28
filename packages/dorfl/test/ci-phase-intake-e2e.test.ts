import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.js';
import {
	parseLockOutputLines,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {parseIntakeMarker} from '../src/intake-marker.js';
import {PROCESSING_LOCK_LABEL} from '../src/issue-provider.js';
import type {IntakeVerdict} from '../src/intake.js';
import {
	issueWrites,
	readIssueState,
	seedIssueState,
	type IssueCall,
} from './helpers/file-issue-provider.js';
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * END TO END: the intake path split into three CI phases (task
 * `ci-split-intake`, the intake half of the spec's e2e requirement). Each phase
 * runs as its OWN process (`helpers/ci-phase-intake-worker.ts`) in its OWN
 * clone of one bare arbiter, against one file-backed issue stand-in; the phases
 * share only the handoff directory and the lock outputs. The agent phase makes
 * no issue or review write, its clone cannot push, and the arbiter's refs are
 * byte-identical across it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'ci-phase-intake-worker.ts');
const ISSUE = 12;

interface WorkerOutput {
	exitCode: number;
	outcome: string;
	message: string;
	intent?: string;
	emitted?: string;
	emittedSlug?: string;
	notes: string[];
}

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;
let stateFile: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

function arbiterRefs(): string {
	return g(seeded.arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function showOnArbiter(spec: string): string | undefined {
	try {
		return g(seeded.arbiter, 'show', spec);
	} catch {
		return undefined;
	}
}

function runWorker(
	args: Record<string, unknown>,
	lockOutputs?: LockOutputs,
): Promise<{exitCode: number; stderr: string; out?: WorkerOutput}> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {...gitEnv(), GITHUB_ACTIONS: 'true'};
		if (lockOutputs !== undefined) {
			// As `toJSON(needs.lock.outputs)` renders it: every value a string.
			const asStrings: Record<string, string> = {};
			for (const [k, v] of Object.entries(lockOutputs)) {
				asStrings[k] = Array.isArray(v) ? v.join(',') : String(v);
			}
			env.DORFL_LOCK_OUTPUTS = JSON.stringify(asStrings);
		}
		const child = spawn(TSX_BIN, [WORKER, JSON.stringify(args)], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.stderr.on('data', (d) => (stderr += d.toString()));
		child.on('error', reject);
		child.on('close', (code) => {
			let out: WorkerOutput | undefined;
			try {
				out = JSON.parse(stdout.trim().split('\n').pop() ?? '');
			} catch {
				out = undefined;
			}
			resolve({exitCode: code ?? -1, stderr, out});
		});
	});
}

interface ThreePhaseRun {
	lock: LockOutputs;
	agent: WorkerOutput;
	apply: WorkerOutput;
	/** The issue calls each phase made. */
	agentCalls: IssueCall[];
	applyCalls: IssueCall[];
}

/** The issue calls made since `from` (an index into the stand-in's log). */
function callsSince(from: number): IssueCall[] {
	return readIssueState(stateFile).calls.slice(from);
}

async function threePhases(verdict: IntakeVerdict): Promise<ThreePhaseRun> {
	const eventPath = join(scratch.root, 'event.json');
	writeFileSync(
		eventPath,
		JSON.stringify({issue: {number: ISSUE, author_association: 'NONE'}}),
	);

	// lock
	const githubOutput = join(scratch.root, 'github-output');
	writeFileSync(githubOutput, '');
	const lockRun = await runWorker({
		phase: 'lock',
		cwd: seeded.clone('lock'),
		issueNumber: ISSUE,
		stateFile,
		githubOutput,
		eventPath,
	});
	expect(lockRun.exitCode, lockRun.stderr).toBe(0);
	expect(lockRun.out?.outcome, lockRun.out?.message).toBe('locked');
	const lock = parseLockOutputLines(readFileSync(githubOutput, 'utf8'));
	expect(lock).toMatchObject({
		acquired: true,
		needsAgent: true,
		rung: 'intake',
		originTrust: 'untrusted',
		documentMode: 'merge',
		seenCommentIds: ['IC_kwreporter1'],
	});
	expect(readIssueState(stateFile).labels).toEqual([PROCESSING_LOCK_LABEL]);

	// agent: its push URL cannot accept pushes; nothing on the arbiter may move.
	const agentClone = seeded.clone('agent');
	g(agentClone, 'remote', 'set-url', '--push', 'origin', '/nonexistent.git');
	const handoffDir = join(runnerTemp, 'handoff');
	const before = arbiterRefs();
	const agentFrom = readIssueState(stateFile).calls.length;
	const agentRun = await runWorker(
		{
			phase: 'agent',
			cwd: agentClone,
			issueNumber: ISSUE,
			stateFile,
			handoffDir,
			verdict,
		},
		lock,
	);
	expect(agentRun.exitCode, agentRun.stderr).toBe(0);
	expect(agentRun.out?.outcome, agentRun.out?.message).toBe('handed-over');
	expect(arbiterRefs()).toBe(before);
	const agentCalls = callsSince(agentFrom);

	// apply
	const applyFrom = readIssueState(stateFile).calls.length;
	const applyRun = await runWorker(
		{
			phase: 'apply',
			cwd: seeded.clone('apply'),
			issueNumber: ISSUE,
			stateFile,
			handoffDir,
			runnerTemp,
		},
		lock,
	);
	expect(applyRun.exitCode, applyRun.stderr).toBe(0);
	return {
		lock,
		agent: agentRun.out!,
		apply: applyRun.out!,
		agentCalls,
		applyCalls: callsSince(applyFrom),
	};
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-intake-e2e-');
	seeded = seedRepoWithArbiter(scratch.root, [], {
		repoConfig: {intakeIntegration: 'merge'},
	});
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
	stateFile = join(scratch.root, 'issue.json');
	seedIssueState(
		stateFile,
		{
			number: ISSUE,
			title: 'Add a quiet flag',
			body: 'The CLI should have a --quiet flag.',
			state: 'open',
		},
		[{id: 'IC_kwreporter1', author: 'reporter', body: 'It hides >> notes.'}],
	);
});

afterEach(() => {
	scratch.cleanup();
});

describe('intake in three processes (lock, agent, apply)', () => {
	it('task: the apply job lands the re-rendered document at the trusted placement, stamped, then comments and removes the label', async () => {
		const run = await threePhases({
			outcome: 'task',
			taskSlug: 'agent-chosen-slug',
			taskTitle: 'Add a quiet flag',
			taskBody: '## What to build\n\nA --quiet flag.\n',
		});
		// The agent phase only READ the issue.
		expect(run.agentCalls.map((c) => c.method)).toEqual([
			'getIssue',
			'listComments',
		]);
		expect(run.agent.intent).toBe('intake-task');

		expect(run.apply.outcome, run.apply.message).toBe('tasked');
		expect(run.apply.emitted).toBe('work/tasks/backlog/add-a-quiet-flag.md');
		const doc = showOnArbiter(
			'refs/heads/main:work/tasks/backlog/add-a-quiet-flag.md',
		) as string;
		expect(doc).toBeDefined();
		const fm = parseFrontmatter(doc);
		expect(fm.origin).toBe('issue');
		expect(fm.originTrust).toBe('untrusted');
		expect(fm.slug).toBe('add-a-quiet-flag');
		expect(String(fm.issue)).toBe(String(ISSUE));
		expect(doc).toContain('A --quiet flag.');

		expect(run.applyCalls.map((c) => c.method)).toEqual([
			'getLabels',
			'postIssueComment',
			'removeLabel',
		]);
		const completion = run.applyCalls[1]!.body!;
		expect(completion).toContain('Created task `add-a-quiet-flag`');
		expect(parseIntakeMarker(completion)).toEqual({
			kind: 'created',
			slug: 'add-a-quiet-flag',
			seen: ['IC_kwreporter1'],
		});
		expect(readIssueState(stateFile).labels).toEqual([]);
	}, 120_000);

	it('ask: the apply job posts the question with the marker and removes the label; the arbiter does not move', async () => {
		const before = arbiterRefs();
		const run = await threePhases({
			outcome: 'ask',
			question: 'Should --quiet also hide errors?',
		});
		expect(run.agentCalls.map((c) => c.method)).toEqual([
			'getIssue',
			'listComments',
		]);
		expect(run.apply.outcome, run.apply.message).toBe('asked');
		expect(arbiterRefs()).toBe(before);
		const writes = issueWrites(stateFile).filter(
			(c) => c.method !== 'addLabel',
		);
		expect(writes.map((c) => c.method)).toEqual([
			'postIssueComment',
			'removeLabel',
		]);
		expect(writes[0]!.body).toContain('Should --quiet also hide errors?');
		expect(parseIntakeMarker(writes[0]!.body!)).toEqual({
			kind: 'ask',
			seen: ['IC_kwreporter1'],
		});
		expect(readIssueState(stateFile).closed).toBeUndefined();
		expect(readIssueState(stateFile).labels).toEqual([]);
	}, 120_000);

	it('bounce: the apply job closes the issue as not planned with the bounce text and removes the label', async () => {
		const before = arbiterRefs();
		const run = await threePhases({
			outcome: 'bounce',
			bounceMessage: 'Please file the two asks separately.',
		});
		expect(run.apply.outcome, run.apply.message).toBe('bounced');
		expect(arbiterRefs()).toBe(before);
		const writes = issueWrites(stateFile).filter(
			(c) => c.method !== 'addLabel',
		);
		expect(writes.map((c) => c.method)).toEqual(['closeIssue', 'removeLabel']);
		expect(writes[0]!.reason).toBe('not planned');
		expect(writes[0]!.comment).toContain(
			'Please file the two asks separately.',
		);
		expect(parseIntakeMarker(writes[0]!.comment!)?.kind).toBe('bounced');
		expect(readIssueState(stateFile).closed).toBe(true);
		expect(readIssueState(stateFile).labels).toEqual([]);
	}, 120_000);
});
