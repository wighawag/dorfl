import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	existsSync,
	readFileSync,
	readdirSync,
} from 'node:fs';
import {join} from 'node:path';
import type {Command} from 'commander';
import {
	performAdvanceIsolated,
	performAdvanceIsolatedAuto,
	performAdvanceIsolatedArgs,
} from '../src/advance-isolated.js';
import type {AdvanceResult} from '../src/advance.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import {mergeConfig} from '../src/config.js';
import {buildProgram} from '../src/cli.js';
import {resolveArbiterUrlFromCheckout} from '../src/do.js';
import {parseSidecar} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `advance --isolated` tests (slice `advance-isolated-one-shot`) — give `advance`
 * the SAME isolation ergonomic `do --isolated` has: run the advance TICK in an
 * ISOLATED worktree off THIS repo's arbiter (resolved from cwd), then integrate +
 * reap, instead of taking over the current checkout. It REUSES `do`'s arbiter
 * resolver + the hub-mirror/job-worktree isolation substrate + the
 * scan/select/refetch SKELETON; the ONLY new code is the advance-specific
 * isolated advance-tick runner + its sequential drivers.
 *
 * House style (mirrors do-isolated.test.ts / advance-surface.test.ts): a throwaway
 * project + a local `--bare` arbiter, a TEMP `workspacesDir` (the agents' area),
 * `isolatePiAgentDir`, stubbed gates/runners (never a real harness), and the
 * `GIT_CONFIG_GLOBAL=/dev/null` isolation from `gitEnv`. Real shared dirs are never
 * touched (everything lives in a temp scratch).
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-isolated-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** The temp agents' execution area for a run (worktrees + mirrors + clones live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

// --- (1) the isolated single-item dispatch ---------------------------------

describe('performAdvanceIsolated — runs the advance tick in an isolated clone off the arbiter', () => {
	it('points the tick cwd at an isolated clone (under workspacesDir), NEVER the checkout, then reaps it', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const arbiterUrl = resolveArbiterUrlFromCheckout(
			repo,
			'arbiter',
			gitEnv(),
		) as string;

		// The checkout starts on `main`; --isolated must NOT take it over.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);

		// Inject the tick runner stub to capture the cwd the tick ran in (and assert
		// the isolated clone, not the checkout). The build/slice rungs are reached via
		// the `doDriver` the runner injects (not exercised here — this asserts the
		// per-item isolation wiring).
		let tickCwd = '';
		let tickArbiter: string | undefined;
		let tickHadDoDriver = false;
		const result = await performAdvanceIsolated({
			arg: 'alpha',
			remote: arbiterUrl,
			workspacesDir: ws,
			env: gitEnv(),
			run: async (opts) => {
				tickCwd = opts.cwd;
				tickArbiter = opts.arbiter;
				tickHadDoDriver = opts.doDriver !== undefined;
				return {
					exitCode: 0,
					outcome: 'advanced',
					slug: 'alpha',
					message: 'ran in isolation',
				};
			},
		});

		expect(result.exitCode).toBe(0);
		// The tick ran in the AGENTS' area (the isolated clone), NOT the checkout.
		expect(tickCwd.startsWith(ws)).toBe(true);
		expect(tickCwd.startsWith(repo)).toBe(false);
		// The build/slice rungs get the injected job-worktree driver (isolation falls
		// out of the seam — no new mechanism).
		expect(tickHadDoDriver).toBe(true);
		// The clone's arbiter remote is `origin` by default (the tree-less rungs' CAS
		// target).
		expect(tickArbiter).toBe('origin');

		// The clone was REAPED (a disposable working tree, like a failed do --isolated).
		expect(existsSync(tickCwd)).toBe(false);
		// The human checkout was NEVER taken over.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);
		void arbiter;
	});

	it('reaps the isolated clone even when the tick FAILS (like a failed do --isolated)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const arbiterUrl = resolveArbiterUrlFromCheckout(
			repo,
			'arbiter',
			gitEnv(),
		) as string;

		let tickCwd = '';
		const result = await performAdvanceIsolated({
			arg: 'alpha',
			remote: arbiterUrl,
			workspacesDir: ws,
			env: gitEnv(),
			run: async (opts) => {
				tickCwd = opts.cwd;
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'boom',
				};
			},
		});
		expect(result.exitCode).toBe(1);
		// Reaped regardless of the failure.
		expect(existsSync(tickCwd)).toBe(false);
	});
});

// --- (6) a surface rung from an isolated cwd persists the sidecar -----------

/**
 * Seed a backlog slice carrying `needsAnswers:true` (no sidecar) onto the arbiter
 * — exactly the `classify=surface` cell. Mirrors advance-surface.test.ts but the
 * item lives on the arbiter (the isolated tick clones it down).
 */
function seedSurfaceFixture(): {repo: string; arbiterUrl: string} {
	const {repo} = seedRepoWithArbiter(scratch.root, ['needsq'], {
		needsAnswers: true,
	});
	const arbiterUrl = resolveArbiterUrlFromCheckout(
		repo,
		'arbiter',
		gitEnv(),
	) as string;
	return {repo, arbiterUrl};
}

describe('advance --isolated surface rung — persists the sidecar to the arbiter (same as in-place)', () => {
	it('a surface from an isolated cwd writes the sidecar + needsAnswers:true in the arbiter-side working tree', async () => {
		const {arbiterUrl} = seedSurfaceFixture();
		const ws = workspacesDir();

		// The `surface-questions` skill JUDGES (emits); the engine PERSISTS — stub it.
		const emit: SurfaceEmit = {
			questions: [
				{question: 'which approach?', context: 'inline ctx'},
				{question: 'what about edge X?'},
			],
		};
		const surfaceGate: SurfaceGate = async () => emit;

		const result = await performAdvanceIsolated({
			arg: 'needsq',
			remote: arbiterUrl,
			workspacesDir: ws,
			env: gitEnv(),
			surfaceGate,
		});

		// The tick ADVANCED (surfaced), not built.
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		expect(result.message).toMatch(/surfaced 2 question/i);

		// The sidecar + the `needsAnswers:true` flip LANDED ON THE ARBITER (the
		// isolated tick committed them in its arbiter-side clone, then the runner
		// ff-pushed the result to the arbiter's main). Read the committed tree from a
		// FRESH clone of the arbiter so this asserts ARBITER-side state, exactly as an
		// in-place tick leaves the sidecar in the participating checkout.
		const reader = join(scratch.root, 'reader');
		gitIn(['clone', '-q', arbiterUrl, reader], scratch.root);
		const sidecarPath = join(reader, 'work', 'questions', 'slice-needsq.md');
		expect(existsSync(sidecarPath)).toBe(true);
		const sidecar = parseSidecar(readFileSync(sidecarPath, 'utf8'));
		expect(sidecar.entries).toHaveLength(2);
		expect(sidecar.entries.map((e) => e.question)).toEqual([
			'which approach?',
			'what about edge X?',
		]);
		// `needsAnswers:true` was set on the item body in the SAME commit (invariant 1).
		const itemBody = readFileSync(
			join(reader, 'work', 'tasks', 'todo', 'needsq.md'),
			'utf8',
		);
		expect(parseFrontmatter(itemBody).needsAnswers).toBe(true);
	});
});

// --- (5) the no-arbiter error ----------------------------------------------

/** Drive argv through the program, intercepting `process.exit` + capturing stderr. */
async function runAdvance(
	argv: string[],
	cwd: string,
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
	process.chdir(cwd);
	try {
		await program.parseAsync(['node', 'agent-runner', 'advance', ...argv]);
	} catch {
		// Our exit shim (or commander exitOverride) throws — captured above.
	} finally {
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {captured, code};
}

function advanceCommand(): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === 'advance');
	if (!cmd) {
		throw new Error("no 'advance' command registered");
	}
	return cmd;
}

describe('advance --isolated — CLI surface + the no-arbiter error', () => {
	it('registers a boolean --isolated option on the advance command', () => {
		const isolated = advanceCommand().options.find(
			(o) => o.long === '--isolated',
		);
		expect(isolated).toBeDefined();
		// Boolean flag (no value placeholder).
		expect(isolated?.required).toBe(false);
		expect(isolated?.optional).toBe(false);
	});

	it('its help reads in its OWN terms (in-place-but-isolated; single/multi/-n; sequential)', () => {
		const desc =
			advanceCommand().options.find((o) => o.long === '--isolated')
				?.description ?? '';
		expect(desc).toMatch(/isolated/i);
		expect(desc).toMatch(/checkout/i);
		expect(desc).toMatch(/-n\/auto-pick/);
		expect(desc).toMatch(/sequential/i);
	});

	it('errors CLEARLY when the cwd has no resolvable arbiter, naming --remote <url>', async () => {
		const plain = join(scratch.root, 'no-arbiter');
		mkdirSync(plain, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], plain);

		const {captured, code} = await runAdvance(['--isolated', 'alpha'], plain);
		expect(code).toBe(1);
		expect(captured).toMatch(/--isolated/);
		expect(captured).toMatch(/--remote <url>/);
		expect(captured).not.toMatch(/parse|ENOENT|clone failed/i);
	});
});

/** A hermetic config: a SCRATCH workspacesDir + NO agentCmd (the guard fires
 * deterministically, proving the ISOLATED branch was reached, regardless of any
 * developer/CI global config). */
function hermeticConfig(extra: Record<string, unknown> = {}): string {
	const cfg = join(
		scratch.root,
		`hermetic-${Math.random().toString(36).slice(2)}.json`,
	);
	writeFileSync(
		cfg,
		JSON.stringify({
			workspacesDir: join(scratch.root, 'agents-area'),
			...extra,
		}) + '\n',
	);
	return cfg;
}

describe('advance --isolated — CLI dispatch reaches the ISOLATED branch (not in-place)', () => {
	it('`advance --isolated -n <x>` reaches the mirror-side auto-pick path (calm-at-rest exit 0)', async () => {
		// `autoBuild`/`surfaceBlockers` off (defaults) ⇒ the mirror scan selects NOTHING
		// — a clean exit 0 ("nothing eligible to advance on the remote"), proving the
		// isolated MIRROR-SIDE auto-pick path ran (NOT the in-place driver, which would
		// scan the cwd checkout + word its empty message differently). A dummy agentCmd
		// gets past the isolated branch's agentCmd guard so the scan actually runs.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const {captured, code} = await runAdvance(
			[
				'--isolated',
				'-n',
				'2',
				'--arbiter',
				'arbiter',
				'--config',
				hermeticConfig({agentCmd: 'true'}),
			],
			repo,
		);
		expect(code).toBe(0);
		// The mirror-side driver's empty-pool wording (distinct from the in-place one).
		expect(captured).toMatch(/nothing eligible to advance on the remote/i);
		// The human checkout was never taken over.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);
	});

	it('`advance --isolated <slug>` (single) reaches the isolated branch — the agentCmd guard fires before any in-place takeover', async () => {
		// A ready slice on the arbiter; with NO agentCmd the isolated branch errors via
		// the agentCmd guard (the ISOLATED branch's guard) BEFORE building — proving the
		// dispatch reached the isolated runner, not the in-place tick.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {captured, code} = await runAdvance(
			[
				'--isolated',
				'alpha',
				'--arbiter',
				'arbiter',
				'--config',
				hermeticConfig(),
			],
			repo,
		);
		expect(code).toBe(1);
		expect(captured).toMatch(/agentCmd/);
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);
	});
});

// --- (3) the isolated -n / auto-pick path (mirror-side scan, refetch-per-item) ---

describe('advance --isolated -n — sequential auto-pick over the mirror-side pool (refetch freshness)', () => {
	// SNAPSHOT-ONCE PARITY with `do --isolated -n`: the pool is scanned + selected
	// ONCE up front; the loop iterates the FROZEN set. We use TWO INDEPENDENT items
	// (NOT a `blockedBy` chain) so this proves REFETCH FRESHNESS (item N's clone
	// branches off a `main` containing item N-1's surface), NOT dependency-aware
	// scheduling (deliberately out of scope). `surfaceBlockers` ON enumerates the two
	// needsAnswers slices into the surface pool; the stubbed surface gate makes the
	// rung tree-less + observable.
	it('drains TWO independent needsAnswers items in SEQUENCE, item 2 fresh off item 1', async () => {
		const {repo, arbiterUrl} = seedTwoIndependentBlocked();
		const ws = workspacesDir();

		const emit: SurfaceEmit = {questions: [{question: 'q?'}]};
		const surfaceGate: SurfaceGate = async () => emit;

		const multi = await performAdvanceIsolatedAuto({
			remote: arbiterUrl,
			workspacesDir: ws,
			config: mergeConfig({surfaceBlockers: true}),
			count: 2,
			surfaceGate,
			env: gitEnv(),
			lifecycleGates: {surface: true},
		});

		expect(multi.exitCode).toBe(0);
		expect(multi.results).toHaveLength(2);
		expect(multi.results.every((r) => r.rung === 'surface')).toBe(true);
		// Two DISTINCT items advanced (a genuine drain of both, not one twice).
		const slugs = multi.results.map((r) => r.slug).sort();
		expect(slugs).toEqual(['ia', 'ib']);

		// FRESHNESS / sequential-refetch: BOTH sidecars LANDED on the arbiter. Item 1's
		// surface ff-pushed item 1's sidecar; item 2 then re-`ensureMirror`s + refetches
		// the SAME mirror, so its clone branches off a `main` that ALREADY CONTAINS item
		// 1's surface — and its OWN ff-push (of a main carrying item 1) succeeds. Had
		// item 2 NOT refetched (stale pre-run main), its ff-push would be a non-fast-
		// forward and item 1's sidecar would be missing from the arbiter. So both present
		// is the load-bearing freshness witness (snapshot-once: the SET was selected ONCE
		// up front and never re-scanned — two INDEPENDENT items, no blockedBy chain).
		const reader = join(scratch.root, 'reader-n');
		gitIn(['clone', '-q', arbiterUrl, reader], scratch.root);
		for (const slug of ['ia', 'ib']) {
			expect(
				existsSync(join(reader, 'work', 'questions', `slice-${slug}.md`)),
			).toBe(true);
		}
		void repo;
	});

	it('nothing eligible under calm gates ⇒ clean exit 0 (snapshot-once, no thrash)', async () => {
		const {arbiterUrl} = seedTwoIndependentBlocked();
		const ws = workspacesDir();
		const multi = await performAdvanceIsolatedAuto({
			remote: arbiterUrl,
			workspacesDir: ws,
			// surfaceBlockers OFF ⇒ the surface pool is dropped; nothing selected.
			config: mergeConfig({surfaceBlockers: false}),
			count: 2,
			env: gitEnv(),
		});
		expect(multi.exitCode).toBe(0);
		expect(multi.results).toHaveLength(0);
		expect(multi.message).toMatch(/nothing eligible/i);
	});
});

/** Two INDEPENDENT needsAnswers slices on the arbiter (NO blockedBy chain). */
function seedTwoIndependentBlocked(): {repo: string; arbiterUrl: string} {
	const {repo} = seedRepoWithArbiter(scratch.root, ['ia', 'ib'], {
		needsAnswers: true,
	});
	const arbiterUrl = resolveArbiterUrlFromCheckout(
		repo,
		'arbiter',
		gitEnv(),
	) as string;
	return {repo, arbiterUrl};
}

// --- (4) the multi-arg sequential path -------------------------------------

describe('advance --isolated <a> <b> — named items, isolated, in sequence', () => {
	it('runs each named item through the isolated runner in the given order', async () => {
		const {repo, arbiterUrl} = seedSurfaceFixtureMulti();
		const ws = workspacesDir();

		const ran: string[] = [];
		const multi = await performAdvanceIsolatedArgs(['m1', 'm2'], {
			remote: arbiterUrl,
			workspacesDir: ws,
			config: mergeConfig({}),
			env: gitEnv(),
			runIsolated: async (opts): Promise<AdvanceResult> => {
				ran.push(opts.arg);
				// Each per-item runner gets the SAME shared isolated context (remote +
				// workspacesDir) + its own arg.
				expect(opts.remote).toBe(arbiterUrl);
				expect(opts.workspacesDir).toBe(ws);
				return {
					exitCode: 0,
					outcome: 'advanced',
					slug: opts.arg,
					message: `did ${opts.arg}`,
				};
			},
		});
		expect(multi.exitCode).toBe(0);
		// The operator's order is preserved (no pool/priority).
		expect(ran).toEqual(['m1', 'm2']);
		expect(multi.results).toHaveLength(2);
		void repo;
	});
});

/** Two named backlog slices on the arbiter for the multi-arg path. */
function seedSurfaceFixtureMulti(): {repo: string; arbiterUrl: string} {
	const {repo} = seedRepoWithArbiter(scratch.root, ['m1', 'm2']);
	const arbiterUrl = resolveArbiterUrlFromCheckout(
		repo,
		'arbiter',
		gitEnv(),
	) as string;
	return {repo, arbiterUrl};
}

void existsOnArbiterMain;
void readdirSync;
void writeFileSync;
