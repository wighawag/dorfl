import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	mkdirSync,
	existsSync,
	readdirSync,
	statSync,
} from 'node:fs';
import {join} from 'node:path';
import type {Command} from 'commander';
import {
	performDoRemote,
	resolveArbiterUrlFromCheckout,
	type DoAgentRunner,
} from '../src/do.js';
import {buildProgram} from '../src/cli.js';
import {mirrorPath} from '../src/repo-mirror.js';
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
 * `do --isolated <slug>` tests (slice `do-isolated-in-place`) — build a slice in
 * an ISOLATED job worktree off THIS repo's arbiter (inferred from the cwd's
 * arbiter remote), instead of taking over the current checkout. It is ORTHOGONAL
 * to `do --remote <url>` (a foreign repo) and purely ADDITIVE: it REUSES the
 * EXACT `performDoRemote` job-worktree pipeline — the only new logic is resolving
 * the arbiter-URL-from-cwd and threading it in as that pipeline's `remote`.
 *
 * House style (mirrors do-remote.test.ts): a throwaway project + a local `--bare`
 * arbiter, a TEMP `workspacesDir` (the agents' area), `isolatePiAgentDir`, and a
 * STUBBED agent (injected `agentRunner`, never a real harness). The end-to-end
 * tests resolve the arbiter URL from the cwd checkout via the new
 * `resolveArbiterUrlFromCheckout` (the genuinely-new primitive) and feed it into
 * the SHARED pipeline — proving the isolated build lands off the cwd arbiter in a
 * job worktree WITHOUT touching the checkout or the human area.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-isolated-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const PASS = 'exit 0';

/** The temp agents' execution area for a run (the worktrees + mirrors live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/** A stubbed agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

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

describe('resolveArbiterUrlFromCheckout — the arbiter-from-cwd primitive', () => {
	it('resolves the URL of a checkout\u2019s arbiter remote', () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// seedRepoWithArbiter wires the remote `arbiter` -> file://<arbiter>.
		const url = resolveArbiterUrlFromCheckout(repo, 'arbiter', gitEnv());
		expect(url).toBe(`file://${arbiter}`);
	});

	it('returns undefined when the named arbiter remote does not exist', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// `origin` is not wired in the seeded repo (only `arbiter` is).
		expect(resolveArbiterUrlFromCheckout(repo, 'origin', gitEnv())).toBe(
			undefined,
		);
	});

	it('returns undefined when the cwd is not a git repo at all', () => {
		const notARepo = join(scratch.root, 'plain-dir');
		mkdirSync(notARepo, {recursive: true});
		expect(resolveArbiterUrlFromCheckout(notARepo, 'origin', gitEnv())).toBe(
			undefined,
		);
	});
});

describe('do --isolated — builds in a job worktree off the CWD arbiter', () => {
	it('resolves the cwd arbiter URL and runs the SHARED pipeline off it, never touching the checkout', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();

		// The checkout starts on `main`; `--isolated` must NOT take it over.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);

		// This is exactly what the CLI `--isolated` branch does: resolve the cwd's
		// arbiter remote URL, then drive the EXISTING performDoRemote pipeline with
		// that URL as `remote`. No forked isolation/integrate path.
		const isolatedRemote = resolveArbiterUrlFromCheckout(
			repo,
			'arbiter',
			gitEnv(),
		);
		expect(isolatedRemote).toBe(`file://${arbiter}`);

		let agentCwd = '';
		const result = await performDoRemote({
			arg: 'alpha',
			remote: isolatedRemote as string,
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: (input) => {
				agentCwd = input.cwd;
				return editingAgent(input);
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');

		// The agent ran inside the AGENTS' area job worktree (under workspacesDir/
		// work/), NOT in the human checkout.
		expect(agentCwd.startsWith(join(ws, 'work'))).toBe(true);
		expect(agentCwd.startsWith(repo)).toBe(false);

		// merge mode → the work landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);

		// The hub mirror was created in the agents' area; the human checkout is
		// untouched (still on main, no agent-output.txt in the working clone).
		expect(existsSync(mirrorPath(ws, isolatedRemote as string))).toBe(true);
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			'main',
		);
		expect(existsSync(join(repo, 'agent-output.txt'))).toBe(false);
	});

	it('NEVER writes the human worktree area (the agents\u2019 area only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const ws = workspacesDir();
		const humanArea = join(scratch.root, 'human-worktrees');
		mkdirSync(humanArea, {recursive: true});

		const isolatedRemote = resolveArbiterUrlFromCheckout(
			repo,
			'arbiter',
			gitEnv(),
		) as string;
		const result = await performDoRemote({
			arg: 'alpha',
			remote: isolatedRemote,
			workspacesDir: ws,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');

		// The human area was NEVER written.
		expect(listAllFiles(humanArea)).toEqual([]);
	});
});

/**
 * CLI-surface tests for the new `--isolated` boolean on the shared `.command('do')`
 * block — it is ADDITIVE: `--remote`, `--merge`/`--propose`, and the variadic
 * grammar still live on the same block, byte-unchanged.
 */
function doCommand(): Command {
	const program = buildProgram();
	const cmd = program.commands.find((c) => c.name() === 'do');
	if (!cmd) {
		throw new Error("no 'do' command registered");
	}
	return cmd;
}

/**
 * Drive argv through the program, intercepting `process.exit` (the `do` action
 * exits) and capturing stderr. Returns the captured error text + the exit code.
 */
async function runDo(
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
		await program.parseAsync(['node', 'agent-runner', 'do', ...argv]);
	} catch {
		// Our exit shim (or commander exitOverride) throws — captured above.
	} finally {
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {captured, code};
}

describe('do --isolated — CLI surface (additive on the shared block)', () => {
	it('adds a boolean --isolated option to the do command', () => {
		const opts = doCommand().options;
		const isolated = opts.find((o) => o.long === '--isolated');
		expect(isolated).toBeDefined();
		// Boolean flag: no value placeholder.
		expect(isolated?.required).toBe(false);
		expect(isolated?.optional).toBe(false);
	});

	it('keeps --remote, --merge/--propose, and the variadic grammar on the SAME block', () => {
		const flags = doCommand().options.map((o) => o.flags);
		expect(flags.some((f) => f.startsWith('--remote'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--merge'))).toBe(true);
		expect(flags.some((f) => f.startsWith('--propose'))).toBe(true);
		expect(doCommand().usage()).toMatch(/\[slugs\.\.\.\]/);
	});
});

describe('do --isolated — the no-arbiter error (isolated against what?)', () => {
	it('errors CLEARLY when the cwd has no resolvable arbiter, naming --remote <url>', async () => {
		// A plain git repo with NO arbiter remote (and the default arbiter name).
		const plain = join(scratch.root, 'no-arbiter');
		mkdirSync(plain, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], plain);

		const {captured, code} = await runDo(['--isolated', 'alpha'], plain);
		expect(code).toBe(1);
		// The message names the FOREIGN-repo alternative, not a URL-parse failure.
		expect(captured).toMatch(/--isolated/);
		expect(captured).toMatch(/--remote <url>/);
		expect(captured).not.toMatch(/parse|ENOENT|clone failed/i);
	});
});

describe('do --isolated + --remote — REDUNDANT: remote wins (isolation implied)', () => {
	it('with --remote present, --isolated is a no-op: the cwd arbiter is NOT consulted (no “isolated against what?” error even with no cwd arbiter)', async () => {
		// A real seeded arbiter to target via --remote, but run from a cwd with NO
		// resolvable arbiter. If --isolated were taking precedence it would raise the
		// no-arbiter error; instead --remote WINS and the remote pipeline runs (and,
		// with `agentCmd` deliberately unset, fails the agent-cmd guard — proving it
		// reached the REMOTE branch, not the isolated no-arbiter branch).
		const {arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const plain = join(scratch.root, 'no-arbiter-but-remote');
		mkdirSync(plain, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], plain);
		// A hermetic config: a SCRATCH workspacesDir (so the remote branch's mirror
		// materialises in scratch, never the real ~/.agent-runner) and NO agentCmd
		// (so the missing-agentCmd guard fires deterministically, regardless of any
		// developer/CI global config).
		const cfg = join(scratch.root, 'hermetic-config.json');
		writeFileSync(
			cfg,
			JSON.stringify({workspacesDir: join(scratch.root, 'agents-area')}) + '\n',
		);

		const {captured, code} = await runDo(
			['--isolated', '--remote', `file://${arbiter}`, 'alpha', '--config', cfg],
			plain,
		);
		expect(code).toBe(1);
		// NOT the isolated no-arbiter message (that would mean --isolated won).
		expect(captured).not.toMatch(
			/isolated against|builds in a worktree off this repo/i,
		);
		// It reached the REMOTE pipeline: the missing-agentCmd guard fired.
		expect(captured).toMatch(/agentCmd/);
	});
});

describe('do --isolated — -n/auto-pick now SELECTS over the mirror-side pool (refusal removed)', () => {
	// The inline `-n`×isolated/remote REFUSAL is GONE — the mirror-side pool scan
	// backs it now (US #25). `--isolated -n` / `--isolated <a> <b>` reach the
	// mirror-side auto-pick path; they NO LONGER hit the old "does not combine" /
	// "needs exactly one item" refusals. We assert the refusal text is ABSENT and a
	// hermetic run reaches the pool path instead.
	//
	// `--isolated` resolves the arbiter URL from the cwd's arbiter remote (named
	// `arbiter` in the fixture), so we pass `--arbiter arbiter` + a hermetic config
	// (scratch workspacesDir so the mirror materialises in scratch, never the real
	// ~/.agent-runner). With `allowAgents` off (the default) the mirror scan selects
	// NOTHING — calm-at-rest, exit 0 — proving the refusal is gone and the auto-pick
	// path ran.
	function hermeticConfig(): string {
		const cfg = join(
			scratch.root,
			`hermetic-${Math.random().toString(36).slice(2)}.json`,
		);
		writeFileSync(
			cfg,
			JSON.stringify({workspacesDir: join(scratch.root, 'agents-area')}) + '\n',
		);
		return cfg;
	}

	it('`--isolated -n <x>` no longer refuses — it reaches the mirror-side auto-pick path', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const {captured} = await runDo(
			[
				'--isolated',
				'-n',
				'2',
				'--arbiter',
				'arbiter',
				'--config',
				hermeticConfig(),
			],
			repo,
		);
		// NOT the old refusal — `-n`×isolated is supported now.
		expect(captured).not.toMatch(/does not.*combine|needs exactly one item/i);
		// It got PAST the refusal: either the agentCmd guard (hermetic config has no
		// agentCmd) or the mirror-side auto-pick's "nothing eligible" — both prove the
		// refusal is gone and the auto-pick branch was reached.
		expect(captured).toMatch(/agentCmd|nothing eligible/i);
	});

	it('`--isolated <a> <b>` no longer refuses — multi-arg is supported now', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const {captured} = await runDo(
			[
				'--isolated',
				'alpha',
				'beta',
				'--arbiter',
				'arbiter',
				'--config',
				hermeticConfig(),
			],
			repo,
		);
		// NOT the old "needs exactly one item" / "does not combine" refusals — the
		// no-checkout forms now share the variadic grammar.
		expect(captured).not.toMatch(/--isolated needs exactly one item/);
		expect(captured).not.toMatch(/does not.*combine/i);
		expect(captured).toMatch(/agentCmd|nothing eligible|did \d+ remote/i);
	});
});
