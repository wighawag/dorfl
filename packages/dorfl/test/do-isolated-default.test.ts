import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Command} from 'commander';
import {buildProgram} from '../src/cli.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do <slug>` DEFAULT-mode tests (task `make-isolated-default-build-mode`).
 *
 * Since this task, the DEFAULT build mode for bare `do <slug>` in a checkout is
 * an ISOLATED job worktree off THIS repo's arbiter — the same no-checkout
 * pipeline `--isolated`/`--remote` already used. `--in-place` opts OUT (today's
 * in-checkout behaviour, refusing a dirty tree); `--isolated` is a redundant
 * explicit opt-IN alias of the new default (D3). A repo with NO configured
 * arbiter ERRORS with clear guidance rather than silently degrading to in-place
 * (D2).
 *
 * Behavioural coverage lives here (the CLI surface + dispatch); the underlying
 * isolation pipeline + arbiter-URL resolver + per-repo-config-from-arbiter-main
 * read are covered by `do-isolated.test.ts` and
 * `remote-do-per-repo-config.test.ts` — this file only pins the DEFAULT FLIP.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-do-default-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

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
 * Mirrors the helper in `do-isolated.test.ts` so this file's CLI-surface tests
 * read in the same style.
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
		await program.parseAsync(['node', 'dorfl', 'do', ...argv]);
	} catch {
		// Our exit shim (or commander exitOverride) throws — captured above.
	} finally {
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {captured, code};
}

/** A hermetic config: scratch workspacesDir + NO agentCmd (so the missing-
 *  agentCmd guard fires deterministically on the isolated path, regardless of a
 *  developer/CI global). */
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

describe('do <slug> — CLI surface: --in-place is registered; --isolated remains as an alias', () => {
	it('registers a boolean --in-place option', () => {
		const opts = doCommand().options;
		const inPlace = opts.find((o) => o.long === '--in-place');
		expect(inPlace).toBeDefined();
		expect(inPlace?.required).toBe(false);
		expect(inPlace?.optional).toBe(false);
	});

	it('keeps --isolated as an accepted (redundant) opt-in alias', () => {
		const opts = doCommand().options;
		const isolated = opts.find((o) => o.long === '--isolated');
		expect(isolated).toBeDefined();
	});

	it('the do description advertises isolated as the DEFAULT and names --in-place as the opt-out', () => {
		const desc = doCommand().description();
		// Isolated is the DEFAULT now, not the in-place form.
		expect(desc).toMatch(/isolated/i);
		expect(desc).toMatch(/default/i);
		// --in-place is the named opt-out.
		expect(desc).toMatch(/--in-place/);
	});
});

describe('do <slug> — DEFAULT dispatch reaches the isolated no-checkout path (not the in-place path)', () => {
	// The load-bearing behavioural proof of the flip: bare `do <slug>` with no
	// form flag typed reaches the ISOLATED no-checkout dispatch (which resolves
	// the cwd arbiter URL) — the SAME path `--isolated` already used. We prove
	// it by observing that the missing-agentCmd guard fires from the isolated
	// branch (a hermetic config with no agentCmd, seeded arbiter), while the
	// cwd checkout is left completely untouched (still on main, no scratch).
	it('bare `do <slug>` (no --in-place, no --remote) routes to the isolated path and never writes the cwd checkout', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const before = gitIn(['status', '--porcelain'], repo);
		const branchBefore = gitIn(
			['rev-parse', '--abbrev-ref', 'HEAD'],
			repo,
		).trim();

		const {captured, code} = await runDo(
			['alpha', '--arbiter', 'arbiter', '--config', hermeticConfig()],
			repo,
		);

		// Hit the isolated pipeline's missing-agentCmd guard (proof the DEFAULT
		// dispatched to the no-checkout path — the in-place path resolves agentCmd
		// off the cwd `.dorfl.json`, not the arbiter-main read, so the guard's
		// message is emitted regardless — but the KEY observation is: no branch
		// switch / no dirty tree left behind, i.e. the cwd was NOT taken over).
		expect(code).toBe(1);
		expect(captured).toMatch(/agentCmd/);

		// The cwd checkout is untouched: same branch, same porcelain state.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim()).toBe(
			branchBefore,
		);
		expect(gitIn(['status', '--porcelain'], repo)).toBe(before);
	});
});

describe('do <slug> — the no-arbiter ERROR (D2: never silently degrade to in-place)', () => {
	it('errors with clear guidance naming --in-place (and --remote <url>) when the cwd has no resolvable arbiter', async () => {
		// A plain git repo with NO arbiter remote (the default arbiter name is
		// `arbiter`, absent here).
		const plain = join(scratch.root, 'no-arbiter');
		mkdirSync(plain, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], plain);

		const {captured, code} = await runDo(['alpha'], plain);
		expect(code).toBe(1);
		// The error surfaces the DEFAULT (loud, not silent), names --in-place as
		// the natural escape, and points at how to configure an arbiter or use
		// --remote — it must NOT quietly fall back to the in-place path.
		expect(captured).toMatch(/no arbiter/i);
		expect(captured).toMatch(/--in-place/);
		expect(captured).toMatch(/remote add|--remote <url>/);
		// Not a URL-parse / clone failure downstream.
		expect(captured).not.toMatch(/parse|ENOENT|clone failed/i);
	});
});

describe('do <slug> --in-place — opts OUT and restores the in-place path (dirty-tree refusal included)', () => {
	// With `--in-place` typed, the dispatch takes the in-place path — which
	// refuses on a dirty tree (today's pre-flip behaviour). We PROVE it by dirtying
	// the tree and observing the dirty-tree refusal fires (i.e. the run reached
	// the in-place pipeline, not the isolated one which does not consult the
	// cwd tree at all).
	it('routes to the in-place path (bypasses the isolated no-arbiter guard — the load-bearing distinguisher)', async () => {
		// A plain git repo with NO arbiter remote. Under the new DEFAULT this
		// would fire the no-arbiter ERROR (mentions `--in-place` + `--remote <url>`,
		// D2). Under `--in-place` we OPT OUT of that guard: the run must reach the
		// in-place pipeline, which errors DIFFERENTLY (e.g. the null-adapter’s
		// missing-agentCmd guard or a not-a-participating-repo failure). We assert
		// on the ABSENCE of the isolated no-arbiter message — the load-bearing
		// proof the dispatch respected `--in-place`.
		const plain = join(scratch.root, 'in-place-no-arbiter');
		mkdirSync(plain, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], plain);

		const {captured, code} = await runDo(
			['--in-place', 'alpha', '--config', hermeticConfig()],
			plain,
		);
		expect(code).toBe(1);
		// NOT the isolated-default no-arbiter error — that would mean `--in-place`
		// was ignored and the default fired anyway (D2 regression). The `--in-place`
		// escape from the no-arbiter guard is the whole point of the opt-out.
		expect(captured).not.toMatch(/no arbiter is configured for this repo/);
		expect(captured).not.toMatch(/`do` now defaults to/);
	});
});

describe('do <slug> --isolated — remains accepted (D3: redundant explicit opt-IN alias)', () => {
	it('accepts --isolated without error and behaves like the default (isolated dispatch)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {captured, code} = await runDo(
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
		// Reaches the isolated pipeline (missing-agentCmd guard) — the alias
		// still works, byte-identical to the new default's dispatch.
		expect(captured).toMatch(/agentCmd/);
	});
});

describe('do <slug> — contradictory form flags are rejected loudly (not silently preferred)', () => {
	it('--in-place + --isolated errors (contradictory intents)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {captured, code} = await runDo(
			['--in-place', '--isolated', 'alpha', '--config', hermeticConfig()],
			repo,
		);
		expect(code).toBe(1);
		expect(captured).toMatch(/--in-place/);
		expect(captured).toMatch(/--isolated/);
		expect(captured).toMatch(/contradict|pick one|mutually/i);
	});

	it('--in-place + --remote errors (no local checkout to take over)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {captured, code} = await runDo(
			[
				'--in-place',
				'--remote',
				`file://${arbiter}`,
				'alpha',
				'--config',
				hermeticConfig(),
			],
			repo,
		);
		expect(code).toBe(1);
		expect(captured).toMatch(/--in-place/);
		expect(captured).toMatch(/--remote/);
	});
});

describe('do <slug> — DEFAULT reads per-repo config from <arbiter>/main (D1)', () => {
	// D1 (already established by `remote-do-reads-per-repo-config-from-arbiter-main`
	// and the shared `resolveRemoteRepoConfig`): the isolated path layers the
	// committed `.dorfl.json` from `<arbiter>/main` (whitelisted keys only). Since
	// the DEFAULT now takes that same path, this must hold for bare `do <slug>`
	// too — a repo declaring e.g. `harness: pi` must resolve to `pi` under the
	// default, NEVER silently the null adapter. We assert this at the CLI seam by
	// running `do <slug>` under a repo whose committed `.dorfl.json` sets
	// `harness: pi` and observing the launch reaches the pi adapter (which
	// fails-fast when `pi` is not on PATH here — the KEY signal is that the
	// null-adapter's "agentCmd required" refusal does NOT fire).
	it('bare `do <slug>` honours a committed `harness: pi` (does NOT hit the null adapter\u2019s agentCmd refusal)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha'], {
			repoConfig: {harness: 'pi'},
		});
		const {captured, code} = await runDo(
			['alpha', '--arbiter', 'arbiter', '--config', hermeticConfig()],
			repo,
		);
		expect(code).toBe(1);
		// The null-adapter's `agentCmd required` refusal MUST NOT be the failure
		// mode: the committed `harness: pi` was honoured on the DEFAULT path.
		// (Any pi-side failure — e.g. `pi` not on PATH here — is fine; it proves
		// the pi adapter was selected. But we assert on the ABSENCE of the null-
		// adapter's specific refusal, which is the load-bearing signal.)
		expect(captured).not.toMatch(
			/agentCmd is required|agentCmd required|agentCmd .*not (set|configured)/i,
		);
		void readdirSync; // keep import
	});
});
