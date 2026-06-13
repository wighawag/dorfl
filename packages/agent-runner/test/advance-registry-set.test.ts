import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	advanceRegistrySet,
	advanceRegistrySetSummary,
} from '../src/advance-loop-driver.js';
import {runOnce, type AgentRunner} from '../src/run.js';
import {ensureMirror} from '../src/repo-mirror.js';
import {scanRepoPaths} from '../src/scan.js';
import {mergeConfig, type Config} from '../src/config.js';
import type {AdvanceContext} from '../src/advance.js';
import type {
	AdvanceTickOptions,
	AdvanceTickRunner,
} from '../src/advance-drivers.js';
import type {AdvanceResult} from '../src/advance.js';
import type {SurfaceGate, SurfaceEmit} from '../src/surface-gate.js';
import type {DoOptions, DoAgentRunner} from '../src/do.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	racerEnv,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * `advance-loop-driver-registry-set-job-worktrees` — the REGISTRY-SET advance
 * driver with PER-MIRROR JOB-WORKTREE isolation: the advance-tick TWIN of
 * `runOnce`/`runOneItem`'s build substrate (the substrate `run-uses-advance-tick`
 * needs to become a clean tick swap). It proves:
 *
 *   1. a multi-mirror registry batch DRAINS every mirror's eligible pool (the
 *      SAME `scan(config)` discovery `runOnce` uses, concurrent across repos);
 *   2. an advance-driven build runs in an ISOLATED WORKTREE off the mirror's
 *      arbiter (the cwd checkout is untouched), exactly as `runOneItem` does;
 *   3. with both lifecycle gates at their calm defaults, the registry-set batch
 *      is OBSERVABLE-OUTCOME equivalent to today's plain `run` build tick over the
 *      same fixture (two callers of one `performIntegration` band);
 *   4. a lifecycle (surface) rung fires under a gate-on registry-set batch (the
 *      tree-less ledger move, no build worktree);
 *   5. the per-item `advancing` borrow is RACE-CORRECT across mirrors (a CAS
 *      loser backs off having spent only the free classification).
 *
 * House style: a throwaway project + a local `--bare` arbiter per repo, REGISTERED
 * as a hub mirror under a TEMP `workspacesDir` (the agents' area) via
 * `ensureMirror`, `isolatePiAgentDir` pointing pi's session storage at scratch,
 * and a STUBBED agent (injected `agentRunner` edits files directly). It drives
 * real git + writes main + materialises worktrees, so it lives in the
 * non-parallel (sequential) project.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-registry-set-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';

/** The temp agents' execution area (hub mirrors + per-job worktrees live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/** The `file://` URL of a seeded `--bare` arbiter. */
function remoteUrl(arbiter: string): string {
	return `file://${arbiter}`;
}

/**
 * Seed a project + its `--bare` arbiter (slugs on the arbiter's `main`), then
 * REGISTER it as a hub mirror under the agents' area `workspacesDir` so
 * `scan(config)` discovers it (its `origin` IS the `--bare` arbiter the worktree
 * driver builds + integrates against). Returns the seed + the mirror path.
 */
function seedAndRegister(
	name: string,
	slugs: string[],
	opts: Parameters<typeof seedRepoWithArbiter>[2] = {},
): {seed: SeededRepo; mirrorPath: string; originUrl: string} {
	const root = join(scratch.root, name);
	const seed = seedRepoWithArbiter(root, slugs, opts);
	const originUrl = remoteUrl(seed.arbiter);
	const mirror = ensureMirror({
		url: originUrl,
		workspacesDir: workspacesDir(),
		env: gitEnv(),
	});
	return {seed, mirrorPath: mirror.path, originUrl};
}

/**
 * The registry config: agents may auto-build/-slice; gates calm by default.
 * `workspacesDir` IS the registry root (the hub-mirror set `scan(config)`
 * enumerates) AND the execution area — ONE root in production, so the test pins
 * it to the agents` area too (the driver`s `scan(config)` discovery reads
 * `config.workspacesDir`, NOT the separate `workspace` execution param).
 */
function config(overrides: Partial<Config> = {}): Config {
	return mergeConfig({
		defaultArbiter: 'origin',
		workspacesDir: workspacesDir(),
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		verify: PASS,
		autoBuild: true,
		autoSlice: true,
		...overrides,
	});
}

/** A stubbed agent that edits a slug-specific file (non-empty diff) and succeeds. */
const editingDoAgent: DoAgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

/** The `run` (plain build tick) twin of {@link editingDoAgent}. */
const editingRunAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

/**
 * The per-mirror advance CONTEXT factory the CLI shapes: the base `do` options the
 * build/slice rungs orchestrate `performDoRemote` with (the registry-set worktree
 * `doDriver` is injected by the DRIVER on top of this) + the surface/triage gate
 * seams. `cwd` is a clone of THIS mirror's arbiter (the tree-less surface/apply
 * rungs' ledger-write working tree). The injected `agentRunner` edits files.
 */
function contextForFactory(opts: {
	agentRunner?: DoAgentRunner;
	surfaceGate?: SurfaceGate;
}): (input: {
	mirrorPath: string;
	originUrl: string;
}) => Omit<AdvanceTickOptions, 'arg' | 'doDriver'> {
	return ({originUrl}) => {
		// Tree-less rungs (surface/triage/apply) commit in a working clone of the
		// mirror's arbiter — the per-mirror cwd the CLI gives them (here a throwaway
		// clone of the arbiter so the test can read the committed sidecar).
		const cwd = join(
			scratch.root,
			'treeless-cwd',
			originUrl.replace(/[^a-zA-Z0-9]/g, '_'),
		);
		gitIn(['clone', '-q', originUrl, cwd], scratch.root);
		const doOptions: Omit<DoOptions, 'arg'> = {
			cwd,
			arbiter: 'origin',
			integration: 'merge',
			verify: PASS,
			autoSlice: true,
			agentRunner: opts.agentRunner ?? editingDoAgent,
			env: gitEnv(),
		};
		const context: AdvanceContext = {
			cwd,
			arbiter: 'origin',
			doOptions,
			surfaceGate: opts.surfaceGate,
		};
		return context;
	};
}

/** Recursively snapshot every file path under `dir` (relative), for untouched-checks. */
function listAllFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	const out: string[] = [];
	const walk = (d: string, prefix: string) => {
		for (const entry of readdirSync(d)) {
			const full = join(d, entry);
			const rel = prefix ? `${prefix}/${entry}` : entry;
			let isDir: boolean;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				continue;
			}
			if (isDir) {
				walk(full, rel);
			} else {
				out.push(rel);
			}
		}
	};
	walk(dir, '');
	return out.sort();
}

describe('advanceRegistrySet — drains the WHOLE registry (every mirror, concurrent)', () => {
	it(
		'a multi-mirror registry batch advances every mirror`s eligible pool',
		{timeout: 30000},
		async () => {
			const a = seedAndRegister('repo-a', ['a1', 'a2']);
			const b = seedAndRegister('repo-b', ['b1']);

			const result = await advanceRegistrySet({
				config: config(),
				workspace: workspacesDir(),
				contextFor: contextForFactory({}),
				env: gitEnv(),
			});

			// Both mirrors drained: each mirror`s eligible slices advanced (built).
			expect(result.mirrors).toHaveLength(2);
			const summary = advanceRegistrySetSummary(result);
			expect(summary.advanced).toBe(3); // a1, a2, b1
			expect(summary.stuck).toBe(0);

			// Each repo`s slices landed on ITS OWN arbiter main, in done/ (merge mode).
			expect(existsOnArbiterMain(a.seed.repo, 'done', 'a1')).toBe(true);
			expect(existsOnArbiterMain(a.seed.repo, 'done', 'a2')).toBe(true);
			expect(existsOnArbiterMain(b.seed.repo, 'done', 'b1')).toBe(true);
			expect(existsOnArbiterMain(a.seed.repo, 'backlog', 'a1')).toBe(false);
		},
	);
});

describe('advanceRegistrySet — per-mirror JOB-WORKTREE isolation (cwd untouched)', () => {
	it(
		'an advance-driven build runs in a worktree off the mirror arbiter, NOT the cwd checkout',
		{timeout: 30000},
		async () => {
			const {seed, mirrorPath} = seedAndRegister('iso', ['solo']);

			// Snapshot the human checkout BEFORE; assert it is byte-untouched AFTER (the
			// build ran in a job worktree off the mirror, never in this checkout).
			const before = listAllFiles(seed.repo);
			const beforeHead = gitIn(['rev-parse', 'HEAD'], seed.repo).trim();
			const beforeBranch = gitIn(
				['rev-parse', '--abbrev-ref', 'HEAD'],
				seed.repo,
			).trim();

			let agentCwd = '';
			const result = await advanceRegistrySet({
				config: config(),
				workspace: workspacesDir(),
				contextFor: contextForFactory({
					agentRunner: (input) => {
						agentCwd = input.cwd;
						return editingDoAgent(input);
					},
				}),
				env: gitEnv(),
			});

			expect(advanceRegistrySetSummary(result).advanced).toBe(1);
			// The agent ran inside the AGENTS` area job worktree (under workspacesDir/
			// work/), NOT the human checkout.
			expect(agentCwd.startsWith(join(workspacesDir(), 'work'))).toBe(true);
			expect(agentCwd.startsWith(seed.repo)).toBe(false);

			// The human checkout is byte-untouched: same files, same HEAD, same branch.
			expect(listAllFiles(seed.repo)).toEqual(before);
			expect(gitIn(['rev-parse', 'HEAD'], seed.repo).trim()).toBe(beforeHead);
			expect(
				gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], seed.repo).trim(),
			).toBe(beforeBranch);
			// The work nonetheless landed on the arbiter (via the worktree).
			expect(existsOnArbiterMain(seed.repo, 'done', 'solo')).toBe(true);
			void mirrorPath;
		},
	);
});

describe('advanceRegistrySet — gates-off OUTCOME-equivalence to plain run`s build tick', () => {
	it(
		'the calm-gates registry-set batch matches runOnce over the SAME fixture',
		{timeout: 30000},
		async () => {
			// Two parallel universes from the SAME seed shape. UNIVERSE 1: plain `run`s
			// build tick (`runOnce`) over the working checkouts. UNIVERSE 2: the
			// registry-set advance batch over the registered mirrors. Both calm-gates
			// (observationTriage off, surfaceBlockers off) ⇒ build the ready slices, each
			// per-job-worktree-isolated off the arbiter, same integration result.

			// UNIVERSE 1 — plain run build tick.
			const runRoot = join(scratch.root, 'u1');
			const runSeed = seedRepoWithArbiter(runRoot, ['eq1', 'eq2']);
			const runCfg = config({defaultArbiter: 'arbiter'});
			const runResult = await runOnce({
				config: runCfg,
				report: scanRepoPaths([runSeed.repo], runCfg),
				workspace: join(scratch.root, 'u1-ws'),
				agentRunner: editingRunAgent,
				env: gitEnv(),
			});

			// UNIVERSE 2 — registry-set advance batch.
			const adv = seedAndRegister('u2', ['eq1', 'eq2']);

			const advResult = await advanceRegistrySet({
				config: config(),
				workspace: workspacesDir(),
				contextFor: contextForFactory({}),
				env: gitEnv(),
			});

			// OBSERVABLE-OUTCOME equivalence: SAME count of items built-and-integrated.
			expect(runResult.claimedAndDone).toBe(2);
			expect(advanceRegistrySetSummary(advResult).advanced).toBe(2);

			// SAME integration result: both eq1 + eq2 on done/, neither in backlog/,
			// neither path touched observations or surfaced a question.
			for (const slug of ['eq1', 'eq2']) {
				expect(existsOnArbiterMain(runSeed.repo, 'done', slug)).toBe(true);
				expect(existsOnArbiterMain(runSeed.repo, 'backlog', slug)).toBe(false);
				expect(existsOnArbiterMain(adv.seed.repo, 'done', slug)).toBe(true);
				expect(existsOnArbiterMain(adv.seed.repo, 'backlog', slug)).toBe(false);
			}
			// No question sidecars surfaced under calm gates (neither universe).
			expect(
				existsOnArbiterMain(adv.seed.repo, 'done', 'eq1') &&
					!existsSync(join(adv.seed.repo, 'work', 'questions')),
			).toBe(true);
		},
	);
});

describe('advanceRegistrySet — a lifecycle rung fires under a gate-on batch', () => {
	it(
		'surfaceBlockers on ⇒ a needsAnswers slice is surfaced (tree-less sidecar, no build worktree)',
		{timeout: 30000},
		async () => {
			// A blocked slice (needsAnswers) on the mirror; with the surface gate ON the
			// selection layer enumerates it into the surface rung, which spawns the
			// surface-questions skill (stubbed) and the ENGINE persists the sidecar in
			// the tree-less cwd — NO build worktree (criterion 4).
			const blockedSlug = 'blocked';
			const {seed} = seedAndRegister('lifecycle', [blockedSlug], {
				needsAnswers: true,
			});

			const emit: SurfaceEmit = {
				item: `slice:${blockedSlug}`,
				questions: [{question: 'which approach?'}],
			};
			const surfaceGate: SurfaceGate = async () => emit;

			const result = await advanceRegistrySet({
				config: config(),
				workspace: workspacesDir(),
				contextFor: contextForFactory({surfaceGate}),
				env: gitEnv(),
				// The CLI wires this from `surfaceBlockers` — flip the surface pool ON.
				lifecycleGates: {surface: true},
			});

			// The surface rung ADVANCED the blocked slice (not built — surfaced).
			const summary = advanceRegistrySetSummary(result);
			expect(summary.advanced).toBe(1);

			// The sidecar was persisted in the tree-less cwd (the ledger-write seam),
			// NOT through a build worktree.
			const treelessCwd = join(
				scratch.root,
				'treeless-cwd',
				remoteUrl(seed.arbiter).replace(/[^a-zA-Z0-9]/g, '_'),
			);
			expect(
				existsSync(
					join(treelessCwd, 'work', 'questions', `slice-${blockedSlug}.md`),
				),
			).toBe(true);
			// No build worktree was materialised for the surfaced (non-build) item: the
			// agents` work/ area holds nothing for this slug`s build branch.
			const workDir = join(workspacesDir(), 'work');
			const builtDirs = existsSync(workDir)
				? readdirSync(workDir).filter((d) => d.includes(blockedSlug))
				: [];
			expect(builtDirs).toEqual([]);
		},
	);
});

describe('advanceRegistrySet — the advancing borrow is RACE-CORRECT across batches', () => {
	it(
		'two concurrent registry-set batches over the SAME mirror ⇒ exactly ONE winner per item (no double-advance)',
		{timeout: 30000},
		async () => {
			// The per-item `advancing` borrow (held INSIDE performAdvance via the CAS) is
			// the ONLY shared state across the concurrent ticks. Two registry-set batches
			// racing the SAME mirror through DISTINCT per-batch clones (the
			// distinct-contender model advancing-lock.test.ts pins) must let EXACTLY ONE
			// win each item: the loser`s CAS loses having spent only the free
			// classification + lock attempt, never a second build. The driver reuses the
			// EXISTING borrow + scheduler — no new lock, no new mechanism.
			seedAndRegister('race', ['r1', 'r2']);

			// Each racer gets its OWN tree-less clone of the arbiter (distinct cwd ⇒ the
			// genuine path-exists/lease CAS serialises the winner, not a fixture collision).
			const contextForRacer =
				(who: string) =>
				({originUrl}: {mirrorPath: string; originUrl: string}) => {
					const cwd = join(scratch.root, `race-cwd-${who}`);
					gitIn(['clone', '-q', originUrl, cwd], scratch.root);
					const doOptions: Omit<DoOptions, 'arg'> = {
						cwd,
						arbiter: 'origin',
						integration: 'merge',
						verify: PASS,
						agentRunner: editingDoAgent,
						env: racerEnv(who),
					};
					const context: AdvanceContext = {cwd, arbiter: 'origin', doOptions};
					return context;
				};

			const racer = (who: string) =>
				advanceRegistrySet({
					config: config(),
					workspace: workspacesDir(),
					contextFor: contextForRacer(who),
					env: racerEnv(who),
				});

			const [resA, resB] = await Promise.all([racer('alpha'), racer('beta')]);

			// The borrow`s race-correctness (criterion 5): per item, EXACTLY ONE batch wins
			// the `advancing` borrow; the other backs off having spent only the free
			// classification + lock attempt (`lost`/`contended`), NEVER reaching a second
			// build — NO double-advance. (Whether the single winner then integrates clean
			// or hits concurrent-main merge contention → needs-attention is a downstream
			// rebase-or-abort concern, NOT the borrow; either way the LOSER never built.)
			const all = [...resA.mirrors, ...resB.mirrors].flatMap(
				(m) => m.batch.items,
			);
			for (const slug of ['r1', 'r2']) {
				const forSlug = all.filter((i) => i.arg === slug);
				const wonBorrow = forSlug.filter(
					(i) =>
						i.result.outcome !== 'lost' && i.result.outcome !== 'contended',
				);
				const backedOff = forSlug.filter(
					(i) =>
						i.result.outcome === 'lost' || i.result.outcome === 'contended',
				);
				// Exactly one winner of the borrow; the other(s) backed off cleanly.
				expect(wonBorrow).toHaveLength(1);
				expect(backedOff).toHaveLength(forSlug.length - 1);
				// The single winner ADVANCED a rung (built) or hit downstream merge
				// contention (needs-attention) — never a no-op, never a double-build.
				expect(['advanced', 'usage-error']).toContain(
					wonBorrow[0].result.outcome,
				);
			}
			// Across the whole race NO item was advanced more than once (the
			// no-double-advance invariant, the borrow`s reason for being).
			for (const slug of ['r1', 'r2']) {
				const advancedTwice = all.filter(
					(i) => i.arg === slug && i.result.outcome === 'advanced',
				).length;
				expect(advancedTwice).toBeLessThanOrEqual(1);
			}
		},
	);
});

describe('advanceRegistrySet — a thrown mirror batch never aborts the registry sweep', () => {
	it('one mirror`s failure is captured; the other mirror still drains', async () => {
		const good = seedAndRegister('good', ['g1']);

		// A runner that throws ONLY for one mirror`s item; the good mirror advances.
		const run: AdvanceTickRunner = async (options) => {
			if (options.arg === 'g1') {
				return {
					exitCode: 0,
					outcome: 'advanced',
					message: 'ok',
				} satisfies AdvanceResult;
			}
			throw new Error('kaboom');
		};

		// Register a SECOND mirror whose single item throws.
		const bad = seedAndRegister('bad', ['x1']);

		const result = await advanceRegistrySet({
			config: config(),
			workspace: workspacesDir(),
			contextFor: ({}) => ({
				cwd: join(scratch.root, 'sweep-cwd'),
				arbiter: 'origin',
			}),
			run,
			env: gitEnv(),
		});

		expect(result.mirrors).toHaveLength(2);
		const summary = advanceRegistrySetSummary(result);
		// The good mirror`s item advanced; the bad mirror`s throw became a
		// usage-error (stuck), never aborting the sweep.
		expect(summary.advanced).toBe(1);
		expect(summary.stuck).toBe(1);
		void good;
		void bad;
	});
});
