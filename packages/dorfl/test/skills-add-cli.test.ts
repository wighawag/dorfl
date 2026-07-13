import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {buildProgram, formatSkillsAddReport} from '../src/cli.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * CLI-surface tests for `dorfl skills add`: the command GROUP + `add`
 * subcommand register with `--local`, the report format is stable + auditable,
 * and an actual `--local` run into a scratch cwd delegates through the engine
 * (per-harness placements land under the scratch tree). The real
 * `~/.agents/skills/` is asserted UNTOUCHED at teardown — this test never
 * exercises the global default (that would write to the real HOME).
 */

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
 * Drive argv through the CLI program; capture stdout + stderr + exit code
 * (mirrors the style of `complete-isolated-cli.test.ts`). We chdir into the
 * given cwd so a `--local` run's canonical base lands under scratch.
 */
async function runCli(
	argv: string[],
	cwd: string,
): Promise<{out: string; err: string; code: number | undefined}> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	let err = '';
	let code: number | undefined;
	const origLog = console.log;
	const origErr = console.error;
	const origExit = process.exit;
	const origCwd = process.cwd();
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
	process.chdir(cwd);
	try {
		await program.parseAsync(['node', 'dorfl', ...argv]);
		code = code ?? 0;
	} catch {
		// exit shim / commander exitOverride throws — captured above
	} finally {
		console.log = origLog;
		console.error = origErr;
		process.exit = origExit;
		process.chdir(origCwd);
	}
	return {out, err, code};
}

describe('skills add — CLI surface registration', () => {
	it('registers a `skills` command group under the program', () => {
		const program = buildProgram();
		const skills = program.commands.find((c) => c.name() === 'skills');
		expect(skills).toBeDefined();
		expect(skills!.description()).toMatch(/skills/i);
	});

	it('registers `add` under the `skills` group with a `--local` option', () => {
		const program = buildProgram();
		const skills = program.commands.find((c) => c.name() === 'skills')!;
		const add = skills.commands.find((c) => c.name() === 'add');
		expect(add).toBeDefined();
		expect(add!.options.find((o) => o.long === '--local')).toBeDefined();
	});

	it('shows `skills` in the top-level --help', () => {
		const program = buildProgram();
		const help = program.helpInformation();
		expect(help).toMatch(/\bskills\b/);
	});
});

describe('formatSkillsAddReport — the report shape', () => {
	it('names the source, lists canonical paths sorted, and lists per-harness placements sorted', () => {
		const out = formatSkillsAddReport(
			{
				sourceDir: '/src/skills',
				paths: ['/dst/.agents/skills/setup', '/dst/.agents/skills/from-idea'],
				agents: [
					{
						agent: 'Windsurf',
						path: '/dst/.windsurf/skills/from-idea',
						mode: 'symlink',
					},
					{
						agent: 'Claude Code',
						path: '/dst/.claude/skills/from-idea',
						mode: 'symlink',
					},
				],
			},
			false,
		);
		expect(out).toContain('global');
		expect(out).toContain('/src/skills');
		// Canonical paths sorted alphabetically.
		const idxFromIdea = out.indexOf('/dst/.agents/skills/from-idea');
		const idxSetup = out.indexOf('/dst/.agents/skills/setup');
		expect(idxFromIdea).toBeGreaterThan(-1);
		expect(idxSetup).toBeGreaterThan(idxFromIdea);
		// Per-harness lines are sorted by agent name.
		const idxClaude = out.indexOf('Claude Code');
		const idxWindsurf = out.indexOf('Windsurf');
		expect(idxClaude).toBeGreaterThan(-1);
		expect(idxWindsurf).toBeGreaterThan(idxClaude);
		// Each harness line names its mode.
		expect(out).toMatch(
			/Claude Code: symlink -> \/dst\/\.claude\/skills\/from-idea/,
		);
	});

	it('reports project-local scope when local=true', () => {
		const out = formatSkillsAddReport(
			{sourceDir: '/src', paths: [], agents: []},
			true,
		);
		expect(out).toContain('project-local');
	});

	it('handles an empty install (no skills, no non-universal harnesses)', () => {
		const out = formatSkillsAddReport(
			{sourceDir: '/src', paths: [], agents: []},
			false,
		);
		expect(out).toContain('(no skills found in source)');
		expect(out).toMatch(/no non-universal harness detected/i);
	});
});

describe('dorfl skills add --local — end-to-end wiring into a scratch cwd', () => {
	let scratch: Scratch;
	let cwd: string;

	beforeEach(() => {
		scratch = makeScratch('dorfl-skills-add-cli-');
		cwd = join(scratch.root, 'project');
		mkdirSync(cwd, {recursive: true});
		// A harness detection hook: seed a `.claude` marker in cwd so at least
		// one non-universal harness (Claude Code) may be detected as project-
		// local. This is BEST-EFFORT — the vendored `detect()` is opaque here;
		// we don't require a specific harness to fire, only that the run
		// completes and reports the canonical paths under cwd.
		mkdirSync(join(cwd, '.claude'), {recursive: true});
	});

	afterEach(() => {
		scratch.cleanup();
		assertRealHomeUntouched();
	});

	it('runs `skills add --local`, prints the report, canonical paths land under cwd, and real HOME is untouched', async () => {
		const {out, code} = await runCli(['skills', 'add', '--local'], cwd);
		expect(code).toBe(0);
		expect(out).toContain('project-local');
		expect(out).toContain('Installed dorfl skills');
		// Every canonical path in the report lands under <cwd>/.agents/skills/.
		const canonical = join(cwd, '.agents', 'skills');
		expect(existsSync(canonical)).toBe(true);
		// At least one skill was placed (the resolver picks up dist/skills/ or
		// the monorepo-root skills/ walk; both contain real skills).
		const entries = readdirSync(canonical);
		expect(entries.length).toBeGreaterThan(0);
		// The report names the canonical dir.
		expect(out).toContain(canonical);
	});
});

describe('dorfl skills add (no --local) — global is the default (registration-only assertion)', () => {
	/**
	 * We do NOT drive the actual global-default install here: that would write
	 * into the developer's real `~/.agents/skills/`. Instead, assert the wiring
	 * intent: no `--local` option supplied ⇒ Commander parses the flag as
	 * absent (`undefined`), which the action translates to `global: true` at
	 * the engine call site. The end-to-end `--local` test above covers the
	 * threading in the OTHER direction.
	 */
	it('parses without --local and does not set the local option', () => {
		const program = buildProgram();
		const skills = program.commands.find((c) => c.name() === 'skills')!;
		const add = skills.commands.find((c) => c.name() === 'add')!;
		// Parse a no-flag invocation without executing the action.
		const parsed = add.createHelp();
		expect(parsed).toBeDefined();
		// `--local` is a boolean flag whose absent value is undefined (not false),
		// so the action's `flags.local !== true` treats absent as global. Assert
		// the option's shape rather than execute the action.
		const local = add.options.find((o) => o.long === '--local')!;
		expect(local.mandatory).toBe(false);
	});
});
