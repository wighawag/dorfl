import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, existsSync, readFileSync, chmodSync} from 'node:fs';
import {runOnce, type AgentRunner} from '../src/run.js';
import {readItemLock} from '../src/item-lock.js';
import {PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE} from '../src/do-config.js';
import {performClaim} from '../src/claim-cas.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {readJobRecord, jobWorktreePath} from '../src/workspace.js';
import {isAbsolute} from 'node:path';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-');
	// Isolate pi's session storage to a scratch dir (see do-watch.test.ts) so the
	// default-path job launches do not pollute the real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/**
 * An agent that edits a file (so the commit is non-empty) and succeeds. The
 * content is SLUG-SPECIFIC so two concurrently-claimed items never write
 * byte-identical content to the SAME path — which, once the first merges to main,
 * would make the second's diff vs the advanced main genuinely empty and trip the
 * `agent-stop-signal` empty-diff backstop. (Single-item tests assert the file
 * EXISTS, not its content, so this is transparent to them.)
 */
const editingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

// A NON-conflicting editing agent: each slug writes to its OWN disjoint file
// (`<slug>.txt`), so two same-repo jobs touch DIFFERENT paths and their rebases
// never collide. The both-land assertion under the per-repo integrate lock needs
// this (the shared `editingAgent` writes different content to the SAME
// `agent-output.txt`, which is a GENUINE conflict between two same-repo jobs).
const disjointEditingAgent: AgentRunner = ({cwd, slug}) => {
	writeFileSync(join(cwd, `${slug}.txt`), `work done for ${slug}\n`);
	return {ok: true};
};

// The gate is now the per-repo, language-agnostic `verify` command (the converged
// `performIntegration` core), NOT the deleted `defaultTestGate`/`TestGate`. Tests
// inject it via a string command, exactly as `do`/`complete`'s tests do: `exit 0`
// stands in for a green gate, `exit 1` for a red one. (The default config sets
// `verify: PASS` so the existing green-path assertions are unchanged.)
const PASS = 'exit 0';
const FAIL = 'exit 1';

/**
 * Build the injected scan report for `run` from the seeded `project` working
 * checkout (working-tree read). `run` claims + cuts job worktrees from real
 * checkouts, so its discovery is the working-tree scan, not the registry's bare
 * mirrors (that wiring is the `run-daemon-reframe` slice).
 */
/**
 * True iff the BARE arbiter has the given branch — read DIRECTLY via `ls-remote`
 * (provider-agnostic; independent of any clone's fetch refspec / remote-tracking
 * refs). `cwd` is just a repo to run git in.
 */
function arbiterHasBranch(
	arbiter: string,
	cwd: string,
	branch: string,
): boolean {
	const out = gitIn(
		['ls-remote', `file://${arbiter}`, `refs/heads/${branch}`],
		cwd,
	);
	return out.trim() !== '';
}

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(root: string, overrides = {}) {
	void root;
	// `run` operates on working CHECKOUTS; the report is injected from an explicit
	// working-tree scan ({@link scanProject}) over the seeded `project` repo.
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		// The per-repo gate, injected as a string command (green by default). The
		// gate is now `runVerify(config.verify)` inside the shared core, NOT the
		// deleted `defaultTestGate` — red-gate tests override with `verify: FAIL`.
		verify: PASS,
		// Seeded slices are undeclared (not humanOnly) — agents may claim them only
		// when this per-repo/global policy is on.
		autoBuild: true,
		...overrides,
	});
}

describe('runOnce — happy path (green gate)', () => {
	it('claims an eligible item, runs the agent, and moves it to done on green tests', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.claimedAndDone).toBe(1);
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		// integration: merge → on the arbiter's main, in done/, not in-progress.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
	});
});

describe('runOnce — test gate keeps failing work out of done/', () => {
	it('surfaces a red item as needs-attention on main, never moving it to done', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, 'ws');
		const config = configFor(scratch.root, {verify: FAIL});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		// It NEVER reached done. The stuck state is now SURFACED on main
		// (needs-attention-surface-on-main, mode M): the move-only commit was
		// cherry-picked to main, so main shows needs-attention/feat.md (not
		// in-progress/), letting scan/status/a fresh checkout tell stuck from
		// actively-in-progress.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		// Folder-native surfacing (ADR §12): the runner bounced the work item from
		// in-progress/ to needs-attention/ on the work branch, with the reason in
		// its body, and PUSHED the branch to the arbiter (so the saved wip is
		// cross-machine recoverable — see the dedicated push test below). The
		// move-only commit's effect (needs-attention/feat.md) is on the pushed
		// branch; main shows it via the mode-M surface (asserted above). Because the
		// branch is now provably on the arbiter (pushed), the worktree is REAPED at
		// teardown (ADR §4: provable safety, not "success") — recovery rides on the
		// pushed branch, not the local worktree.
		void arbiter;
	});

	it('PUSHES the work/<slug> branch on the red-gate bounce (saving the wip cross-machine)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, 'ws');
		const config = configFor(scratch.root, {verify: FAIL});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('tests-failed');

		// THE FIX: the seam surfaces only the LEDGER on main; the runner now ALSO
		// pushes the work branch, so a requeue-continue on a different machine has a
		// branch to continue from (continue-detection reads <arbiter>/work/<slug>).
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/slice-feat'],
				repo,
			).trim(),
		).not.toBe('');
		// The agent's aborted wip is on the pushed branch (not dropped)…
		expect(
			gitIn(
				['cat-file', '-e', 'arbiter/work/slice-feat:agent-output.txt'],
				repo,
			),
		).toBe('');
		// …but it never reached main (no auto-merge of failing work).
		expect(
			gitIn(['ls-tree', 'arbiter/main', 'agent-output.txt'], repo).trim(),
		).toBe('');
	});
});

describe('runOnce — concurrency caps', () => {
	it('claims at most maxParallel items then stops', async () => {
		seedRepoWithArbiter(scratch.root, ['a', 'b', 'c', 'd', 'e']);
		const config = configFor(scratch.root, {maxParallel: 2, perRepoMax: 10});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			// DISJOINT-file agent: this test is about the claim CAP, not about a
			// same-repo integrate conflict. Two same-repo merge jobs editing the
			// SHARED `agent-output.txt` would genuinely conflict under the per-repo
			// integrate lock (the loser routing to needs-attention), which would mask
			// the cap assertion; disjoint files let both land so `claimedAndDone` is
			// exactly the cap.
			agentRunner: disjointEditingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items).toHaveLength(2);
		expect(result.claimedAndDone).toBe(2);
	});

	it('claims at most perRepoMax items from one repo', async () => {
		seedRepoWithArbiter(scratch.root, ['a', 'b', 'c', 'd']);
		const config = configFor(scratch.root, {maxParallel: 10, perRepoMax: 1});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items).toHaveLength(1);
	});
});

describe('runOnce — GENUINE concurrency safety (multiple jobs in flight)', () => {
	// The bounded-concurrency EXECUTOR this tick runs on is proven to keep multiple
	// workers in flight at once (peak = N under a shared gate) in
	// `test/concurrency.test.ts`. These tests prove the SAFETY properties the slice
	// requires hold when `runOnce` drives the real pipeline through it: distinct
	// repos progress together, a lost claim is dropped without sinking the batch, and
	// a conflicting rebase routes ONLY its own job to needs-attention.

	it('a concurrent tick completes work across DIFFERENT repos in one pass', async () => {
		// Two independent repos+arbiters, maxParallel 2: both items integrate in one
		// tick. A sequential loop would still complete both, but this pins the
		// multi-repo concurrent path (the executor admits both jobs in flight).
		const a = seedRepoWithArbiter(join(scratch.root, 'a'), ['fa']);
		const b = seedRepoWithArbiter(join(scratch.root, 'b'), ['fb']);
		const config = mergeConfig({
			defaultArbiter: 'arbiter',
			maxParallel: 2,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
		});
		const result = await runOnce({
			config,
			report: scanRepoPaths([a.repo, b.repo], config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.claimedAndDone).toBe(2);
		expect(existsOnArbiterMain(a.repo, 'done', 'fa')).toBe(true);
		expect(existsOnArbiterMain(b.repo, 'done', 'fb')).toBe(true);
	});

	it('two NON-CONFLICTING same-repo jobs both integrate DETERMINISTICALLY under the merge path (per-repo integrate lock)', async () => {
		// maxParallel 2, perRepoMax 2, MERGE integration: two same-repo jobs run
		// concurrently and edit DISJOINT files (`a.txt` / `b.txt`). The per-repo
		// integrate lock serialises ONLY the land-on-main tail, so the loser rebases
		// onto the winner's now-advanced main and fast-forwards cleanly — both reach
		// done with NO claim-error and NO timing dependence (the OLD contract relied
		// on push ordering; this one does not).
		const seeded = seedRepoWithArbiter(scratch.root, ['a', 'b', 'c']);
		const config = configFor(scratch.root, {
			maxParallel: 2,
			perRepoMax: 10,
			integration: 'merge',
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: disjointEditingAgent,
			env: gitEnv(),
		});
		expect(result.items).toHaveLength(2);
		expect(result.claimedAndDone).toBe(2);
		// No job fell over on the shared-checkout claim race / integrate race.
		expect(result.items.every((i) => i.status === 'claimed-done')).toBe(true);
		// BOTH landed on the arbiter's main (deterministic, not timing-dependent).
		const landed = result.items.map((i) => i.slug);
		for (const slug of landed) {
			expect(existsOnArbiterMain(seeded.repo, 'done', slug)).toBe(true);
		}
	});

	it('two same-repo jobs at perRepoMax 2 with the FRESH GATE ON both land (the run-fleet downgrade is removed)', async () => {
		// MANDATORY (slice `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`,
		// the deferred concern of the merged gate slice #125): the `perRepoMax === 1`
		// fresh-gate downgrade in the `run` caller is REMOVED, so the fresh rebased-tip
		// gate runs on the `run` fleet at ANY parallelism. Here `perRepoMax: 2`,
		// `freshWorktreeGate: true`, MERGE: two same-repo jobs run concurrently, the
		// fresh rebased-tip gate runs for BOTH, and the two Race fixes (the merge-push
		// re-rebase-retry + the sibling-ledger reconcile) let BOTH land deterministically
		// — the gate's added latency no longer makes the (now-closed) races fire. (Before
		// this slice the downgrade silently fell back to the in-build-worktree gate at
		// perRepoMax > 1; this test would have exercised a DIFFERENT gate path.)
		const seeded = seedRepoWithArbiter(scratch.root, ['fa', 'fb', 'fc']);
		const config = configFor(scratch.root, {
			maxParallel: 2,
			perRepoMax: 2,
			integration: 'merge',
			// Explicit (it already defaults ON) — the point is it runs at perRepoMax 2.
			freshWorktreeGate: true,
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: disjointEditingAgent,
			env: gitEnv(),
		});
		expect(result.items).toHaveLength(2);
		expect(result.claimedAndDone).toBe(2);
		expect(result.items.every((i) => i.status === 'claimed-done')).toBe(true);
		// BOTH same-repo jobs landed on main with the fresh gate ON at perRepoMax 2.
		for (const slug of result.items.map((i) => i.slug)) {
			expect(existsOnArbiterMain(seeded.repo, 'done', slug)).toBe(true);
		}
	});

	// The GENUINELY-CONFLICTING contract (two same-repo merges that touch the SAME
	// file with different content → EXACTLY ONE routes to needs-attention under the
	// per-repo integrate lock) is proven DETERMINISTICALLY at the
	// `performIntegration` level in `test/integration-core.test.ts`
	// ("per-repo INTEGRATE lock serialises the merge tail"), where the two jobs'
	// pre-merge BASE is controllable so the race is real every run. At THIS `run`
	// tick level the job worktrees are cut off a freshly-fetched shared mirror
	// main, so a same-repo sibling's merge is usually already visible when the next
	// worktree is cut — the jobs LINEARISE rather than reproduce the same-base race
	// on demand (the deterministic same-base contention lives in the core test).
	// The existing "a conflicting rebase routes ONLY its own job to needs-attention"
	// test below still pins the run-level conflict isolation via a mid-run external
	// edit (the reliable way to force a conflict at this level).

	it('under concurrency a LOST claim is dropped while the winner proceeds', async () => {
		// Pre-claim one of two slugs from an independent clone so the concurrent tick
		// loses that race (claim exit 2 → dropped) but still completes the other — one
		// job's lost race does NOT abort the other (failure isolation).
		const seeded = seedRepoWithArbiter(scratch.root, ['win', 'taken']);
		const other = seeded.clone('other');
		const pre = await performClaim({
			slug: 'taken',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(pre.outcome).toBe('claimed');

		const config = configFor(scratch.root, {maxParallel: 2, perRepoMax: 2});
		const result = await runOnce({
			config,
			// the stale working clone still lists both in backlog
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		const byStatus = new Map(result.items.map((i) => [i.slug, i.status]));
		expect(byStatus.get('taken')).toBe('lost-race');
		expect(byStatus.get('win')).toBe('claimed-done');
	});

	it('a conflicting rebase routes ONLY its own job to needs-attention; the sibling still integrates', async () => {
		// Two same-repo jobs, MERGE. Job for `clash` edits shared.txt and, mid-run,
		// lands a CONFLICTING edit on the arbiter main (so its integrate-time rebase
		// conflicts, ADR §10). Job for `clean` edits its own file. Under concurrency the
		// conflict must route ONLY `clash` to needs-attention; `clean` still completes.
		const seeded = seedRepoWithArbiter(scratch.root, ['clash', 'clean']);
		const config = configFor(scratch.root, {
			maxParallel: 2,
			perRepoMax: 10,
			integration: 'merge',
		});
		const report = scanProject(config);
		const clashAgent: AgentRunner = ({cwd, slug}) => {
			if (slug === 'clash') {
				writeFileSync(join(cwd, 'shared.txt'), 'agent version\n');
				const other = seeded.clone('other-clash');
				writeFileSync(join(other, 'shared.txt'), 'main version\n');
				gitIn(['add', '-A'], other);
				gitIn(['commit', '-q', '-m', 'main edits shared'], other);
				gitIn(['push', '-q', 'arbiter', 'HEAD:main'], other);
			} else {
				writeFileSync(join(cwd, `${slug}.txt`), 'clean work\n');
			}
			return {ok: true};
		};
		const result = await runOnce({
			config,
			report,
			workspace: join(scratch.root, '.agent-runner'),
			agentRunner: clashAgent,
			env: gitEnv(),
		});
		const byStatus = new Map(result.items.map((i) => [i.slug, i.status]));
		expect(byStatus.get('clash')).toBe('needs-attention');
		// The conflict is isolated: the sibling clean job still integrated.
		expect(byStatus.get('clean')).toBe('claimed-done');
		expect(stuckLockOnArbiter(seeded.repo, 'clash')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'clean')).toBe(true);
	});
});

describe('runOnce — lost race is skipped cleanly', () => {
	it('skips an item already claimed by someone else (claim exit 2)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Pre-claim `solo` from an independent clone so the runner loses the race.
		const other = seeded.clone('other');
		const pre = await performClaim({
			slug: 'solo',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(pre.outcome).toBe('claimed');

		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			// scan the still-stale working clone (its backlog still lists solo)
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('lost-race');
		expect(result.skipped).toBe(1);
		expect(result.claimedAndDone).toBe(0);
	});
});

describe('runOnce — simultaneous two-runner race (exactly one winner)', () => {
	it('two runners racing the same single item produce exactly one claimed-done', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Two independent working clones of the arbiter, each its own scan root AND a
		// DISTINCT committer identity so the two claim commits get DISTINCT shas (as
		// two real runners would) and the loser loses through the genuine CAS, not a
		// fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');

		const configFrom = () =>
			mergeConfig({
				defaultArbiter: 'arbiter',
				maxParallel: 4,
				perRepoMax: 2,
				integration: 'merge',
				agentCmd: 'true',
				verify: PASS,
				autoBuild: true,
			});

		const runFrom = (clone: string, agentId: string) => {
			const config = configFrom();
			return runOnce({
				config,
				report: scanRepoPaths([clone], config),
				workspace: join(scratch.root, `ws-${agentId}`),
				agentRunner: editingAgent,
				env: racerEnv(agentId),
				agentId: () => agentId,
			});
		};

		// Genuinely concurrent: both in-process claims race over the same item, so
		// the arbiter's ref-CAS (not test ordering) is what picks the single winner.
		const [ra, rb] = await Promise.all([runFrom(a, 'A'), runFrom(b, 'B')]);

		const statuses = [ra.items[0]?.status, rb.items[0]?.status];
		const winners = statuses.filter((s) => s === 'claimed-done');
		const losers = statuses.filter((s) => s === 'lost-race');
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
	});
});

describe('runOnce — integration modes', () => {
	it('integration: propose does NOT push to main; it pushes the work branch + opens a PR', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'propose'});
		let prBranch = '';
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
			openPr: ({branch}) => {
				prBranch = branch;
			},
		});
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		expect(item.integration?.mode).toBe('propose');
		expect(item.integration?.mergedToMain).toBe(false);
		expect(item.integration?.requestOpened).toBe(true);
		expect(prBranch).toBe('work/slice-feat');
		// PR mode never moves done/ onto main; claim writes nothing to main, so the
		// slice body stays in backlog/ on main (the done-move is on the pushed branch).
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true);
	});

	it('integration: merge lands the done-move directly on the arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'merge'});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});
});

describe('runOnce — per-repo config (multi-repo aware)', () => {
	it('honours a repo-local .agent-runner.json integration over the global', async () => {
		// Global says `merge`, but the repo commits `propose` in its own file →
		// the run must integrate THIS repo as propose (per-repo > global).
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		writeFileSync(
			join(repo, '.agent-runner.json'),
			JSON.stringify({integration: 'propose'}),
		);
		const config = configFor(scratch.root, {integration: 'merge'});
		let prBranch = '';
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
			openPr: ({branch}) => {
				prBranch = branch;
			},
		});
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		// per-repo `propose` won over global `merge`.
		expect(item.integration?.mode).toBe('propose');
		expect(item.integration?.mergedToMain).toBe(false);
		expect(prBranch).toBe('work/slice-feat');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
	});

	it('resolves each repo against ITS OWN file in one run (A merge, B propose)', async () => {
		// Two independent repos+arbiters under one root. Global = merge. Repo B
		// commits propose; repo A has no file. One run → A merges, B proposes.
		const a = seedRepoWithArbiter(join(scratch.root, 'a'), ['fa']);
		const b = seedRepoWithArbiter(join(scratch.root, 'b'), ['fb']);
		writeFileSync(
			join(b.repo, '.agent-runner.json'),
			JSON.stringify({integration: 'propose'}),
		);
		const config = mergeConfig({
			defaultArbiter: 'arbiter',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			verify: PASS,
			autoBuild: true,
		});
		let bBranch = '';
		const result = await runOnce({
			config,
			report: scanRepoPaths([a.repo, b.repo], config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentZ',
			openPr: ({branch}) => {
				bBranch = branch;
			},
		});
		const byRepo = new Map(result.items.map((i) => [i.repoPath, i]));
		const itemA = byRepo.get(a.repo);
		const itemB = byRepo.get(b.repo);
		// Repo A: no file → global merge → landed on main.
		expect(itemA?.integration?.mode).toBe('merge');
		expect(itemA?.integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(a.repo, 'done', 'fa')).toBe(true);
		// Repo B: own file propose → pushed branch, NOT on main.
		expect(itemB?.integration?.mode).toBe('propose');
		expect(itemB?.integration?.mergedToMain).toBe(false);
		expect(bBranch).toBe('work/slice-fb');
		expect(existsOnArbiterMain(b.repo, 'done', 'fb')).toBe(false);
	});
});

describe('runOnce — agent failure', () => {
	it('does not move to done when the agent itself fails; SAVES + surfaces the work', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const failingAgent: AgentRunner = ({cwd}) => {
			// Leave partial work in the tree so the seam saves a non-empty wip commit.
			writeFileSync(join(cwd, 'partial.txt'), 'half-built\n');
			return {ok: false, detail: 'boom'};
		};
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: failingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		// `run`'s agent-failure now routes through the seam (not a bare-return): the
		// stuck state is SURFACED on main (needs-attention, not the in-progress claim)
		// and the work branch is PUSHED — cross-machine recoverable.
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/slice-feat'],
				repo,
			).trim(),
		).not.toBe('');
		expect(
			gitIn(['cat-file', '-e', 'arbiter/work/slice-feat:partial.txt'], repo),
		).toBe('');
	});
});

describe('runOnce — failure-CAUSE classification (transient-infra / config-error / generic)', () => {
	it('a harness-surfaced model/connection outage (post-retry) → transient-infra, NOT generic agent-failed', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const transientAgent: AgentRunner = ({cwd}) => {
			writeFileSync(join(cwd, 'partial.txt'), 'half-built\n');
			// What the harness SURFACES once its own retries are exhausted.
			return {
				ok: false,
				detail:
					'connection error: ETIMEDOUT to the model endpoint after retries',
			};
		};
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: transientAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('transient-infra');
		expect(result.items[0].status).not.toBe('agent-failed');
		// Still routed + surfaced (the work-preserving seam is unchanged — only the
		// label is more precise).
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
	});

	it('an agent that ran but produced bad output stays the generic agent-failed (conservative default)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const badAgent: AgentRunner = ({cwd}) => {
			writeFileSync(join(cwd, 'partial.txt'), 'half-built\n');
			return {ok: false, detail: 'the agent produced garbage'};
		};
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: badAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
	});

	it('a thrown CORE wiring/config error (review on, no reviewGate) → config-error (NOT agent-failed)', async () => {
		// review on but reviewGate UNSET ⇒ the core throws the wiring error;
		// `runOneItem`'s catch now classifies it as `config-error` — the SAME label
		// `do` records for the SAME error (the cross-path convergence).
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {review: true});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('config-error');
		expect(result.items[0].status).not.toBe('agent-failed');
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
	});
});

describe('runOnce — a deliberate STOP routes to needs-attention BEFORE the gate (agent-stop-signal)', () => {
	it('a sentinel STOP → agent-stopped, surfaced on main, NO gate (mirrors do)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		// A gate that would EXPLODE if run — proves the gate is SKIPPED on a STOP.
		const config = configFor(scratch.root, {
			verify: 'echo GATE-RAN >&2; exit 1',
		});
		const stoppingAgent: AgentRunner = () => ({
			ok: true,
			output: [
				'=== SLICE-STOP ===',
				'drifted: the seam this slice targets already landed elsewhere.',
				'=== END SLICE-STOP ===',
			].join('\n'),
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: stoppingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		const item = result.items[0];
		// The NEW status — distinct from needs-attention / agent-failed.
		expect(item.status).toBe('agent-stopped');
		expect(item.detail).toMatch(/already landed elsewhere/);
		// Routed + surfaced on the arbiter main; never reached done.
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		// The reason is recorded on the stuck lock entry (the SOLE stuck record).
		const lock = await readItemLock({
			item: 'slice:feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(lock?.reason).toMatch(/already landed elsewhere/);
		// Counted as needs-attention (a STOP is a human-must-look outcome).
		expect(result.needsAttention).toBe(1);
	});

	it('the empty-diff BACKSTOP: agent.ok + no source change → agent-stopped without a sentinel', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			// Succeeds but edits nothing + emits no sentinel.
			agentRunner: () => ({ok: true, output: 'nothing to do'}),
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('agent-stopped');
		expect(result.items[0].detail).toMatch(
			/no source change|empty diff|no-op/i,
		);
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
	});

	it('a NORMAL build (non-empty diff, no sentinel) is UNAFFECTED', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('claimed-done');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});
});

describe('runOnce — runs in a substrate job worktree (one isolation path)', () => {
	it('auto-reaps a provably-safe (merged) finished job worktree at end-of-job (ADR §4)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		void repo;
		const workspacesDir = join(scratch.root, '.agent-runner');
		// merge integration ⇒ the work lands on arbiter/main ⇒ provably safe ⇒
		// the end-of-job auto-reap removes the worktree (ADR §4 deletion predicate).
		const config = configFor(scratch.root, {
			workspacesDir,
			integration: 'merge',
		});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');

		// The job's work is on the arbiter (merged), so the worktree was REAPED
		// (git worktree remove + prune, never rm -rf) — nothing lingers.
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(false);
	});

	it('REAPS a red-gate job once its work branch is pushed to the arbiter (ADR §4: provable safety)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const config = configFor(scratch.root, {workspacesDir, verify: FAIL});
		// A red gate bounces the item to needs-attention AND pushes the work branch
		// (the gate-fail-pushes-work-branch fix) so the wip is cross-machine
		// recoverable. The branch is now provably on the arbiter (pushed), so the
		// worktree is REAPED at teardown — ADR §4: "the trigger is provable safety,
		// not 'success'; a job whose commits are on the arbiter is reaped." Recovery
		// rides on the pushed branch, not the local worktree.
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('tests-failed');

		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(false);
		// The work branch + the aborted wip are on the arbiter (the durable artifact).
		gitIn(['fetch', '-q', 'arbiter'], repo);
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/slice-feat'],
				repo,
			).trim(),
		).not.toBe('');
		expect(
			gitIn(
				['cat-file', '-e', 'arbiter/work/slice-feat:agent-output.txt'],
				repo,
			),
		).toBe('');
	});
});

describe('runOnce — rebase-before-integrate (ADR §10)', () => {
	it('routes a rebase conflict to needs-attention without auto-resolving or moving main', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['feat']);
		const {repo, arbiter} = seeded;
		const workspacesDir = join(scratch.root, '.agent-runner');
		// Global merge so a clean run WOULD land on main; the conflict must stop it.
		const config = configFor(scratch.root, {
			workspacesDir,
			integration: 'merge',
		});

		const report = scanProject(config);

		// The agent edits shared.txt one way. WHILE it "works" (i.e. after the job
		// worktree was cut from the then-current main), a parallel branch lands a
		// CONFLICTING edit to the same file on the arbiter's main. So at integrate
		// time the rebase onto the advanced main conflicts (ADR §10).
		const conflictingAgent: AgentRunner = ({cwd}) => {
			writeFileSync(join(cwd, 'shared.txt'), 'agent version\n');
			const other = seeded.clone('other');
			writeFileSync(join(other, 'shared.txt'), 'main version\n');
			gitIn(['add', '-A'], other);
			gitIn(['commit', '-q', '-m', 'main edits shared'], other);
			gitIn(['push', '-q', 'arbiter', 'HEAD:main'], other);
			return {ok: true};
		};

		const result = await runOnce({
			config,
			report,
			workspace: workspacesDir,
			agentRunner: conflictingAgent,
			env: gitEnv(),
		});

		expect(result.items[0].status).toBe('needs-attention');
		expect(result.needsAttention).toBe(1);
		expect(result.claimedAndDone).toBe(0);
		expect(result.items[0].detail).toMatch(/conflict/i);

		// The integrate-time rebase-conflict bounce now PUSHES the work branch (the
		// un-rebased tip — the rebase was aborted, ADR §10) so the saved work is
		// cross-machine recoverable via requeue-continue. Because the branch is now
		// provably on the arbiter, the worktree is REAPED at teardown (ADR §4:
		// provable safety, not 'success') — recovery rides on the pushed branch, not
		// the local worktree (parity with the red-gate bounce).
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(false);
		// The work branch + the agent's (un-rebased) work are on the arbiter. Read the
		// bare arbiter DIRECTLY via ls-remote (provider-agnostic; does not depend on a
		// fetch refspec populating a remote-tracking ref).
		expect(arbiterHasBranch(arbiter, repo, 'work/slice-feat')).toBe(true);
		// The needs-attention surface is on the arbiter's main (mode-M), where it is
		// observable to scan/status/another machine.
		expect(stuckLockOnArbiter(repo, 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);

		// main was NOT advanced to the agent's version (never auto-resolved).
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const mainShared = gitIn(['show', 'arbiter/main:shared.txt'], repo);
		expect(mainShared).toBe('main version\n');
	});
});

describe('runOnce — pi harness wiring (config.harness = "pi", stubbed pi CLI)', () => {
	/**
	 * Write a stubbed `pi` CLI that edits a file in its cwd (so the work commit is
	 * non-empty), records the prompt it received on stdin, honours `--session
	 * <file>` (creating the file), and exits 0 — standing in for a real pi run
	 * (impractical in CI).
	 */
	function writePiStub(promptFile: string): string {
		const bin = join(scratch.root, 'pi-stub.sh');
		const script = [
			'#!/usr/bin/env bash',
			`cat > ${JSON.stringify(promptFile)}`,
			'session_file=""',
			'prev=""',
			'for a in "$@"; do',
			'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
			'  prev="$a"',
			'done',
			'if [ -n "$session_file" ]; then mkdir -p "$(dirname "$session_file")"; : > "$session_file"; fi',
			'printf "pi work\\n" > agent-output.txt',
			'exit 0',
		].join('\n');
		writeFileSync(bin, script + '\n');
		chmodSync(bin, 0o755);
		return bin;
	}

	/**
	 * A pi stub that records the prompt + honours `--session <file>` (so the pi
	 * harness record's PID + session pointer are written), edits a file, makes the
	 * arbiter REJECT `work/*` branch pushes (a pre-receive hook on the bare mirror —
	 * the work-branch push FAILS while the on-main surface still lands), then EXITS
	 * NON-ZERO (agent failure). In `run`, an agent failure now routes through the
	 * seam (save + surface + push the work branch — `centralise-bounce-branch-push`)
	 * — normally the pushed branch is provably-on-arbiter ⇒ the worktree is REAPED.
	 * By making the seam's BEST-EFFORT branch push fail, the branch does NOT reach
	 * the arbiter, so the §4 predicate keeps the worktree RETAINED — the genuinely-
	 * un-pushed case (a failed/offline push) — letting this test read the harness
	 * record after teardown. (Repointed from the old "agent-fail bare-returns, never
	 * pushes" gap, now closed by `centralise-bounce-branch-push`; see
	 * `work/notes/observations/run-agent-failure-does-not-save-work.md`.) Only `work/*` is
	 * rejected, so the OBSERVABLE on-main surface still publishes — isolating the
	 * RECOVERABLE-push failure.
	 */
	function writeFailingPiStub(promptFile: string): string {
		const bin = join(scratch.root, 'pi-fail-stub.sh');
		const script = [
			'#!/usr/bin/env bash',
			`cat > ${JSON.stringify(promptFile)}`,
			'session_file=""',
			'prev=""',
			'for a in "$@"; do',
			'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
			'  prev="$a"',
			'done',
			'if [ -n "$session_file" ]; then mkdir -p "$(dirname "$session_file")"; : > "$session_file"; fi',
			// Make the arbiter REJECT the work-branch push (still accept the main
			// surface): install a pre-receive hook on the bare mirror (origin) declining
			// any refs/heads/work/ ref. The seam's best-effort branch push in
			// saveAgentFailure then fails (swallowed) => the branch never reaches the
			// arbiter => the worktree is RETAINED and its harness record survives.
			'origin_dir="$(git remote get-url origin)"',
			'origin_dir="${origin_dir#file://}"',
			'mkdir -p "$origin_dir/hooks"',
			'hook="$origin_dir/hooks/pre-receive"',
			'cat > "$hook" <<\'HOOK\'',
			'#!/usr/bin/env bash',
			'while read -r _o _n ref; do',
			'  case "$ref" in refs/heads/work/*) exit 1;; esac',
			'done',
			'exit 0',
			'HOOK',
			'chmod +x "$hook"',
			'printf "pi work\\n" > agent-output.txt',
			'exit 1',
		].join('\n');
		writeFileSync(bin, script + '\n');
		chmodSync(bin, 0o755);
		return bin;
	}

	it('launches pi (not agentCmd) with the work-agent prompt and records the pi harness block', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		void repo;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const promptFile = join(scratch.root, 'seen-prompt.txt');
		const piBin = writePiStub(promptFile);
		// harness: pi, and a deliberately bogus agentCmd to prove the null path is
		// NOT taken (the pi adapter invokes the pi CLI directly).
		const config = configFor(scratch.root, {
			workspacesDir,
			harness: 'pi',
			piBin,
			agentCmd: 'exit 99',
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			// No agentRunner injection ⇒ the real harness seam (pi adapter) runs.
			env: gitEnv(),
		});

		expect(result.items[0].status).toBe('claimed-done');

		// pi received the standard work-agent prompt on stdin (wrapper + ## Prompt),
		// proving the pi adapter — not the bogus agentCmd — launched the agent.
		const seenPrompt = readFileSync(promptFile, 'utf8');
		expect(seenPrompt).toContain('Implement feat.');

		// The item went green → done (the pi-edited file made a non-empty commit
		// that passed the gate + integrated), and its worktree was reaped on
		// success — confirming the pi launch fed the pipeline end-to-end.
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(false);
	});

	it('an agent-failed pi job retains the pi harness record (PID + session pointer)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const promptFile = join(scratch.root, 'seen-prompt-2.txt');
		// We need a RETAINED worktree to read its harness record after teardown. Now
		// that `run`'s agent-failure routes through the seam (save + surface + PUSH the
		// work branch — `centralise-bounce-branch-push`), a reachable-arbiter bounce is
		// REAPED (ADR §4: provably-on-arbiter ⇒ reaped), exactly like the red-gate /
		// integrate-conflict bounces. The remaining genuinely-RETAINED case is a bounce
		// whose best-effort push FAILED — an OFFLINE arbiter. `writeFailingPiStub` breaks
		// the worktree's origin before exiting non-zero, so the branch never reaches the
		// arbiter and the worktree is retained — its harness record survives.
		const piBin = writeFailingPiStub(promptFile);
		const config = configFor(scratch.root, {
			workspacesDir,
			harness: 'pi',
			piBin,
			agentCmd: '',
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			env: gitEnv(),
			// The arbiter is broken (offline), so the needs-attention route's surface +
			// branch pushes FAIL and are retried with bounded backoff. Inject a no-op
			// sleep + tiny cap so the (correct) bounded give-up happens with NO real
			// wall-clock waits (the route stays fault-tolerant; the worktree is
			// retained because the push never reached the arbiter).
			sleep: async () => {},
			backoff: {maxAttempts: 2, initialDelayMs: 1, maxTotalMs: 10},
		});
		expect(result.items[0].status).toBe('agent-failed');

		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		const record = readJobRecord(dir);
		// Liveness is anchored on PID + the pi session pointer — NOT mtime (ADR §5).
		expect(record?.harness.adapter).toBe('pi');
		expect(typeof record?.harness.pid).toBe('number');
		// The recorded session is the EXACT generated `--session` path: absolute,
		// ends `.jsonl`, and — the fix — NOT pinned into the worktree (no
		// `.agent-runner-pi-session/` pollution under the job dir).
		const session = record?.harness.session;
		expect(session).toBeDefined();
		expect(isAbsolute(session!)).toBe(true);
		expect(session!.endsWith('.jsonl')).toBe(true);
		expect(session!.includes('.agent-runner-pi-session')).toBe(false);
		// pi got the work-agent prompt, not the (empty) agentCmd path.
		expect(readFileSync(promptFile, 'utf8')).toContain('Implement feat.');
	});
});

describe('runOnce — config.model flows through the seam to both adapters (ADR §13)', () => {
	/** A pi stub that records its args + edits a file (non-empty commit). */
	function writePiArgsStub(argsFile: string): string {
		const bin = join(scratch.root, 'pi-args-stub.sh');
		const script = [
			'#!/usr/bin/env bash',
			`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
			'session_file=""',
			'prev=""',
			'for a in "$@"; do',
			'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
			'  prev="$a"',
			'done',
			'if [ -n "$session_file" ]; then mkdir -p "$(dirname "$session_file")"; : > "$session_file"; fi',
			'cat > /dev/null',
			'printf "pi work\\n" > agent-output.txt',
			'exit 0',
		].join('\n');
		writeFileSync(bin, script + '\n');
		chmodSync(bin, 0o755);
		return bin;
	}

	it('pi adapter: config.model reaches pi as a native --model (verified vs the stub)', async () => {
		seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const argsFile = join(scratch.root, 'pi-args.txt');
		const piBin = writePiArgsStub(argsFile);
		const config = configFor(scratch.root, {
			workspacesDir,
			harness: 'pi',
			piBin,
			model: 'anthropic/claude-sonnet-4',
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');

		const args = readFileSync(argsFile, 'utf8').split('\n');
		expect(args).toContain('--model');
		expect(args).toContain('anthropic/claude-sonnet-4');
	});

	it('null/shell adapter: config.model substitutes {model} in agentCmd', async () => {
		seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const seen = join(scratch.root, 'seen-model.txt');
		// agentCmd carries a {model} placeholder + edits a file (non-empty commit).
		const config = configFor(scratch.root, {
			workspacesDir,
			model: 'some/model',
			agentCmd: `printf '%s' '{model}' > ${JSON.stringify(seen)}; printf 'work\\n' > agent-output.txt`,
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			// No agentRunner injection ⇒ the real null harness seam runs agentCmd.
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');
		expect(readFileSync(seen, 'utf8')).toBe('some/model');
	});

	it('null/shell adapter: {model} in agentCmd with no model ⇒ agent-failed (clear error)', async () => {
		seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const config = configFor(scratch.root, {
			workspacesDir,
			// no model set, but agentCmd references {model}
			agentCmd: 'agent --model {model}',
		});

		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(result.items[0].detail).toMatch(/\{model\}/);
	});
});

/**
 * The autonomous-path PR-INTENT pre-flight guard on the `run` daemon (slice
 * `propose-pr-intent-guard-on-autonomous-paths`): per item, AFTER
 * `resolveRepoConfig`/`gitEnv` and BEFORE the CLAIM, `runOneItem` runs the SAME
 * up-front `gh` probe + `shouldFailProposePrIntent` the in-place `performDo` step
 * 3c runs. The probe runs PRE-CLAIM so a refusal never strands an item claimed
 * (in-progress on main): a propose item on a GitHub arbiter that INTENDS a PR
 * fails fast (clean PRE-CLAIM `config-error` item result) when `gh` is genuinely
 * unauthed, instead of silently degrading at integration. The probe is INJECTED
 * (no real `gh`); a GitHub arbiter URL is set on the checkout's `arbiter` remote
 * so `arbiterUrlForRepo` reads it as GitHub, with no real github network op (the
 * guard refuses / short-circuits before any claim push).
 */
describe('runOnce — PR-INTENT pre-flight guard (autonomous path)', () => {
	const GH_URL = 'https://github.com/o/r.git';

	it('EARLY VISIBLE FAILURE: propose + GitHub arbiter + noPR unset + a failing gh PROBE ⇒ clean PRE-CLAIM config-error, NO claim/build, siblings unaffected', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Point the configured arbiter remote at a GitHub URL (read-only: the guard
		// refuses BEFORE any claim push, so no real github op runs).
		gitIn(['remote', 'set-url', 'arbiter', GH_URL], repo);
		const config = configFor(scratch.root, {integration: 'propose'});

		let agentRan = false;
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			// The probe says `gh` cannot open a PR.
			ghCanOpenPr: () => false,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		const item = result.items[0];
		// A clean PRE-CLAIM refusal on a non-slice-fault status (config-error), NOT a
		// half-built needs-attention, with the shared guard message verbatim.
		expect(item.status).toBe('config-error');
		expect(item.detail).toBe(PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE);
		expect(result.claimedAndDone).toBe(0);
		// NO build ran, and the item was NEVER claimed (still in backlog on the
		// arbiter — read against the still-local bare arbiter via the pristine clone).
		expect(agentRan).toBe(false);
	});

	it('does NOT crash the tick or abort SIBLINGS: a refused propose+gh-unavailable item leaves other repos’ items to proceed', async () => {
		// Repo A: a GitHub arbiter, propose, failing probe ⇒ refused (config-error).
		const {repo: repoA} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['remote', 'set-url', 'arbiter', GH_URL], repoA);
		// Repo B: an independent local (non-GitHub) arbiter, merge ⇒ proceeds green.
		const repoBRoot = join(scratch.root, 'b-root');
		const {repo: repoB} = seedRepoWithArbiter(repoBRoot, ['beta']);

		const config = configFor(scratch.root, {integration: 'propose'});
		const report = scanRepoPaths([repoA, repoB], config);
		const result = await runOnce({
			config,
			report,
			workspace: join(scratch.root, 'ws'),
			// repoA's github URL trips the probe; repoB's file:// arbiter is non-GitHub,
			// so the predicate short-circuits there (the probe is irrelevant).
			ghCanOpenPr: () => false,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		const byRepo = new Map(result.items.map((i) => [i.repoPath, i]));
		expect(byRepo.get(repoA)?.status).toBe('config-error');
		// The sibling (repoB) was NOT aborted by repoA's refusal — it built + landed
		// (propose: the item completed, work branch pushed; the body stays in backlog/
		// on main since claim writes nothing there).
		expect(byRepo.get(repoB)?.status).toBe('claimed-done');
		expect(existsOnArbiterMain(repoB, 'backlog', 'beta')).toBe(true);
	});

	it('AMBIENT AUTH NOT BROKEN: propose + GitHub arbiter + noPR unset + a PASSING probe ⇒ the guard does NOT refuse (proceeds PAST it)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['remote', 'set-url', 'arbiter', GH_URL], repo);
		const config = configFor(scratch.root, {integration: 'propose'});

		let probed = false;
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			// No `providers.github` identity, but the probe PASSES (ambient `gh` auth).
			ghCanOpenPr: () => {
				probed = true;
				return true;
			},
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		// The probe ran and let the run THROUGH the guard (it proceeded into the
		// claim/build against the offline github arbiter, which then fails some other
		// way — but NOT the up-front PR-intent guard).
		expect(probed).toBe(true);
		const item = result.items[0];
		expect(item.detail).not.toBe(PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE);
	});

	it('MERGE mode ⇒ the guard never fires (no PR is opened), even on a GitHub arbiter with a failing probe', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['remote', 'set-url', 'arbiter', GH_URL], repo);
		// merge mode (the configFor default), GitHub arbiter, failing probe.
		const config = configFor(scratch.root, {integration: 'merge'});

		let probed = false;
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			ghCanOpenPr: () => {
				probed = true;
				return false;
			},
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		// merge short-circuits the predicate BEFORE the probe: no guard refusal
		// (the probe is never consulted). The build then proceeds past the guard.
		expect(probed).toBe(false);
		expect(result.items[0].detail).not.toBe(
			PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE,
		);
		void repo;
	});

	it('noPR: true ⇒ the guard never fires (PR deliberately suppressed), even on a GitHub arbiter with a failing probe', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['remote', 'set-url', 'arbiter', GH_URL], repo);
		const config = configFor(scratch.root, {
			integration: 'propose',
			noPR: true,
		});

		let probed = false;
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			ghCanOpenPr: () => {
				probed = true;
				return false;
			},
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		// `noPR: true` short-circuits BEFORE the probe: no refusal, probe unconsulted.
		expect(probed).toBe(false);
		expect(result.items[0].detail).not.toBe(
			PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE,
		);
		void repo;
	});

	it('a NON-GitHub (file://) arbiter + propose ⇒ the guard never fires; the item builds + lands', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// The default `arbiter` remote is the local file:// bare arbiter (non-GitHub).
		const config = configFor(scratch.root, {integration: 'propose'});

		let probed = false;
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			ghCanOpenPr: () => {
				probed = true;
				return false;
			},
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		// A non-GitHub arbiter short-circuits the predicate BEFORE the probe: the
		// propose item proceeds (claimed + work branch pushed), never refused.
		expect(probed).toBe(false);
		const item = result.items[0];
		expect(item.status).not.toBe('config-error');
		expect(item.detail ?? '').not.toBe(
			PROPOSE_PR_INTENT_GH_UNAVAILABLE_MESSAGE,
		);
		// propose: the item reached done on the work branch; claim writes nothing to
		// main, so the body stays in backlog/ on main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});
});
