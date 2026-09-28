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
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * END TO END: the tasking path split into three CI phases (task
 * `ci-split-tasking`). Each phase runs as its OWN process
 * (`helpers/ci-phase-tasking-worker.ts`) in its OWN clone of one bare arbiter;
 * the phases share only the handoff directory and the lock outputs. The agent
 * phase runs the tasker, its review rounds and the task-set review, and its
 * clone cannot push: the arbiter's refs are byte-identical across it. The apply
 * phase runs with the production review seams on the null harness, so any agent
 * launch there would throw the phase guard; it lands the tasks and the spec move.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'ci-phase-tasking-worker.ts');
const SLUG = 'three-jobs';
const SPEC_REL = `work/specs/ready/${SLUG}.md`;
const TASKED_REL = `work/specs/tasked/${SLUG}.md`;

const HEAD = ['---', 'title: Three jobs', `slug: ${SLUG}`, '---'];
const DURABLE = [
	'',
	'## Problem Statement',
	'',
	'P.',
	'',
	'## Solution',
	'',
	'S.',
	'',
	'## User Stories',
	'',
	'1. As a maintainer, I want it.',
	'',
];
const SPEC = [...HEAD, ...DURABLE, '## Testing Decisions', '', 'T.', ''].join(
	'\n',
);
const TRIMMED = [...HEAD, ...DURABLE].join('\n');

function task(slug: string): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`spec: ${SLUG}`,
		'blockedBy: []',
		'---',
		'',
		'## Prompt',
		'',
		'> build it',
		'',
	].join('\n');
}

interface WorkerOutput {
	exitCode: number;
	outcome: string;
	message: string;
	intent?: string;
	emitted?: string[];
	notes: string[];
}

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;
let providerLog: string;
let reviewLog: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

function arbiterRefs(): string {
	return g(seeded.arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function showOnArbiter(spec: string): string | undefined {
	try {
		return git(['show', spec], seeded.arbiter, {env: gitEnv()});
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
				asStrings[k] = String(v);
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

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-tasking-e2e-');
	seeded = seedRepoWithArbiter(scratch.root, []);
	mkdirSync(join(seeded.repo, 'work', 'specs', 'ready'), {recursive: true});
	writeFileSync(join(seeded.repo, SPEC_REL), SPEC);
	g(seeded.repo, 'add', '-A');
	g(seeded.repo, 'commit', '-q', '-m', 'spec');
	g(seeded.repo, 'push', '-q', 'arbiter', 'main');
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
	providerLog = join(scratch.root, 'provider.log');
	reviewLog = join(scratch.root, 'review.log');
});

afterEach(() => {
	scratch.cleanup();
});

describe('the tasking path in three processes', () => {
	it('lock takes the spec lock; agent writes nothing and runs the task-set review; apply launches no agent and lands the tasks with the spec move', async () => {
		const common = {
			arg: `spec:${SLUG}`,
			integration: 'merge',
			providerLog,
			reviewLog,
		};

		// lock
		const githubOutput = join(scratch.root, 'github-output');
		writeFileSync(githubOutput, '');
		const lockRun = await runWorker({
			...common,
			phase: 'lock',
			cwd: seeded.clone('lock'),
			githubOutput,
		});
		expect(lockRun.exitCode, lockRun.stderr).toBe(0);
		expect(lockRun.out?.outcome, lockRun.out?.message).toBe('locked');
		const lock = parseLockOutputLines(readFileSync(githubOutput, 'utf8'));
		expect(lock).toMatchObject({
			acquired: true,
			needsAgent: true,
			rung: 'task-spec',
		});
		expect(g(seeded.arbiter, 'rev-parse', `refs/dorfl/lock/spec-${SLUG}`)).toBe(
			lock.lockSha,
		);

		// agent: its push URL cannot accept pushes; nothing on the arbiter may move.
		const agentClone = seeded.clone('agent');
		g(agentClone, 'remote', 'set-url', '--push', 'origin', '/nonexistent.git');
		const handoffDir = join(runnerTemp, 'handoff');
		const before = arbiterRefs();
		const agentRun = await runWorker(
			{
				...common,
				phase: 'agent',
				cwd: agentClone,
				handoffDir,
				candidates: {
					'first-job': task('first-job'),
					'second-job': task('second-job'),
				},
				trimmedSpec: TRIMMED,
				specRel: SPEC_REL,
			},
			lock,
		);
		expect(agentRun.exitCode, agentRun.stderr).toBe(0);
		expect(agentRun.out?.outcome, agentRun.out?.message).toBe('handed-over');
		expect(agentRun.out?.intent).toBe('tasking-land');
		expect(arbiterRefs()).toBe(before);
		// The task-set review ran in the AGENT process, once, on the agent's clone.
		const reviews = readFileSync(reviewLog, 'utf8').trim().split('\n');
		expect(reviews).toHaveLength(1);
		expect(reviews[0]).toContain(agentClone);
		expect(readFileSync(providerLog, 'utf8')).toBe('');

		// apply: the production review seams would throw the phase guard on launch.
		const applyRun = await runWorker(
			{
				...common,
				phase: 'apply',
				cwd: seeded.clone('apply'),
				handoffDir,
				runnerTemp,
			},
			lock,
		);
		expect(applyRun.exitCode, applyRun.stderr).toBe(0);
		expect(applyRun.out?.outcome, applyRun.out?.message).toBe('landed');
		expect(applyRun.stderr).not.toContain('PhaseGuardError');
		expect(readFileSync(reviewLog, 'utf8').trim().split('\n')).toHaveLength(1);

		expect(showOnArbiter(`main:${TASKED_REL}`)).toBe(TRIMMED);
		expect(showOnArbiter(`main:${SPEC_REL}`)).toBeUndefined();
		for (const slug of ['first-job', 'second-job']) {
			const doc = showOnArbiter(`main:work/tasks/backlog/${slug}.md`);
			expect(doc, slug).toBeDefined();
			expect(parseFrontmatter(doc as string).spec).toBe(SLUG);
		}
		expect(g(seeded.arbiter, 'log', '-1', '--format=%s', 'main')).toContain(
			'; tasked',
		);
		expect(
			g(seeded.arbiter, 'for-each-ref', `refs/dorfl/lock/spec-${SLUG}`),
		).toBe('');
	}, 120_000);
});
