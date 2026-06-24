import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolveEligibility, resolveGate} from '../src/eligibility.js';
import {
	resolveTaskGate,
	resolveTaskingEligibility,
} from '../src/tasking-eligibility.js';
import {scan} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {registerMirrorWithWork} from './helpers/gitRepo.js';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import {buildTaskReviewPrompt} from '../src/tasker-review-loop.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Tests for the DE-OVERLOADED `humanOnly` model + the tasker heuristic shift
 * (task `de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic`, PRD
 * `staging-pool-position-gate-and-trust-model` US #8, #10, #11; governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * The three orthogonal axes, each meaning one thing:
 *   - POSITION (folder, runner-deterministic): `work/tasks/backlog/` (staging, not
 *     eligible) vs `work/tasks/ready/` (the agent pool). Carries "review before the
 *     agent acts".
 *   - NATURE (task `humanOnly`, agent judgement, NARROWED): "never-by-nature"
 *     (secrets/release/security) — survives even when the task resides in the
 *     pool `work/tasks/ready/`. PRD `humanOnly` UNCHANGED (gates auto-tasking).
 *   - DISCOVERED (`needsAnswers`): unchanged.
 */

// --- Unit predicates: the three axes are orthogonal, each means one thing --

describe('task `humanOnly` (NARROWED) — never agent-eligible, even in the pool', () => {
	it('humanOnly:true is not agent-claimable regardless of autoBuild / pool residency', () => {
		// The predicate operates on already-read frontmatter — the caller reads it
		// from `work/tasks/ready/` (the pool). `autoBuild:true` simulates the pool path
		// (the strongest possible policy); `humanOnly:true` still refuses.
		expect(resolveGateInputs({humanOnly: true})).toBe(false);
		const e = resolveEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.gatePass).toBe(false);
		expect(e.eligible).toBe(false);
	});

	it('an undeclared task in the pool IS eligible (the de-overload moves review-first to position, not to humanOnly)', () => {
		const e = resolveEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.eligible).toBe(true);
	});

	it('needsAnswers:true blocks INDEPENDENTLY of humanOnly (orthogonal axes)', () => {
		const e = resolveEligibility({
			humanOnly: undefined,
			needsAnswers: true,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.gatePass).toBe(false);
		expect(e.eligible).toBe(false);
	});
});

describe('PRD `humanOnly` (UNCHANGED) — still blocks auto-tasking', () => {
	it('PRD humanOnly:true blocks the tasking gate even when autoTask is on', () => {
		expect(resolveTaskGate(true, undefined, true)).toBe(false);
		const r = resolveTaskingEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			taskedAfter: [],
			taskedSlugs: new Set(),
			autoTask: true,
		});
		expect(r.gatePass).toBe(false);
		expect(r.taskable).toBe(false);
	});

	it('PRD needsAnswers:true is unchanged (orthogonal to humanOnly)', () => {
		const r = resolveTaskingEligibility({
			humanOnly: undefined,
			needsAnswers: true,
			taskedAfter: [],
			taskedSlugs: new Set(),
			autoTask: true,
		});
		expect(r.gatePass).toBe(false);
	});
});

// --- Pool-residency on a real BARE mirror (`--bare file://`, house pattern) -

describe('pool residency — humanOnly task in `work/tasks/ready/` (the pool) is NOT eligible', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'humanonly-de-overload-'));
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it('scan reports a backlog `humanOnly` task as not eligible; an undeclared neighbour is eligible (autoBuild on)', async () => {
		const workspacesDir = join(root, '.dorfl');
		registerMirrorWithWork(workspacesDir, 'repo', {
			backlog: {
				// Lives in the AGENT POOL `work/tasks/ready/` — even there, the narrowed
				// `humanOnly: true` survives (never-by-nature guard).
				'never-by-nature.md': task({
					slug: 'never-by-nature',
					humanOnly: 'true',
				}),
				// Undeclared neighbour in the SAME pool: eligible under autoBuild (the
				// review-first signal lives at POSITION, not on this flag).
				'ordinary.md': task({slug: 'ordinary'}),
			},
		});
		const report = await scan(mergeConfig({workspacesDir, autoBuild: true}));
		const items = report.repos[0].items;
		const never = items.find((i) => i.slug === 'never-by-nature')!;
		const ordinary = items.find((i) => i.slug === 'ordinary')!;
		expect(never.eligibility.gatePass).toBe(false);
		expect(never.eligibility.eligible).toBe(false);
		expect(ordinary.eligibility.eligible).toBe(true);
	});
});

// --- Tasker heuristic: review-first → STAGING-BIRTH (not a `humanOnly` stamp)

describe('tasker heuristic — review-first is staging-birth, NOT a `humanOnly` stamp', () => {
	let scratch: Scratch;
	let restorePiAgentDir: () => void;
	beforeEach(() => {
		scratch = makeScratch('humanonly-de-overload-tasker-');
		restorePiAgentDir = isolatePiAgentDir(scratch.root);
	});
	afterEach(() => {
		restorePiAgentDir();
		scratch.cleanup();
	});

	it('the tasking prd tells the agent to BIRTH tasks in STAGING (`work/tasks/backlog/`) and reserves `humanOnly` for never-by-nature', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Seed a PRD.
		run('git', ['fetch', '-q', 'arbiter', 'main'], repo, {env: gitEnv()});
		seedPrdRaw(repo, 'it');
		let capturedPrompt = '';
		const dorfl: TaskDorfl = ({cwd, prompt}) => {
			capturedPrompt = prompt;
			// Honour the prd: birth in STAGING, do not stamp humanOnly for review.
			const dir = join(cwd, 'work', 'tasks', 'backlog');
			mkdirSync(dir, {recursive: true});
			writeFileSync(
				join(dir, 'it-first.md'),
				'---\ntitle: it-first\nslug: it-first\nprd: it\n---\n\n## What to build\n\nbody\n',
			);
			return {ok: true};
		};
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: 'arbiter',
			autoTask: true,
			integration: 'merge',
			dorfl,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('tasked');
		// AFTER the relocation (task `slicing-protocol-doc-and-vocabulary-fix`):
		// the de-overloaded language lives in `TASKING-PROTOCOL.md`, NOT inlined in
		// the prompt. The prompt now POINTS at the doc + names the staging folder.
		expect(capturedPrompt).toMatch(/work\/protocol\/TASKING-PROTOCOL\.md/);
		expect(capturedPrompt).toMatch(/work\/tasks\/backlog/);
		expect(capturedPrompt).not.toMatch(/work\/pre-backlog/);
		// The destination check: the doc carries the de-overloaded language.
		const HERE = dirname(fileURLToPath(import.meta.url));
		const REPO = resolve(HERE, '..', '..', '..');
		const doc = readFileSync(
			resolve(REPO, 'skills', 'setup', 'protocol', 'TASKING-PROTOCOL.md'),
			'utf8',
		);
		expect(doc).toMatch(/NEVER-for-agents BY NATURE/i);
		expect(doc).toMatch(/Do NOT stamp `humanOnly` to mean "a human/);
		expect(doc).toMatch(/Review-first is encoded by the staging position/);
	});

	it('the tasker-review-loop prompt carries the same narrowed `humanOnly` guidance', () => {
		const prompt = buildTaskReviewPrompt({
			slug: 'it',
			cwd: '/tmp/x',
			candidateTasks: ['work/tasks/backlog/it-a.md'],
			pass: 1,
			execution: 1,
		});
		expect(prompt).toMatch(/TASK `humanOnly` IS NARROW/);
		expect(prompt).toMatch(/never-for-agents BY NATURE/);
		expect(prompt).toMatch(/Review-first is the staging position/);
	});
});

// --- Helpers ---------------------------------------------------------------

function resolveGateInputs(input: {humanOnly?: boolean}): boolean {
	return resolveGate(input.humanOnly, undefined, true);
}

function task(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

function seedPrdRaw(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prds', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug}`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', 'arbiter', 'main'], repo, {env: gitEnv()});
}
