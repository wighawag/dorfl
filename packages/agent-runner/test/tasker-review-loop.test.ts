import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {
	runTaskReviewLoop,
	parseTaskReviewVerdict,
	buildTaskReviewPrompt,
	type TaskReviewGate,
	type TaskReviewVerdict,
} from '../src/tasker-review-loop.js';

/**
 * Pure-logic tests for the tasker review→edit→converge LOOP
 * (`slicer-review-edit-loop`). These exercise the loop MECHANICS — the in-context
 * (N) review→edit→re-review, the `slicerLoopMax` hard cap, the M fresh-context
 * re-executions, the edit-application to candidate task files, and the three
 * verdict-routing outcomes — with a STUBBED review gate (no real model, no
 * network, no harness). Candidate task files live under a temp
 * `work/tasks/backlog/` tree (the STAGING folder per task
 * `pre-backlog-staging-folder-and-promote-step-a`); nothing touches the real
 * `~/.agent-runner/` or `~/.pi/`.
 */

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), 'slicer-review-loop-'));
	mkdirSync(join(cwd, 'work', 'tasks', 'backlog'), {recursive: true});
});
afterEach(() => {
	rmSync(cwd, {recursive: true, force: true});
});

/** Seed a candidate task file under `work/tasks/backlog/` (the STAGING folder). */
function seedCandidate(name: string, body = 'draft'): string {
	const rel = `work/tasks/backlog/${name}.md`;
	writeFileSync(
		join(cwd, rel),
		`---\nslug: ${name}\nprd: it\n---\n\n## Prompt\n\n> ${body}\n`,
	);
	return rel;
}

/** A snapshot (filename → content) of `work/tasks/backlog/` — the loop's `before` fence. */
function snapshotBacklog(): Map<string, string> {
	const dir = join(cwd, 'work', 'tasks', 'backlog');
	const snap = new Map<string, string>();
	for (const name of readdirSync(dir)) {
		if (name.toLowerCase().endsWith('.md')) {
			snap.set(name, readFileSync(join(dir, name), 'utf8'));
		}
	}
	return snap;
}

/** A gate that returns a scripted sequence of verdicts (one per pass). */
function scriptedGate(
	verdicts: TaskReviewVerdict[],
	calls: Array<{pass: number; execution: number}> = [],
): TaskReviewGate {
	let i = 0;
	return async (input) => {
		calls.push({pass: input.pass, execution: input.execution});
		const v = verdicts[Math.min(i, verdicts.length - 1)];
		i++;
		return v;
	};
}

describe('runTaskReviewLoop — converging (findings → edits → clean)', () => {
	it('applies the agent edits to the candidate slice files and re-reviews until clean', async () => {
		seedCandidate('child', 'draft');
		const calls: Array<{pass: number; execution: number}> = [];
		const gate = scriptedGate(
			[
				// Pass 1: block + an edit improving the candidate.
				{
					verdict: 'block',
					findings: [
						{severity: 'blocking', question: 'the prompt is too thin'},
					],
					edits: [
						{
							path: 'work/tasks/backlog/child.md',
							content:
								'---\nslug: child\nprd: it\n---\n\n## Prompt\n\n> improved\n',
						},
					],
				},
				// Pass 2: no new blocking issue — converge.
				{verdict: 'approve', findings: []},
			],
			calls,
		);
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate,
			taskerLoopMax: 3,
		});
		expect(result.outcome).toBe('converged');
		expect(result.passes).toBe(2);
		expect(result.executions).toBe(1);
		// The edit was APPLIED to disk (the runner wrote it; the agent does no disk).
		expect(
			readFileSync(join(cwd, 'work/tasks/backlog/child.md'), 'utf8'),
		).toMatch(/> improved/);
		// Two in-context passes ran in ONE fresh context.
		expect(calls).toEqual([
			{pass: 1, execution: 1},
			{pass: 2, execution: 1},
		]);
	});

	it('converges immediately on a first-pass approve (the cheap natural terminator)', async () => {
		seedCandidate('child');
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([{verdict: 'approve', findings: []}]),
			taskerLoopMax: 3,
		});
		expect(result.outcome).toBe('converged');
		expect(result.passes).toBe(1);
	});

	it('an edit may CREATE a new candidate slice (review split one into two)', async () => {
		seedCandidate('child');
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'split this'}],
					edits: [
						{
							path: 'work/tasks/backlog/child-b.md',
							content: '---\nslug: child-b\nprd: it\n---\n\n## Prompt\n\n> b\n',
						},
					],
				},
				{verdict: 'approve', findings: []},
			]),
			taskerLoopMax: 3,
		});
		expect(result.outcome).toBe('converged');
		expect(Object.keys(result.tasks)).toContain(
			'work/tasks/backlog/child-b.md',
		);
	});

	it('REFUSES an edit outside work/tasks/backlog/ (defensive scope fence)', async () => {
		seedCandidate('child');
		const escaped = join(cwd, 'work', 'briefs', 'ready', 'it.md');
		mkdirSync(join(cwd, 'work', 'briefs', 'ready'), {recursive: true});
		writeFileSync(escaped, 'original PRD');
		await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'x'}],
					edits: [{path: 'work/briefs/ready/it.md', content: 'HIJACKED'}],
				},
				{verdict: 'approve', findings: []},
			]),
			taskerLoopMax: 3,
		});
		// The escaping edit was NOT applied — only candidate tasks are improved.
		expect(readFileSync(escaped, 'utf8')).toBe('original PRD');
	});
});

describe('runTaskReviewLoop — scoping fence (only THIS run’s own slices)', () => {
	// The requeue fix: on a POPULATED backlog (the normal steady state), the loop
	// must review/edit/flag ONLY the tasks new-or-changed since the `before`
	// snapshot — never the pre-existing, already-landed tasks that share the dir.

	it('reviews ONLY the run’s own candidate slices (pre-existing ones are not passed to the gate)', async () => {
		// Two pre-existing LANDED tasks already in the backlog.
		seedCandidate('landed-a', 'landed a');
		seedCandidate('landed-b', 'landed b');
		const before = snapshotBacklog();
		// THIS run produces one new task on top.
		seedCandidate('mine', 'mine');
		let seen: string[] = [];
		const gate: TaskReviewGate = async (input) => {
			seen = input.candidateTasks;
			return {verdict: 'approve', findings: []};
		};
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate,
			before,
			taskerLoopMax: 3,
		});
		expect(result.outcome).toBe('converged');
		// The gate only saw THIS run's own task — never the pre-existing landed ones.
		expect(seen).toEqual(['work/tasks/backlog/mine.md']);
		// The returned tasks set is likewise scoped to the run's own output.
		expect(Object.keys(result.tasks)).toEqual(['work/tasks/backlog/mine.md']);
	});

	it('REFUSES an edit to a pre-existing landed slice (untouched on disk)', async () => {
		const landedRel = seedCandidate('landed', 'ORIGINAL landed content');
		const before = snapshotBacklog();
		seedCandidate('mine', 'mine');
		await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [
						{severity: 'blocking', question: 'hijack the landed slice'},
					],
					edits: [{path: landedRel, content: 'HIJACKED'}],
				},
				{verdict: 'approve', findings: []},
			]),
			before,
			taskerLoopMax: 3,
		});
		// The pre-existing landed task was NOT overwritten by the loop.
		expect(readFileSync(join(cwd, landedRel), 'utf8')).toMatch(
			/ORIGINAL landed content/,
		);
	});

	it('the uncertain-slices FLOOR flags only the run’s own slices (not pre-existing)', async () => {
		seedCandidate('landed', 'landed');
		const before = snapshotBacklog();
		seedCandidate('mine', 'mine');
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			// Block with NO named uncertain task → the floor maps the run's own set.
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'broadly unclear'}],
				},
			]),
			before,
			taskerLoopMax: 1,
		});
		expect(result.outcome).toBe('uncertain-slices');
		// Only THIS run's task is flagged — the pre-existing landed one is untouched.
		expect(result.uncertainTasks.map((u) => u.path)).toEqual([
			'work/tasks/backlog/mine.md',
		]);
	});

	it('an edit that IMPROVES the run’s own slice still applies (in-scope)', async () => {
		seedCandidate('landed', 'landed');
		const before = snapshotBacklog();
		const mineRel = seedCandidate('mine', 'draft');
		await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'thin'}],
					edits: [
						{
							path: mineRel,
							content:
								'---\nslug: mine\nprd: it\n---\n\n## Prompt\n\n> IMPROVED\n',
						},
					],
				},
				{verdict: 'approve', findings: []},
			]),
			before,
			taskerLoopMax: 3,
		});
		expect(readFileSync(join(cwd, mineRel), 'utf8')).toMatch(/IMPROVED/);
	});
});

describe('runTaskReviewLoop — slicerLoopMax cap rejects via the sink', () => {
	it('persistent block → uncertain-slices (specific slices needsAnswers + questions)', async () => {
		seedCandidate('child');
		const gate = scriptedGate([
			{
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'still unclear'}],
				uncertainTasks: [
					{
						path: 'work/tasks/backlog/child.md',
						questions: ['what is the seam?'],
					},
				],
			},
		]);
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate,
			taskerLoopMax: 2,
		});
		expect(result.outcome).toBe('uncertain-slices');
		// The cap was hit (2 passes), never an infinite loop.
		expect(result.passes).toBe(2);
		expect(result.uncertainTasks).toEqual([
			{path: 'work/tasks/backlog/child.md', questions: ['what is the seam?']},
		]);
	});

	it('persistent block with NO named slice → ALL candidates treated as uncertain (floor)', async () => {
		seedCandidate('a');
		seedCandidate('b');
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'broadly unclear'}],
				},
			]),
			taskerLoopMax: 1,
		});
		expect(result.outcome).toBe('uncertain-slices');
		// Never silently drops the rejection: every candidate is flagged.
		expect(result.uncertainTasks.map((u) => u.path).sort()).toEqual([
			'work/tasks/backlog/a.md',
			'work/tasks/backlog/b.md',
		]);
		// The floor questions come from the blocking findings.
		for (const u of result.uncertainTasks) {
			expect(u.questions).toEqual(['broadly unclear']);
		}
	});

	it('decomposition-unclear → route the PRD to needs-attention (no guessed slices)', async () => {
		seedCandidate('child');
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([
				{
					verdict: 'block',
					findings: [
						{severity: 'blocking', question: 'the whole shape is wrong'},
					],
					decompositionUnclear: {
						questions: ['should this even be one PRD?'],
					},
				},
			]),
			taskerLoopMax: 2,
		});
		expect(result.outcome).toBe('decomposition-unclear');
		expect(result.briefQuestions).toEqual(['should this even be one PRD?']);
		// No uncertain tasks emitted on this outcome.
		expect(result.uncertainTasks).toEqual([]);
	});
});

describe('runTaskReviewLoop — M fresh-context re-executions', () => {
	it('M>1 runs the loop in fresh contexts; the first that converges wins', async () => {
		seedCandidate('child');
		const calls: Array<{pass: number; execution: number}> = [];
		// Execution 1 never converges (always blocks); execution 2 converges pass 1.
		let exec = 0;
		const gate: TaskReviewGate = async (input) => {
			calls.push({pass: input.pass, execution: input.execution});
			if (input.execution === 1) {
				return {
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'nope'}],
				};
			}
			exec = input.execution;
			return {verdict: 'approve', findings: []};
		};
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate,
			taskerLoopMax: 2,
			executions: 3,
		});
		expect(result.outcome).toBe('converged');
		// Stopped at execution 2 (the first to converge) — execution 3 never ran.
		expect(result.executions).toBe(2);
		expect(exec).toBe(2);
		// Execution 1 ran its full slicerLoopMax (2 passes), execution 2 converged pass 1.
		expect(calls).toEqual([
			{pass: 1, execution: 1},
			{pass: 2, execution: 1},
			{pass: 1, execution: 2},
		]);
	});

	it('a persistent block across ALL M fresh contexts routes the last verdict', async () => {
		seedCandidate('child');
		const gate = scriptedGate([
			{
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'persistently unclear'}],
				decompositionUnclear: {questions: ['unanswerable']},
			},
		]);
		const result = await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate,
			taskerLoopMax: 1,
			executions: 2,
		});
		expect(result.outcome).toBe('decomposition-unclear');
		expect(result.executions).toBe(2);
		// 1 pass × 2 executions = 2 total passes (never an infinite loop).
		expect(result.passes).toBe(2);
	});

	it('degenerate M=1 is exactly one loop', async () => {
		seedCandidate('child');
		const calls: Array<{pass: number; execution: number}> = [];
		await runTaskReviewLoop({
			slug: 'it',
			cwd,
			gate: scriptedGate([{verdict: 'approve', findings: []}], calls),
			taskerLoopMax: 3,
			executions: 1,
		});
		expect(calls).toEqual([{pass: 1, execution: 1}]);
	});
});

describe('parseTaskReviewVerdict — reads the agent verdict (incl. edits + routing)', () => {
	it('parses a verdict embedded in surrounding prose / a fence', async () => {
		const output = [
			'Here is my review:',
			'```json',
			JSON.stringify({
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'q', context: 'c'}],
				edits: [{path: 'work/tasks/backlog/x.md', content: 'new'}],
				uncertainTasks: [
					{path: 'work/tasks/backlog/y.md', questions: ['why?']},
				],
				decompositionUnclear: {questions: ['whole?']},
			}),
			'```',
		].join('\n');
		const v = parseTaskReviewVerdict(output);
		expect(v.verdict).toBe('block');
		expect(v.findings).toEqual([
			{severity: 'blocking', question: 'q', context: 'c'},
		]);
		expect(v.edits).toEqual([
			{path: 'work/tasks/backlog/x.md', content: 'new'},
		]);
		expect(v.uncertainTasks).toEqual([
			{path: 'work/tasks/backlog/y.md', questions: ['why?']},
		]);
		expect(v.decompositionUnclear).toEqual({questions: ['whole?']});
	});

	it('throws when there is no parseable verdict (never a silent approve)', () => {
		expect(() => parseTaskReviewVerdict('no json here')).toThrow();
	});

	it('throws on a verdict that is not approve/block', () => {
		expect(() =>
			parseTaskReviewVerdict('{"verdict": "maybe", "findings": []}'),
		).toThrow();
	});
});

describe('buildTaskReviewPrompt — frames the artifact + the output shape', () => {
	it('names the candidate slices, the destination check, and the JSON shape', () => {
		const prompt = buildTaskReviewPrompt({
			slug: 'it',
			cwd: '/tmp/x',
			candidateTasks: ['work/tasks/backlog/child.md'],
			pass: 1,
			execution: 1,
		});
		expect(prompt).toMatch(/review.*skill/i);
		expect(prompt).toMatch(/DESTINATION CHECK/);
		// The candidate-task path is echoed verbatim from `candidateTasks` (the new
		// `tasks/backlog` staging path). The prompt's PROSE folder mentions (e.g. the
		// `work/tasks/backlog/<slug>.md` template hints) are CLI/prompt prose owned by
		// the vocabulary-cutover sibling task, not this notes/tasks path flip.
		expect(prompt).toMatch(/work\/tasks\/backlog\/child\.md/);
		expect(prompt).toMatch(/"verdict"/);
		expect(prompt).toMatch(/"edits"/);
		// The loop is framed as an IMPROVER, not a one-shot gate.
		expect(prompt).toMatch(/loop, not a one-shot gate/);
	});

	it('explicitly NAMES the whole-SET lenses (graph coherence / gaps / overlap / goal-composition)', () => {
		const prompt = buildTaskReviewPrompt({
			slug: 'it',
			cwd: '/tmp/x',
			candidateTasks: ['work/tasks/backlog/child.md'],
			pass: 1,
			execution: 1,
		});
		// US #3 of tasking-coherence: the set-level lens must be NAMED, not only
		// implied by the destination check.
		expect(prompt).toMatch(/WHOLE SET/);
		expect(prompt).toMatch(/graph coherence/i);
		expect(prompt).toMatch(/gaps/i);
		expect(prompt).toMatch(/overlap/i);
		expect(prompt).toMatch(/goal-composition/i);
	});
});
