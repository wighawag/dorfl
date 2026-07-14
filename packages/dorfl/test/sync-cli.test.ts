import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {run} from '../src/git.js';
import {buildProgram, formatSyncReport} from '../src/cli.js';
import {PROTOCOL_DOCS} from '../src/resync-protocol.js';
import {makeScratch, gitEnv, type Scratch} from './helpers/gitRepo.js';

/**
 * CLI-surface + end-to-end tests for `dorfl sync` (the "get the latest protocol"
 * command). It always re-syncs `work/protocol/*` + bumps VERSION (the
 * deterministic slice of `setup`, shared with `prd-to-spec` via
 * `resync-protocol.ts`), and OPTIONALLY installs the packaged skills.
 *
 * The skills half is asserted to be OFF by default: a non-TTY run without
 * `--add-skills` must NOT touch the developer's real `~/.agents/skills/`. Every
 * write otherwise lands in a throwaway temp repo.
 */

const ENV = gitEnv();

const REAL_HOME_SKILLS = join(homedir(), '.agents', 'skills');
const realHomeSkillsBefore = existsSync(REAL_HOME_SKILLS)
	? readdirSync(REAL_HOME_SKILLS).sort()
	: null;

function assertRealHomeUntouched(): void {
	const now = existsSync(REAL_HOME_SKILLS)
		? readdirSync(REAL_HOME_SKILLS).sort()
		: null;
	expect(now).toEqual(realHomeSkillsBefore);
}

/**
 * Drive argv through the CLI program; capture stdout + stderr + exit code.
 * Mirrors the shape of `skills-add-cli.test.ts`. stdin is NOT a TTY under
 * vitest, so `sync` (no `--add-skills`) never prompts and never installs skills.
 */
async function runCli(
	argv: string[],
): Promise<{out: string; err: string; code: number | undefined}> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	let err = '';
	let code: number | undefined;
	const origLog = console.log;
	const origErr = console.error;
	const origExit = process.exit;
	console.log = (msg?: unknown) => {
		out += String(msg ?? '') + '\n';
	};
	console.error = (msg?: unknown) => {
		err += String(msg ?? '') + '\n';
	};
	(process as {exit: unknown}).exit = ((c?: number) => {
		code = c ?? 0;
		throw new Error(`__exit__:${code}`);
	}) as typeof process.exit;
	try {
		await program.parseAsync(['node', 'dorfl', ...argv]);
		code = code ?? 0;
	} catch {
		// exit shim / commander exitOverride throws — captured above
	} finally {
		console.log = origLog;
		console.error = origErr;
		process.exit = origExit;
	}
	return {out, err, code};
}

/** A throwaway git repo (isolated from the real home) to sync into. */
function makeRepo(scratch: Scratch): string {
	const repo = join(scratch.root, 'repo');
	mkdirSync(repo, {recursive: true});
	run('git', ['init', '-q'], repo, {env: ENV});
	return repo;
}

function porcelain(repo: string): string {
	return run('git', ['status', '--porcelain'], repo, {env: ENV}).stdout.trim();
}

describe('sync — CLI surface registration', () => {
	it('registers a `sync` command with --dry-run and --add-skills', () => {
		const program = buildProgram();
		const sync = program.commands.find((c) => c.name() === 'sync');
		expect(sync).toBeDefined();
		expect(sync!.options.find((o) => o.long === '--dry-run')).toBeDefined();
		expect(sync!.options.find((o) => o.long === '--add-skills')).toBeDefined();
		expect(sync!.options.find((o) => o.long === '--local')).toBeDefined();
	});

	it('shows `sync` in the top-level --help', () => {
		const program = buildProgram();
		expect(program.helpInformation()).toMatch(/\bsync\b/);
	});
});

describe('formatSyncReport — the report shape', () => {
	it('names changed docs, the VERSION bump, and the dry-run framing', () => {
		const out = formatSyncReport(
			{
				docs: [
					{
						name: 'WORK-CONTRACT.md',
						dest: 'work/protocol/WORK-CONTRACT.md',
						unchanged: false,
						skipped: false,
					},
					{
						name: 'ADR-FORMAT.md',
						dest: 'work/protocol/ADR-FORMAT.md',
						unchanged: true,
						skipped: false,
					},
				],
				versionPath: 'work/protocol/VERSION',
			},
			true,
		);
		expect(out).toContain('DRY RUN');
		expect(out).toContain('1 changed, 1 unchanged, 0 skipped');
		expect(out).toContain('work/protocol/WORK-CONTRACT.md');
		expect(out).toContain('WOULD bump');
	});

	it('surfaces a skipped (unresolvable) doc loudly and reports no bump', () => {
		const out = formatSyncReport(
			{
				docs: [
					{
						name: 'WORK-CONTRACT.md',
						dest: 'work/protocol/WORK-CONTRACT.md',
						unchanged: false,
						skipped: true,
					},
				],
				versionPath: 'work/protocol/VERSION',
			},
			false,
		);
		expect(out).toMatch(/WORK-CONTRACT\.md:.*could not be resolved/);
		expect(out).toContain('no doc synced');
	});
});

describe('dorfl sync — end-to-end into a scratch repo', () => {
	let scratch: Scratch;
	let repo: string;

	beforeEach(() => {
		scratch = makeScratch('dorfl-sync-cli-');
		repo = makeRepo(scratch);
	});

	afterEach(() => {
		scratch.cleanup();
		// The skills half is OFF (non-TTY, no --add-skills): the real HOME skills
		// dir must be byte-identical to before.
		assertRealHomeUntouched();
	});

	it('syncs every protocol doc + writes VERSION on a fresh repo', async () => {
		const {out, code} = await runCli(['sync', '--repo', repo]);
		expect(code).toBe(0);
		expect(out).toContain('dorfl sync');
		for (const doc of PROTOCOL_DOCS) {
			expect(existsSync(join(repo, 'work', 'protocol', doc))).toBe(true);
		}
		const version = readFileSync(
			join(repo, 'work', 'protocol', 'VERSION'),
			'utf8',
		);
		expect(version).toContain('source-commit: dorfl sync');
	});

	it('is idempotent: a second sync of already-current docs is a no-op', async () => {
		await runCli(['sync', '--repo', repo]);
		// Commit the first sync so the second run has a clean baseline to dirty.
		run('git', ['add', '-A'], repo, {env: ENV});
		run('git', ['commit', '-q', '-m', 'sync'], repo, {env: ENV});
		expect(porcelain(repo)).toBe('');
		const {code} = await runCli(['sync', '--repo', repo]);
		expect(code).toBe(0);
		// No doc changed and VERSION was already current ⇒ the tree stays clean
		// (the always-fresh `synced-at` must NOT be rewritten on a no-op re-run).
		expect(porcelain(repo)).toBe('');
	});

	it('--dry-run writes nothing', async () => {
		const {out, code} = await runCli(['sync', '--repo', repo, '--dry-run']);
		expect(code).toBe(0);
		expect(out).toContain('DRY RUN');
		expect(existsSync(join(repo, 'work', 'protocol'))).toBe(false);
	});

	it('--json emits the raw re-sync result', async () => {
		const {out, code} = await runCli(['sync', '--repo', repo, '--json']);
		expect(code).toBe(0);
		const parsed = JSON.parse(out) as {
			docs: {name: string}[];
			versionPath: string;
		};
		expect(parsed.docs.length).toBe(PROTOCOL_DOCS.length);
		expect(parsed.versionPath).toContain('VERSION');
	});
});
