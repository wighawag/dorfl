import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, existsSync, readFileSync, chmodSync} from 'node:fs';
import {runOnce, type AgentRunner, type TestGate} from '../src/run.js';
import {performClaim} from '../src/claim-cas.js';
import {mergeConfig} from '../src/config.js';
import {scan} from '../src/scan.js';
import {readJobRecord, jobWorktreePath} from '../src/workspace.js';
import {piSessionDir} from '../src/pi-harness.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-run-');
});
afterEach(() => {
	scratch.cleanup();
});

/** An agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

const greenGate: TestGate = () => ({green: true});
const redGate: TestGate = () => ({green: false, detail: 'tests failed'});

function configFor(root: string, overrides = {}) {
	// Scan only the seeded `project` repo. Throwaway clones/arbiter live as
	// siblings under `root`; pointing roots at the project keeps them out of scan.
	return mergeConfig({
		roots: [join(root, 'project')],
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		// Seeded slices are undeclared (not humanOnly) — agents may claim them only
		// when this per-repo/global policy is on.
		allowAgents: true,
		...overrides,
	});
}

describe('runOnce — happy path (green gate)', () => {
	it('claims an eligible item, runs the agent, and moves it to done on green tests', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
	it('leaves a red item in in-progress, never moving it to done', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, 'ws');
		const config = configFor(scratch.root);
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			testGate: redGate,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('tests-failed');
		expect(result.claimedAndDone).toBe(0);
		// claim landed (in-progress on main), but it NEVER reached done.
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		// Folder-native surfacing (ADR §12): the runner bounced the work item from
		// in-progress/ to needs-attention/ IN THE WORKTREE, with the reason in its
		// body. (It is not pushed — the worktree/branch is the signal, ADR §4.)
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(join(dir, 'work', 'needs-attention', 'feat.md'))).toBe(
			true,
		);
		expect(existsSync(join(dir, 'work', 'in-progress', 'feat.md'))).toBe(false);
	});
});

describe('runOnce — concurrency caps', () => {
	it('claims at most maxParallel items then stops', async () => {
		seedRepoWithArbiter(scratch.root, ['a', 'b', 'c', 'd', 'e']);
		const config = configFor(scratch.root, {maxParallel: 2, perRepoMax: 10});
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items).toHaveLength(1);
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
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
		// Two independent working clones of the arbiter, each its own scan root.
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		const configFrom = (clone: string) =>
			mergeConfig({
				roots: [clone],
				defaultArbiter: 'arbiter',
				maxParallel: 4,
				perRepoMax: 2,
				integration: 'merge',
				agentCmd: 'true',
				allowAgents: true,
			});

		const runFrom = (clone: string, agentId: string) => {
			const config = configFrom(clone);
			return runOnce({
				config,
				report: scan(config),
				workspace: join(scratch.root, `ws-${agentId}`),
				agentRunner: editingAgent,
				testGate: greenGate,
				env: gitEnv(),
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
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
		expect(prBranch).toBe('work/feat');
		// PR mode never moves done/ onto main; the slice stays in-progress on main.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
	});

	it('integration: merge lands the done-move directly on the arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'merge'});
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
		expect(prBranch).toBe('work/feat');
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
			roots: [a.repo, b.repo],
			defaultArbiter: 'arbiter',
			maxParallel: 4,
			perRepoMax: 2,
			integration: 'merge',
			agentCmd: 'true',
			allowAgents: true,
		});
		let bBranch = '';
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: editingAgent,
			testGate: greenGate,
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
		expect(bBranch).toBe('work/fb');
		expect(existsOnArbiterMain(b.repo, 'done', 'fb')).toBe(false);
	});
});

describe('runOnce — agent failure', () => {
	it('does not move to done when the agent itself fails', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root);
		const failingAgent: AgentRunner = () => ({ok: false, detail: 'boom'});
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: join(scratch.root, 'ws'),
			agentRunner: failingAgent,
			testGate: greenGate,
			env: gitEnv(),
			agentId: () => 'agentA',
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(true);
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
			report: scan(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			testGate: greenGate,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('claimed-done');

		// The job's work is on the arbiter (merged), so the worktree was REAPED
		// (git worktree remove + prune, never rm -rf) — nothing lingers.
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(false);
	});

	it('RETAINS a finished job whose work is not on the arbiter (needs-attention signal)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		void repo;
		const workspacesDir = join(scratch.root, '.agent-runner');
		const config = configFor(scratch.root, {workspacesDir});
		// A red gate ⇒ the work never reaches the arbiter ⇒ NOT provably safe ⇒
		// the worktree + record are retained for gc/status to read (ADR §4).
		const result = await runOnce({
			config,
			report: scan(config),
			workspace: workspacesDir,
			agentRunner: editingAgent,
			testGate: redGate,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('tests-failed');

		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(existsSync(dir)).toBe(true);
		const record = readJobRecord(dir);
		expect(record?.slug).toBe('feat');
		expect(record?.branch).toBe('work/feat');
		expect(record?.state).toBe('needs-attention');
		expect(record?.harness).toBeDefined();
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

		const report = scan(config);

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
			testGate: greenGate,
			env: gitEnv(),
		});

		expect(result.items[0].status).toBe('needs-attention');
		expect(result.needsAttention).toBe(1);
		expect(result.claimedAndDone).toBe(0);
		expect(result.items[0].detail).toMatch(/conflict/i);

		// The job record reflects needs-attention; the worktree is retained.
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		expect(readJobRecord(dir)?.state).toBe('needs-attention');
		// Folder-native surfacing (ADR §12): the item was already done-moved before
		// the rebase, so the runner bounces it from done/ to needs-attention/.
		expect(existsSync(join(dir, 'work', 'needs-attention', 'feat.md'))).toBe(
			true,
		);
		expect(existsSync(join(dir, 'work', 'done', 'feat.md'))).toBe(false);

		// main was NOT advanced to the agent's version (never auto-resolved).
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const mainShared = gitIn(['show', 'arbiter/main:shared.txt'], repo);
		expect(mainShared).toBe('main version\n');
	});
});

describe('runOnce — pi harness wiring (config.harness = "pi", stubbed pi CLI)', () => {
	/**
	 * Write a stubbed `pi` CLI that edits a file in its cwd (so the work commit is
	 * non-empty), records the prompt it received on stdin, honours `--session-dir`,
	 * and exits 0 — standing in for a real pi run (impractical in CI).
	 */
	function writePiStub(promptFile: string): string {
		const bin = join(scratch.root, 'pi-stub.sh');
		const script = [
			'#!/usr/bin/env bash',
			`cat > ${JSON.stringify(promptFile)}`,
			'session_dir=""',
			'prev=""',
			'for a in "$@"; do',
			'  if [ "$prev" = "--session-dir" ]; then session_dir="$a"; fi',
			'  prev="$a"',
			'done',
			'if [ -n "$session_dir" ]; then mkdir -p "$session_dir"; fi',
			'printf "pi work\\n" > agent-output.txt',
			'exit 0',
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
			report: scan(config),
			workspace: workspacesDir,
			// No agentRunner injection ⇒ the real harness seam (pi adapter) runs.
			testGate: greenGate,
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

	it('a red gate retains the pi job with a pi harness record (PID + session pointer)', async () => {
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		const promptFile = join(scratch.root, 'seen-prompt-2.txt');
		const piBin = writePiStub(promptFile);
		const config = configFor(scratch.root, {
			workspacesDir,
			harness: 'pi',
			piBin,
			agentCmd: '',
		});

		const result = await runOnce({
			config,
			report: scan(config),
			workspace: workspacesDir,
			testGate: redGate, // keeps the worktree retained so we can read the record
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('tests-failed');

		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		const record = readJobRecord(dir);
		// Liveness is anchored on PID + the pi session pointer — NOT mtime (ADR §5).
		expect(record?.harness.adapter).toBe('pi');
		expect(typeof record?.harness.pid).toBe('number');
		expect(record?.harness.session).toBe(piSessionDir(dir));
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
			'session_dir=""',
			'prev=""',
			'for a in "$@"; do',
			'  if [ "$prev" = "--session-dir" ]; then session_dir="$a"; fi',
			'  prev="$a"',
			'done',
			'if [ -n "$session_dir" ]; then mkdir -p "$session_dir"; fi',
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
			report: scan(config),
			workspace: workspacesDir,
			testGate: greenGate,
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
			report: scan(config),
			workspace: workspacesDir,
			// No agentRunner injection ⇒ the real null harness seam runs agentCmd.
			testGate: greenGate,
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
			report: scan(config),
			workspace: workspacesDir,
			testGate: greenGate,
			env: gitEnv(),
		});
		expect(result.items[0].status).toBe('agent-failed');
		expect(result.items[0].detail).toMatch(/\{model\}/);
	});
});
