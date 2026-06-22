import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {performClaim} from '../src/claim-cas.js';
import {promoteFromPreBacklog} from '../src/needs-attention.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';
import {buildProgram} from '../src/cli.js';

/**
 * STEP A of the staging/pool position gate (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `pre-backlog-staging-folder-and-promote-step-a`; governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * The TRACER proves four things end-to-end against a `--bare file://` arbiter
 * (house pattern via `test/helpers/gitRepo.ts`):
 *
 *   (a) the slicing path's emitted slices land STAGED in `work/tasks/backlog/`,
 *       NOT in `work/tasks/todo/`;
 *   (b) `work/tasks/todo/` STILL means the agent-eligible pool — the claim CAS reads
 *       `work/tasks/todo/` byte-for-byte unchanged and refuses a STAGED slug;
 *   (c) the runner-owned promotion (`promoteFromPreBacklog`) moves the staged
 *       slice `pre-backlog/ → backlog/` on the arbiter and the same slug
 *       becomes claimable;
 *   (d) the agent cannot self-place into the pool — a slicing agent that writes
 *       directly into `work/tasks/todo/` has its writes scrubbed by the
 *       pool-placement fence, so the final arbiter carries nothing in the pool
 *       for that slug (only the legitimately staged file). There is no
 *       agent-facing API that performs the promotion: it is a separate
 *       runner-owned function the slicing path does not call.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('pre-backlog-step-a-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — slice me`,
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
	run('git', ['commit', '-q', '-m', `brief: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one staged slice file under `work/tasks/backlog/`. */
function stagingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'brief: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		return {ok: true};
	};
}

/**
 * A MISBEHAVING agent that writes BOTH:
 *  - a legitimate staged slice under `work/tasks/backlog/<legit>.md`, AND
 *  - a self-placement attempt directly under `work/tasks/todo/<hijack>.md`
 *    (an attempt to self-promote into the agent-eligible pool, PRD US #4 / ADR).
 * The runner's pool-placement fence must scrub the second.
 */
function selfPlacingAgent(legit: string, hijack: string): SliceAgentRunner {
	return ({cwd}) => {
		const staged = join(cwd, 'work', 'tasks', 'backlog');
		mkdirSync(staged, {recursive: true});
		writeFileSync(
			join(staged, `${legit}.md`),
			`---\nslug: ${legit}\nprd: it\n---\n\n## Prompt\n\n> ${legit}\n`,
		);
		const pool = join(cwd, 'work', 'tasks', 'todo');
		mkdirSync(pool, {recursive: true});
		writeFileSync(
			join(pool, `${hijack}.md`),
			`---\nslug: ${hijack}\nprd: it\n---\n\n## Prompt\n\n> hijacked into pool\n`,
		);
		return {ok: true};
	};
}

function onArbiterMain(repo: string, path: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

function showArbiterMain(repo: string, path: string): string {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return run('git', ['show', `${ARBITER}/main:${path}`], repo, {
		env: gitEnv(),
	}).stdout;
}

describe('STEP A — slicer output lands STAGED in pre-backlog/, not backlog/', () => {
	it('a --merge slicing run commits the emitted slice under work/tasks/backlog/ (the pool is untouched)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: stagingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toEqual(['work/tasks/backlog/child.md']);
		// The slice landed in the STAGING folder, not the pool.
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
		// PRD lifecycle move still happens (the staging split is orthogonal).
		expect(onArbiterMain(repo, 'work/briefs/tasked/it.md')).toBe(true);
	});
});

describe('STEP A — work/tasks/todo/ STILL means the agent-eligible pool (readers unchanged)', () => {
	it('a STAGED slug is NOT claimable (the claim CAS reads work/tasks/todo/ only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: stagingAgent('staged-only'),
			env: gitEnv(),
		});
		// The slice is staged on the arbiter…
		expect(onArbiterMain(repo, 'work/tasks/backlog/staged-only.md')).toBe(true);
		// …but the claim CAS (which reads work/tasks/todo/<slug>.md) refuses it: there
		// is no such pool item.
		const claim = await performClaim({
			slug: 'staged-only',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.outcome).not.toBe('claimed');
	});

	it('a slug that IS in work/tasks/todo/ (seeded directly) is claimable (the pool reader is unchanged)', async () => {
		// Seed a slice directly into the pool (modelling something a human / a future
		// promotion has already moved into work/tasks/todo/).
		const {repo} = seedRepoWithArbiter(scratch.root, ['inpool']);
		const claim = await performClaim({
			slug: 'inpool',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.outcome).toBe('claimed');
	});
});

describe('STEP A — the runner-owned promotion makes a staged slice claimable', () => {
	it('promoteFromPreBacklog moves work/tasks/backlog/<slug>.md -> work/tasks/todo/<slug>.md on the arbiter; afterwards the slug claims', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: stagingAgent('to-promote'),
			env: gitEnv(),
		});
		// Precondition: staged, NOT in the pool — and not claimable.
		expect(onArbiterMain(repo, 'work/tasks/backlog/to-promote.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/to-promote.md')).toBe(false);
		const before = await performClaim({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(before.outcome).not.toBe('claimed');

		// PROMOTE (runner-owned).
		const promoted = await promoteFromPreBacklog({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(promoted.moved).toBe(true);
		expect(promoted.commitMessage).toMatch(
			/promote work\/pre-backlog\/ -> work\/backlog\//,
		);

		// Postcondition: in the pool, no longer staged — and now claimable.
		expect(onArbiterMain(repo, 'work/tasks/backlog/to-promote.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasks/todo/to-promote.md')).toBe(true);
		const after = await performClaim({
			slug: 'to-promote',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(after.outcome).toBe('claimed');
	});

	it('promote on a slug not in pre-backlog/ refuses cleanly (no main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await promoteFromPreBacklog({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/not staged|wrong slug|nothing/i);
	});
});

describe('STEP A — the agent cannot self-place into the pool (pool-placement fence)', () => {
	it('an agent that writes work/tasks/todo/<hijack>.md during slicing has its write scrubbed; only work/tasks/backlog/<legit>.md lands', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: selfPlacingAgent('legit', 'hijack'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The legitimate STAGED placement landed (the agent's pre-backlog/ write).
		expect(onArbiterMain(repo, 'work/tasks/backlog/legit.md')).toBe(true);
		// The self-placement attempt did NOT reach the pool: the runner's fence
		// scrubbed the agent's `work/tasks/todo/<hijack>.md` write before the
		// integrate's `git add -A` could land it.
		expect(onArbiterMain(repo, 'work/tasks/todo/hijack.md')).toBe(false);
		// And — crucially — the agent cannot promote the legit slice into the pool
		// either: nothing the slicing path emits puts an item into work/tasks/todo/.
		// The promotion is a separate runner-owned move (`promoteFromPreBacklog`).
		expect(onArbiterMain(repo, 'work/tasks/todo/legit.md')).toBe(false);
	});

	it('a pool-edit attempt (the agent overwrites a PRE-EXISTING pool slice during slicing) is also reverted (HEAD content preserved)', async () => {
		// Seed a pool slice on the arbiter first.
		const {repo} = seedRepoWithArbiter(scratch.root, ['poolitem']);
		const poolBefore = showArbiterMain(repo, 'work/tasks/todo/poolitem.md');
		seedPrd(repo, 'it');
		// Agent writes a legit staged slice AND tampers with the pre-existing pool slice.
		const tamperingAgent: SliceAgentRunner = ({cwd}) => {
			const staged = join(cwd, 'work', 'tasks', 'backlog');
			mkdirSync(staged, {recursive: true});
			writeFileSync(
				join(staged, 'fresh.md'),
				'---\nslug: fresh\nprd: it\n---\n\n## Prompt\n\n> fresh\n',
			);
			writeFileSync(
				join(cwd, 'work', 'tasks', 'todo', 'poolitem.md'),
				'TAMPERED CONTENT',
			);
			return {ok: true};
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			agentRunner: tamperingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The pre-existing pool slice is BYTE-FOR-BYTE unchanged on the arbiter.
		expect(showArbiterMain(repo, 'work/tasks/todo/poolitem.md')).toBe(
			poolBefore,
		);
		// The legitimately staged slice landed.
		expect(onArbiterMain(repo, 'work/tasks/backlog/fresh.md')).toBe(true);
	});
});

/**
 * THE CLI WIRE (the Gate-2 block this slice was bounced for, now closed). The
 * resolver + the `performSlice` options + the per-repo/env config keys all worked
 * in isolation, but `config.tasksLandIn` and the `--tasks-land-in` flag were
 * NEVER threaded from `cli.ts` into the `DoOptions` the `do brief:` path builds, so
 * the configured-default + explicit-flag rungs were dead from the shipped binary
 * (a user setting `tasksLandIn: 'todo'` saw the built-in `pre-backlog` floor).
 * These tests drive the REAL `buildProgram()` `do brief:` path end-to-end on a
 * `--bare file://` arbiter, with the slicer STUBBED by a trivial `agentCmd` bash
 * command (the null harness shells `bash -c <agentCmd>` in the worktree), and
 * assert the configured / flag-chosen placement ACTUALLY reaches the runner.
 */
// A trivial slicer the NULL harness shells (`bash -c <agentCmd>` in the worktree):
// it writes ONE staged slice under `work/tasks/backlog/`. `agentCmd` is a HOST-ONLY
// key (a repo's `.agent-runner.json` may NOT dictate the command the runner
// shells out to), so it is passed via the `--agent-cmd` FLAG, not the repo config.
const STUB_SLICER_AGENT_CMD =
	"mkdir -p work/tasks/backlog && printf '%s\\n' '---' 'title: child' " +
	"'slug: child' 'brief: it' '---' '' '## Prompt' '' '> build it' " +
	'> work/tasks/backlog/child.md';

/** Write a per-repo `.agent-runner.json` (the `tasksLandIn` default under test) + push it. */
function writeRepoConfig(repo: string, config: Record<string, unknown>): void {
	writeFileSync(
		join(repo, '.agent-runner.json'),
		JSON.stringify(config, null, 2),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', 'config'], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/**
 * Drive the REAL `do` command through `buildProgram()` from inside `repo`, with
 * the null harness + the stub slicer supplied as FLAGS (host-only). Intercepts
 * the `do` action's `process.exit` (the established CLI-test idiom, see
 * do-isolated.test.ts) and captures the exit code + stderr. A throw BEFORE the
 * exit (a usage error, e.g. a bad `--slices-land-in`) leaves `code` undefined and
 * is surfaced in `captured`.
 */
async function runDo(
	repo: string,
	args: string[],
): Promise<{captured: string; code: number | undefined}> {
	const program = buildProgram();
	program.exitOverride();
	let captured = '';
	let code: number | undefined;
	const origErr = console.error;
	const origExit = process.exit;
	const origCwd = process.cwd();
	console.error = (msg?: unknown) => {
		captured += String(msg ?? '') + '\n';
	};
	(process as {exit: unknown}).exit = ((c?: number) => {
		code = c ?? 0;
		throw new Error(`__exit__:${code}`);
	}) as typeof process.exit;
	process.chdir(repo);
	try {
		await program.parseAsync([
			'node',
			'agent-runner',
			'do',
			'--harness',
			'null',
			'--agent-cmd',
			STUB_SLICER_AGENT_CMD,
			// Skip the tasker IMPROVER loop + the task-SET acceptance gate: both would
			// launch the stub as a REVIEW agent and try to parse a JSON verdict (the
			// trivial tasker emits none). This test exercises the PLACEMENT wire, not the
			// quality gates — `--no-review` + `--no-tasker-loop` keep it to the tasker +
			// integrate path.
			'--no-tasker-loop',
			...args,
		]);
	} catch (err) {
		// The exit shim (or commander exitOverride) throws — code captured above. A
		// usage error thrown BEFORE the exit (e.g. a bad `--tasks-land-in`) carries
		// its message on the thrown error itself, not via console.error; fold it into
		// `captured` so the caller can assert on it (skip our own `__exit__:` marker).
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.startsWith('__exit__:')) {
			captured += msg + '\n';
		}
	} finally {
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {captured, code};
}

describe('STEP 2 — the CLI threads tasksLandIn from config/flag into the slicer (the wire)', () => {
	it('a per-repo `tasksLandIn: todo` reaches performSlice via `do brief:` (slice lands in the POOL, not pre-backlog/)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		// The key under test: a per-repo configured default of `todo` (the pool).
		writeRepoConfig(repo, {autoTask: true, tasksLandIn: 'todo'});
		const {code, captured} = await runDo(repo, [
			'brief:it',
			'--arbiter',
			ARBITER,
			'--merge',
			'--no-review',
		]);
		expect(code, captured).toBe(0);
		// The configured default REACHED the slicer: the slice landed in the POOL.
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
	});

	it('the built-in floor still STAGES when no tasksLandIn is configured (control: proves the case above is the config, not a default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		// No tasksLandIn — the resolver's built-in floor stages.
		writeRepoConfig(repo, {autoTask: true});
		const {code, captured} = await runDo(repo, [
			'brief:it',
			'--arbiter',
			ARBITER,
			'--merge',
			'--no-review',
		]);
		expect(code, captured).toBe(0);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});

	it('the explicit `--tasks-land-in pre-backlog` flag OVERRIDES a `tasksLandIn: todo` config (operator flag wins)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		writeRepoConfig(repo, {autoTask: true, tasksLandIn: 'todo'});
		const {code, captured} = await runDo(repo, [
			'brief:it',
			'--arbiter',
			ARBITER,
			'--merge',
			'--no-review',
			'--tasks-land-in',
			'pre-backlog',
		]);
		expect(code, captured).toBe(0);
		// The flag beat the config: STAGED despite `tasksLandIn: todo`.
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});

	it('`--tasks-land-in <bad>` FAILS LOUDLY (a usage error, never a silent drop)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		writeRepoConfig(repo, {autoTask: true});
		// `explicitTasksLandInFromFlag` throws on a bad value; the action surfaces it
		// as a fatal usage error (a non-zero exit / thrown error), never a silent
		// fall-through to the built-in floor. Assert the run did NOT succeed and
		// nothing was sliced.
		const {code, captured} = await runDo(repo, [
			'brief:it',
			'--arbiter',
			ARBITER,
			'--merge',
			'--tasks-land-in',
			'nonsense',
		]);
		expect(code === undefined || code !== 0).toBe(true);
		expect(captured).toMatch(/tasks-land-in/i);
		expect(onArbiterMain(repo, 'work/tasks/backlog/child.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/tasks/todo/child.md')).toBe(false);
	});
});
