import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {
	performTaskingPhase,
	type TaskingPhaseOptions,
} from '../src/ci-phase-tasking.js';
import {activateProcessPhase} from '../src/phase-recorder.js';
import type {LockOutputs} from '../src/ci-lock-outputs.js';
import type {GithubApiGet} from '../src/ci-agent-result.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import type {ReviewProvider} from '../src/integrator.js';
import type {ReviewVerdict} from '../src/review-gate.js';
import type {Phase} from '../src/phase.js';
import {git} from '../src/git.js';
import {
	ciPhaseEnv,
	isolatePiAgentDir,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The tasking path split into the three CI phases (task `ci-split-tasking`).
 * The apply job treats the agent job's handoff as HOSTILE and never takes a
 * bundle: it re-commits only validated candidate files (the path derived from a
 * safe slug under `work/tasks/backlog/`, new relative to `baseSha`, a
 * frontmatter that parses, the origin stamp overwritten with the spec's at
 * `baseSha`) and a trimmed spec body whose gate keys and required headings
 * match the spec at `baseSha`. These tests run each phase in-process against a
 * bare arbiter; the three-process run is `ci-phase-tasking-e2e.test.ts`.
 */

const SLUG = 'big-spec';
const ITEM = `spec:${SLUG}`;
const SPEC_REL = `work/specs/ready/${SLUG}.md`;
const TASKED_REL = `work/specs/tasked/${SLUG}.md`;

const SPEC_FRONTMATTER = [
	'---',
	'title: Big spec',
	`slug: ${SLUG}`,
	'origin: issue',
	'originTrust: untrusted',
	'issue: 42',
	'taskedAfter: []',
	'---',
];
const SPEC_DURABLE = [
	'',
	'## Problem Statement',
	'',
	'A problem.',
	'',
	'## Solution',
	'',
	'A solution.',
	'',
	'## User Stories',
	'',
	'1. As a user, I want it.',
	'',
];
const SPEC = [
	...SPEC_FRONTMATTER,
	...SPEC_DURABLE,
	'## Implementation Decisions',
	'',
	'Detail the tasker trims.',
	'',
].join('\n');
/** The spec trimmed to its durable framing (what an honest tasker lands). */
const TRIMMED = [
	...SPEC_FRONTMATTER,
	...SPEC_DURABLE,
	'Detail moved to the tasks.',
	'',
].join('\n');

function task(slug: string, extraFrontmatter: string[] = []): string {
	return [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		`spec: ${SLUG}`,
		...extraFrontmatter,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		'thing',
		'',
		'## Prompt',
		'',
		'> build it',
		'',
	].join('\n');
}

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;
let providerLog: string;
let restorePi: () => void;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: ciPhaseEnv()}).trim();
}

function arbiterRefs(): string {
	return g(seeded.arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function showOnArbiter(spec: string): string | undefined {
	try {
		return git(['show', spec], seeded.arbiter, {env: ciPhaseEnv()});
	} catch {
		return undefined;
	}
}

function lockRefOnArbiter(): string | undefined {
	try {
		return g(
			seeded.arbiter,
			'rev-parse',
			'--verify',
			`refs/dorfl/lock/spec-${SLUG}`,
		);
	} catch {
		return undefined;
	}
}

function providerCalls(): {method: string; [k: string]: unknown}[] {
	if (!existsSync(providerLog)) return [];
	return readFileSync(providerLog, 'utf8')
		.split('\n')
		.filter((l) => l !== '')
		.map((l) => JSON.parse(l));
}

function stubProvider(): ReviewProvider {
	const record = (method: string, input: object): void => {
		const {env: _env, ...rest} = input as {env?: unknown};
		appendFileSync(providerLog, JSON.stringify({method, ...rest}) + '\n');
	};
	return {
		name: 'github',
		async openRequest(input) {
			record('openRequest', input);
			return {
				opened: true,
				instruction: 'opened',
				url: 'https://github.example/o/r/pull/1',
			};
		},
		postPRComment(input) {
			record('postPRComment', input);
			return {posted: true, instruction: 'commented'};
		},
		postPRCommentOnBranch(input) {
			record('postPRCommentOnBranch', input);
			return {posted: true, instruction: 'commented'};
		},
		async closeRequestOnBranch(input) {
			record('closeRequestOnBranch', input);
			return {closed: true, instruction: 'closed'};
		},
	};
}

async function inPhase<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
	const restore = activateProcessPhase(phase);
	try {
		return await fn();
	} finally {
		restore();
	}
}

function base(
	phase: Phase,
	cwd: string,
	extra: Partial<TaskingPhaseOptions> = {},
): TaskingPhaseOptions {
	return {
		phase,
		verb: 'do',
		arg: ITEM,
		cwd,
		arbiter: 'origin',
		integration: 'merge',
		mergeJitterMs: 0,
		providerInstance: stubProvider(),
		env: ciPhaseEnv(),
		...extra,
	};
}

/** Run the lock phase in-process and return its outputs. */
async function lock(): Promise<LockOutputs> {
	const r = await inPhase('lock', () =>
		performTaskingPhase(base('lock', seeded.clone('lock'))),
	);
	expect(r.outcome, r.message).toBe('locked');
	return r.lockOutputs!;
}

/** Write a raw `handoff.json` (bypassing the writer, as a hostile agent job could). */
function rawHandoff(
	products: Record<string, unknown>,
	kind = 'tasking-land',
): string {
	const dir = join(runnerTemp, 'handoff');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'handoff.json'),
		JSON.stringify({schema: 1, item: ITEM, intent: {kind}, products}),
	);
	return dir;
}

function land(
	candidates: Record<string, string>,
	extra: Record<string, unknown> = {},
): string {
	return rawHandoff({candidates, prBody: 'tasks', specBody: TRIMMED, ...extra});
}

async function apply(
	lockOutputs: LockOutputs,
	extra: Partial<TaskingPhaseOptions> = {},
) {
	const notes: string[] = [];
	const r = await inPhase('apply', () =>
		performTaskingPhase(
			base('apply', seeded.clone('apply'), {
				lockOutputs,
				handoffDir: join(runnerTemp, 'handoff'),
				runnerTemp,
				agentResult: 'success',
				note: (m) => notes.push(m),
				...extra,
			}),
		),
	);
	return {...r, notes};
}

/** The spec was surfaced to needs-attention (on main) and nothing landed. */
function expectSurfacedNothingLanded(): void {
	const spec = showOnArbiter(`main:${SPEC_REL}`);
	expect(spec, 'the spec stays in specs/ready').toBeDefined();
	expect(parseFrontmatter(spec as string).needsAnswers).toBe(true);
	expect(showOnArbiter(`main:${TASKED_REL}`)).toBeUndefined();
	expect(lockRefOnArbiter()).toBeUndefined();
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-tasking-');
	restorePi = isolatePiAgentDir(scratch.root);
	seeded = seedRepoWithArbiter(scratch.root, [], {staged: ['old-task']});
	mkdirSync(join(seeded.repo, 'work', 'specs', 'ready'), {recursive: true});
	writeFileSync(join(seeded.repo, SPEC_REL), SPEC);
	g(seeded.repo, 'add', '-A');
	g(seeded.repo, 'commit', '-q', '-m', 'spec');
	g(seeded.repo, 'push', '-q', 'arbiter', 'main');
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
	providerLog = join(scratch.root, 'provider.log');
});

afterEach(() => {
	restorePi();
	scratch.cleanup();
});

describe('apply: a hostile tasking handoff (RED first)', () => {
	it.each([
		['../ready/evil', 'work/tasks/ready/evil.md'],
		['../../../evil-root', 'evil-root.md'],
		['work/tasks/ready/evil', 'work/tasks/backlog/work/tasks/ready/evil.md'],
	])(
		'a candidate outside work/tasks/backlog/ (%s) is rejected and nothing lands',
		async (key, landedPath) => {
			const held = await lock();
			land({[key]: task('evil')});
			const r = await apply(held);
			expect(r.outcome, r.message).toBe('rejected');
			expect(r.exitCode).toBe(1);
			expect(showOnArbiter(`main:${landedPath}`)).toBeUndefined();
			expect(showOnArbiter('main:work/tasks/ready/evil.md')).toBeUndefined();
			expectSurfacedNothingLanded();
		},
		60_000,
	);

	it("a candidate that sets its own originTrust lands under the spec's stamp", async () => {
		const held = await lock();
		land({
			'child-a': task('child-a', ['origin: human', 'originTrust: trusted']),
		});
		const r = await apply(held);
		expect(r.outcome, r.message).toBe('landed');
		const doc = showOnArbiter('main:work/tasks/backlog/child-a.md') as string;
		expect(parseFrontmatter(doc).originTrust).toBe('untrusted');
		expect(parseFrontmatter(doc).origin).toBe('issue');
		expect(doc.match(/^originTrust:/gm)).toHaveLength(1);
		expect(doc.match(/^origin:/gm)).toHaveLength(1);
	}, 60_000);

	it('a candidate that repeats originTrust: trusted cannot launder the stamp', async () => {
		const held = await lock();
		land({
			'child-a': task('child-a', [
				'originTrust: trusted',
				'originTrust: trusted',
			]),
		});
		const r = await apply(held);
		const doc = showOnArbiter('main:work/tasks/backlog/child-a.md');
		if (doc !== undefined) {
			expect(parseFrontmatter(doc).originTrust).toBe('untrusted');
			expect(doc.match(/^originTrust:/gm)).toHaveLength(1);
		} else {
			expect(r.outcome, r.message).toBe('rejected');
		}
	}, 60_000);

	it.each([
		[
			'an unclosed frontmatter fence',
			'---\ntitle: evil\nslug: evil\noriginTrust: trusted\n\n## Prompt\n\n> x\n',
		],
		['no frontmatter at all', '## What to build\n\nthing\n'],
		[
			'a needsAnswers that is not a boolean',
			task('evil', ['needsAnswers: maybe']),
		],
		['a humanOnly that is not a boolean', task('evil', ['humanOnly: yes'])],
	])(
		'a candidate whose frontmatter does not parse (%s) is rejected',
		async (_what, content) => {
			const held = await lock();
			land({evil: content});
			const r = await apply(held);
			expect(r.outcome, r.message).toBe('rejected');
			expect(showOnArbiter('main:work/tasks/backlog/evil.md')).toBeUndefined();
			expectSurfacedNothingLanded();
		},
		60_000,
	);

	it('an edit to a pre-existing staged task this run did not produce is rejected', async () => {
		const held = await lock();
		const before = showOnArbiter('main:work/tasks/backlog/old-task.md');
		expect(before).toBeDefined();
		land({
			'child-a': task('child-a'),
			'old-task': task('old-task', ['humanOnly: false']),
		});
		const r = await apply(held);
		expect(r.outcome, r.message).toBe('rejected');
		expect(showOnArbiter('main:work/tasks/backlog/old-task.md')).toBe(before);
		expect(showOnArbiter('main:work/tasks/backlog/child-a.md')).toBeUndefined();
		expectSurfacedNothingLanded();
	}, 60_000);

	it.each([
		[
			'flips originTrust',
			TRIMMED.replace('originTrust: untrusted', 'originTrust: trusted'),
		],
		['drops the origin stamp', TRIMMED.replace('origin: issue\n', '')],
		[
			'adds needsAnswers',
			TRIMMED.replace(
				'taskedAfter: []',
				'taskedAfter: []\nneedsAnswers: false',
			),
		],
		[
			'changes taskedAfter',
			TRIMMED.replace('taskedAfter: []', 'taskedAfter: [x]'),
		],
		['changes issue', TRIMMED.replace('issue: 42', 'issue: 43')],
		[
			'repeats humanOnly',
			TRIMMED.replace(
				'issue: 42',
				'issue: 42\nhumanOnly: true\nhumanOnly: false',
			),
		],
		[
			'drops the User Stories heading',
			TRIMMED.replace('## User Stories', 'Stories'),
		],
		['drops the Solution heading', TRIMMED.replace('## Solution\n', '')],
		[
			'has no frontmatter',
			TRIMMED.slice(TRIMMED.indexOf('\n## Problem Statement')),
		],
	])(
		'a trimmed spec body that %s is rejected',
		async (_what, specBody) => {
			const held = await lock();
			land({'child-a': task('child-a')}, {specBody});
			const r = await apply(held);
			expect(r.outcome, r.message).toBe('rejected');
			expect(
				showOnArbiter('main:work/tasks/backlog/child-a.md'),
			).toBeUndefined();
			expectSurfacedNothingLanded();
		},
		60_000,
	);

	it('a tasking-land carrying a blocked review verdict is rejected', async () => {
		const held = await lock();
		land({'child-a': task('child-a')}, {reviewVerdict: 'block'});
		const r = await apply(held);
		expect(r.outcome, r.message).toBe('rejected');
		expectSurfacedNothingLanded();
	}, 60_000);
});

describe('apply: a valid tasking handoff', () => {
	it('merge: lands the checked candidates and the trimmed spec in the tasked folder, then releases the lock', async () => {
		const held = await lock();
		land({'child-a': task('child-a'), 'child-b': task('child-b')});
		const r = await apply(held);
		expect(r.outcome, r.message).toBe('landed');
		expect(r.exitCode).toBe(0);
		expect(r.emitted).toEqual([
			'work/tasks/backlog/child-a.md',
			'work/tasks/backlog/child-b.md',
		]);
		const a = showOnArbiter('main:work/tasks/backlog/child-a.md') as string;
		expect(parseFrontmatter(a).originTrust).toBe('untrusted');
		expect(showOnArbiter(`main:${TASKED_REL}`)).toBe(TRIMMED);
		expect(showOnArbiter(`main:${SPEC_REL}`)).toBeUndefined();
		expect(lockRefOnArbiter()).toBeUndefined();
		// One commit carries the whole transition.
		const files = g(
			seeded.arbiter,
			'show',
			'--no-renames',
			'--name-status',
			'--format=',
			'main',
		).split('\n');
		expect(files.sort()).toEqual(
			[
				'A\twork/tasks/backlog/child-a.md',
				'A\twork/tasks/backlog/child-b.md',
				`D\t${SPEC_REL}`,
				`A\t${TASKED_REL}`,
			].sort(),
		);
	}, 60_000);

	it('propose: pushes the branch, opens the PR with the review prose, keeps the lock held', async () => {
		const held = await lock();
		const mainBefore = g(seeded.arbiter, 'rev-parse', 'main');
		land(
			{'child-a': task('child-a')},
			{reviewVerdict: 'approve', reviewProse: 'The set is coherent.'},
		);
		const r = await apply(held, {integration: 'propose'});
		expect(r.outcome, r.message).toBe('proposed');
		expect(g(seeded.arbiter, 'rev-parse', 'main')).toBe(mainBefore);
		expect(
			showOnArbiter('work/spec-big-spec:work/tasks/backlog/child-a.md'),
		).toBeDefined();
		expect(lockRefOnArbiter()).toBe(held.lockSha);
		const calls = providerCalls();
		expect(calls.map((c) => c.method)).toContain('openRequest');
		expect(JSON.stringify(calls)).toContain('The set is coherent.');
	}, 60_000);

	it('tasking-surface: saves the checked candidates on the work branch and surfaces the spec', async () => {
		const held = await lock();
		rawHandoff(
			{
				candidates: {'child-a': task('child-a')},
				reason: 'The review leg failed; recover the candidates.',
			},
			'tasking-surface',
		);
		const r = await apply(held);
		expect(r.outcome, r.message).toBe('surfaced');
		expect(r.exitCode).toBe(0);
		const saved = showOnArbiter(
			'work/spec-big-spec:work/tasks/backlog/child-a.md',
		) as string;
		expect(saved).toBeDefined();
		expect(parseFrontmatter(saved).originTrust).toBe('untrusted');
		expect(showOnArbiter('main:work/tasks/backlog/child-a.md')).toBeUndefined();
		expectSurfacedNothingLanded();
	}, 60_000);

	it('refuses to write when the lock is no longer the lock job', async () => {
		const held = await lock();
		land({'child-a': task('child-a')});
		const before = arbiterRefs();
		const r = await apply({...held, lockSha: '0'.repeat(40)});
		expect(r.outcome).toBe('stale-lock');
		expect(arbiterRefs()).toBe(before);
	}, 60_000);
});

describe('apply: the agent job did not succeed', () => {
	/** A stub Actions API: the agent job ran `minutes`, with no annotations. */
	function actionsApi(minutes: number): GithubApiGet {
		const start = Date.parse('2026-09-27T10:00:00Z');
		return async (url) => {
			if (url.includes('/jobs')) {
				return {
					status: 200,
					body: {
						jobs: [
							{
								id: 2,
								name: 'item / agent',
								started_at: new Date(start).toISOString(),
								completed_at: new Date(start + minutes * 60_000).toISOString(),
							},
						],
					},
				};
			}
			if (url.includes('/annotations')) return {status: 200, body: []};
			return {status: 404, body: {}};
		};
	}
	const actionsEnv = {
		...ciPhaseEnv(),
		GITHUB_REPOSITORY: 'o/r',
		GITHUB_RUN_ID: '77',
		GITHUB_RUN_ATTEMPT: '1',
	};

	it('failure surfaces the spec without reading the handoff', async () => {
		const held = await lock();
		land({'child-a': task('child-a')});
		const r = await apply(held, {agentResult: 'failure'});
		expect(r.outcome, r.message).toBe('surfaced');
		expect(showOnArbiter('main:work/tasks/backlog/child-a.md')).toBeUndefined();
		expectSurfacedNothingLanded();
	}, 60_000);

	it('a timeout (cancelled at the time limit) surfaces the spec', async () => {
		const held = await lock();
		const r = await apply(held, {
			agentResult: 'cancelled',
			agentTimeoutMinutes: 90,
			actionsApi: actionsApi(90),
			env: actionsEnv,
		});
		expect(r.outcome, r.message).toBe('surfaced');
		expectSurfacedNothingLanded();
	}, 60_000);

	it('a real cancel only releases the tasking lock', async () => {
		const held = await lock();
		const r = await apply(held, {
			agentResult: 'cancelled',
			agentTimeoutMinutes: 90,
			actionsApi: actionsApi(3),
			env: actionsEnv,
		});
		expect(r.outcome, r.message).toBe('released');
		expect(lockRefOnArbiter()).toBeUndefined();
		const spec = showOnArbiter(`main:${SPEC_REL}`) as string;
		expect(spec).toBe(SPEC);
	}, 60_000);
});

describe('agent phase', () => {
	/** A tasker agent that writes the given candidate files and trims the spec. */
	function tasker(files: Record<string, string>, ok = true) {
		return ({cwd}: {cwd: string}) => {
			for (const [slug, content] of Object.entries(files)) {
				const abs = join(cwd, 'work', 'tasks', 'backlog', `${slug}.md`);
				mkdirSync(dirname(abs), {recursive: true});
				writeFileSync(abs, content);
			}
			writeFileSync(join(cwd, SPEC_REL), TRIMMED);
			return ok ? {ok: true} : {ok: false, detail: 'model API overloaded'};
		};
	}

	async function agent(held: LockOutputs, extra: Partial<TaskingPhaseOptions>) {
		const cwd = seeded.clone('agent');
		// The agent job's token cannot push.
		g(cwd, 'remote', 'set-url', '--push', 'origin', '/nonexistent.git');
		return inPhase('agent', () =>
			performTaskingPhase(
				base('agent', cwd, {
					lockOutputs: held,
					handoffDir: join(runnerTemp, 'handoff'),
					...extra,
				}),
			),
		);
	}

	function handoff(): {
		intent: {kind: string};
		products: Record<string, unknown>;
	} {
		return JSON.parse(
			readFileSync(join(runnerTemp, 'handoff', 'handoff.json'), 'utf8'),
		);
	}

	it('runs the task-set review, writes nothing, and hands over tasking-land', async () => {
		const held = await lock();
		const before = arbiterRefs();
		const reviewed: string[] = [];
		const r = await agent(held, {
			dorfl: tasker({'child-a': task('child-a')}),
			review: true,
			taskReviewGate: async (input) => {
				reviewed.push(input.cwd);
				return {verdict: 'approve', findings: [], review: 'Coherent.'};
			},
		});
		expect(r.outcome, r.message).toBe('handed-over');
		expect(r.intent).toBe('tasking-land');
		expect(reviewed).toHaveLength(1);
		expect(arbiterRefs()).toBe(before);
		const h = handoff();
		expect(h.products.candidates).toEqual({'child-a': task('child-a')});
		expect(h.products.reviewVerdict).toBe('approve');
		expect(h.products.reviewProse).toBe('Coherent.');
		expect(h.products.specBody).toBe(TRIMMED);

		// The apply phase lands it.
		const a = await apply(held);
		expect(a.outcome, a.message).toBe('landed');
		expect(showOnArbiter(`main:${TASKED_REL}`)).toBe(TRIMMED);
	}, 60_000);

	it('a task-set review block is handed over as tasking-surface and surfaces the spec', async () => {
		const held = await lock();
		const before = arbiterRefs();
		const block: ReviewVerdict = {
			verdict: 'block',
			findings: [
				{
					severity: 'blocking',
					question: 'the set leaves a coverage gap',
					context: 'work/tasks/backlog/child-a.md',
				},
			],
		};
		const r = await agent(held, {
			dorfl: tasker({'child-a': task('child-a')}),
			review: true,
			taskReviewGate: async () => block,
		});
		expect(r.outcome, r.message).toBe('handed-over');
		expect(r.intent).toBe('tasking-surface');
		expect(arbiterRefs()).toBe(before);
		expect(String(handoff().products.reason)).toContain(
			'the set leaves a coverage gap',
		);

		const a = await apply(held);
		expect(a.outcome, a.message).toBe('surfaced');
		expectSurfacedNothingLanded();
	}, 60_000);

	it('a tasker failure writes no handoff and fails the job; the apply surfaces the spec', async () => {
		const held = await lock();
		const before = arbiterRefs();
		const r = await agent(held, {
			dorfl: tasker({'child-a': task('child-a')}, false),
		});
		expect(r.outcome).toBe('agent-failed');
		expect(r.exitCode).toBe(1);
		expect(r.message).toContain('model API overloaded');
		expect(arbiterRefs()).toBe(before);
		const dir = join(runnerTemp, 'handoff');
		expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);

		const a = await apply(held, {agentResult: 'failure'});
		expect(a.outcome, a.message).toBe('surfaced');
		expectSurfacedNothingLanded();
	}, 60_000);

	it('refuses to run when the lock is no longer the lock job', async () => {
		const held = await lock();
		const r = await agent(
			{...held, lockSha: '0'.repeat(40)},
			{dorfl: tasker({'child-a': task('child-a')})},
		);
		expect(r.outcome).toBe('stale-lock');
	}, 60_000);
});

describe('lock phase', () => {
	it('publishes the trusted facts and takes the spec lock', async () => {
		const held = await lock();
		expect(held).toMatchObject({
			acquired: true,
			needsAgent: true,
			rung: 'task-spec',
			baseSha: g(seeded.arbiter, 'rev-parse', 'main'),
		});
		expect(held.lockSha).toBe(lockRefOnArbiter());
	}, 60_000);

	it('backs off when another run holds the lock', async () => {
		await lock();
		const r = await inPhase('lock', () =>
			performTaskingPhase(base('lock', seeded.clone('lock'))),
		);
		expect(r.outcome).toBe('lost');
		expect(r.lockOutputs?.acquired).toBe(false);
	}, 60_000);

	it('refuses a spec the agent gate refuses, before any write', async () => {
		writeFileSync(
			join(seeded.repo, SPEC_REL),
			SPEC.replace('taskedAfter: []', 'taskedAfter: []\nhumanOnly: true'),
		);
		g(seeded.repo, 'commit', '-q', '-am', 'human only');
		g(seeded.repo, 'push', '-q', 'arbiter', 'main');
		const before = arbiterRefs();
		const r = await inPhase('lock', () =>
			performTaskingPhase(base('lock', seeded.clone('lock'))),
		);
		expect(r.outcome).toBe('gate-refused');
		expect(r.lockOutputs?.acquired).toBe(false);
		expect(arbiterRefs()).toBe(before);
	}, 60_000);
});
