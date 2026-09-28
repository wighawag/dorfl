import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.js';
import {parseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {performAdvance} from '../src/advance.js';
import {runAdvanceTickWithTreelessPublish} from '../src/advance-drivers.js';
import {
	parseLockOutputLines,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {
	SCENARIOS,
	seedScenario,
	type TreelessScenario,
} from './helpers/treeless-scenarios.js';

/**
 * END TO END: the tree-less rungs split into three CI phases (task
 * `ci-split-treeless-rungs`). Each phase runs as its OWN process
 * (`helpers/ci-phase-treeless-worker.ts`) in its OWN clone of one bare arbiter;
 * the phases share only the handoff directory and the lock outputs. The agent
 * phase's clone cannot push, and the arbiter's refs are byte-identical across
 * it. When the lock job says no agent is needed, the agent job is skipped and
 * the apply job gets `skipped`. The apply phase runs with the production agent
 * seams on the null harness, so any agent launch there would throw the phase
 * guard.
 *
 * "Today's commits": every scenario also runs through the laptop path (the
 * in-place `advance <item>` tick plus its tree-less publish) against a second,
 * identically seeded arbiter, and the two `main`s must end with the same tree,
 * the same new commit subjects and the same branches, and no lock left.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'ci-phase-treeless-worker.ts');

interface WorkerOutput {
	exitCode: number;
	outcome: string;
	message: string;
	intent?: string;
	rungOutcome?: string;
	notes: string[];
}

let scratch: Scratch;
let runnerTemp: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

function refsOf(arbiter: string): string {
	return g(arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
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

/** What a `main` ended with: its tree, the new commit subjects, its branches and lock refs. */
function endState(seeded: SeededRepo, seedTip: string) {
	return {
		tree: g(seeded.arbiter, 'rev-parse', 'main^{tree}'),
		subjects: g(seeded.arbiter, 'log', '--format=%s', `${seedTip}..main`),
		branches: g(
			seeded.arbiter,
			'for-each-ref',
			'--format=%(refname)',
			'refs/heads',
		),
		locks: g(seeded.arbiter, 'for-each-ref', 'refs/dorfl/lock'),
	};
}

/** The laptop path: the in-place `advance <item>` tick and its tree-less publish. */
async function runLaptop(s: TreelessScenario, seeded: SeededRepo) {
	const e = s.emits;
	return runAdvanceTickWithTreelessPublish(
		{
			arg: s.arg,
			cwd: seeded.clone('laptop'),
			arbiter: 'origin',
			observationTriage: s.observationTriage,
			surfaceGate: async () => e.surface ?? {questions: []},
			triageGate: async () => e.triage ?? {auto: false},
			applyDecide: async () => {
				if (e.verdict === undefined) throw new Error('no verdict');
				return e.verdict;
			},
		},
		performAdvance,
	);
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-treeless-e2e-');
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
});

afterEach(() => {
	scratch.cleanup();
});

describe('the tree-less rungs in three processes', () => {
	it.each(SCENARIOS.map((s) => [s.name, s] as const))(
		'%s: the agent phase writes nothing and the apply phase produces the laptop commits',
		async (_name, s) => {
			// The laptop reference, on its own arbiter.
			mkdirSync(join(scratch.root, 'laptop'));
			const laptop = seedRepoWithArbiter(join(scratch.root, 'laptop'), []);
			seedScenario(laptop, s);
			const laptopSeed = g(laptop.arbiter, 'rev-parse', 'main');
			const reference = await runLaptop(s, laptop);
			expect(reference.exitCode, reference.message).toBe(0);
			expect(reference.rung).toBe(s.rung);

			// The three phases, on theirs.
			mkdirSync(join(scratch.root, 'ci'));
			const seeded = seedRepoWithArbiter(join(scratch.root, 'ci'), []);
			seedScenario(seeded, s);
			const seedTip = g(seeded.arbiter, 'rev-parse', 'main');
			const common = {
				arg: s.arg,
				observationTriage: s.observationTriage,
				emits: s.emits,
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
				needsAgent: s.needsAgent,
				rung: s.rung,
			});

			// agent: skipped when the lock job says no agent is needed.
			const handoffDir = join(runnerTemp, 'handoff');
			if (s.needsAgent) {
				const agentClone = seeded.clone('agent');
				g(
					agentClone,
					'remote',
					'set-url',
					'--push',
					'origin',
					'/nonexistent.git',
				);
				const before = refsOf(seeded.arbiter);
				const agentRun = await runWorker(
					{...common, phase: 'agent', cwd: agentClone, handoffDir},
					lock,
				);
				expect(agentRun.exitCode, agentRun.stderr).toBe(0);
				expect(agentRun.out?.outcome, agentRun.out?.message).toBe(
					'handed-over',
				);
				expect(agentRun.out?.intent).toBe(s.intent);
				expect(refsOf(seeded.arbiter)).toBe(before);
			}

			// apply
			const applyRun = await runWorker(
				{
					...common,
					phase: 'apply',
					cwd: seeded.clone('apply'),
					handoffDir,
					runnerTemp,
					agentJobResult: s.needsAgent ? 'success' : 'skipped',
				},
				lock,
			);
			expect(applyRun.exitCode, applyRun.stderr).toBe(0);
			expect(applyRun.out?.outcome, applyRun.out?.message).toBe('applied');
			expect(applyRun.out?.rungOutcome).toBe(reference.outcome);
			expect(applyRun.stderr).not.toContain('PhaseGuardError');

			const ci = endState(seeded, seedTip);
			const lap = endState(laptop, laptopSeed);
			expect(ci.locks).toBe('');
			expect(ci).toEqual(lap);
			// Every scenario changes `main` (or, for the reset, a branch).
			expect(ci.subjects === '' && s.branches === undefined).toBe(false);
			if (s.sidecarEntries !== undefined) {
				const {item, entries} = s.sidecarEntries;
				const sidecar = parseSidecar(
					g(seeded.arbiter, 'show', `main:${sidecarPathFor(item)}`),
				);
				expect(
					sidecar.entries.slice(-entries.length).map((e) => ({
						question: e.question,
						...(e.context === '' ? {} : {context: e.context}),
						...(e.default === undefined ? {} : {default: e.default}),
					})),
				).toEqual(entries);
			}
		},
		120_000,
	);
});
