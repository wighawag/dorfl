import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	readFileSync,
	chmodSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig} from '../src/config.js';
import {
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	REPO_CONFIG_FILENAME,
	resolveRepoConfig,
} from '../src/repo-config.js';
import {
	NullHarness,
	substituteModel,
	MODEL_PLACEHOLDER,
} from '../src/harness.js';
import {PiHarness} from '../src/pi-harness.js';
import {makeScratch, type Scratch, rmrf} from './helpers/gitRepo.js';

/**
 * The model-config task (ADR §13): `model` is a first-class, harness-agnostic
 * routing intent carried through the harness seam. dorfl decides WHICH
 * model; it NEVER touches auth/keys (those stay the harness's job). These tests
 * cover (1) the optional `model` config field, (2) its per-repo resolution chain
 * (flag > env > per-repo > global > default), (3) each adapter's injection (pi:
 * native `--model`; null/shell: `{model}` placeholder), and (4) the three shell
 * degradation cases.
 */

describe('config.model — optional, no default (unset is meaningful)', () => {
	it('is undefined by default (dorfl forces no model)', () => {
		expect(DEFAULT_CONFIG.model).toBeUndefined();
		expect(mergeConfig({}).model).toBeUndefined();
	});

	it('is carried through mergeConfig when set', () => {
		expect(mergeConfig({model: 'anthropic/claude-sonnet-4'}).model).toBe(
			'anthropic/claude-sonnet-4',
		);
	});
});

describe('repo-config — model + harness allowed per-repo, piBin rejected', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-model-'));
	});
	afterEach(() => {
		rmrf(repo);
	});

	function writeRepoConfig(value: unknown): void {
		writeFileSync(join(repo, REPO_CONFIG_FILENAME), JSON.stringify(value));
	}

	it('treats model + harness as repo-appropriate keys', () => {
		expect(REPO_ALLOWED_KEYS).toContain('model');
		expect(REPO_ALLOWED_KEYS).toContain('harness');
	});

	it('keeps piBin host-only (rejected per-repo)', () => {
		expect(REPO_REJECTED_KEYS).toContain('piBin');
		expect(REPO_REJECTED_KEYS).toContain('agentCmd');
		expect(REPO_ALLOWED_KEYS).not.toContain('piBin');
		expect(REPO_ALLOWED_KEYS).not.toContain('agentCmd');
	});

	it('honours model + harness from a per-repo file; rejects piBin (reported)', () => {
		writeRepoConfig({
			model: 'repo/model',
			harness: 'pi',
			piBin: '/leaked/pi',
		});
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
		});
		expect(resolved.config.model).toBe('repo/model');
		expect(resolved.config.harness).toBe('pi');
		// piBin from the committed repo file is ignored + reported.
		expect(resolved.config.piBin).toBeUndefined();
		expect(resolved.rejected).toContain('piBin');
		expect(resolved.message).toMatch(/piBin/);
	});

	it('resolves model: flag > env > per-repo > global > default (unset)', () => {
		// default: unset
		expect(
			resolveRepoConfig({repoPath: repo, global: mergeConfig({})}).config.model,
		).toBeUndefined();

		// global only
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({model: 'global/m'}),
			}).config.model,
		).toBe('global/m');

		// per-repo beats global
		writeRepoConfig({model: 'repo/m'});
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({model: 'global/m'}),
			}).config.model,
		).toBe('repo/m');

		// env beats per-repo + global
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({model: 'global/m'}),
				env: {DORFL_MODEL: 'env/m'},
			}).config.model,
		).toBe('env/m');

		// flag beats everything
		expect(
			resolveRepoConfig({
				repoPath: repo,
				global: mergeConfig({model: 'global/m'}),
				env: {DORFL_MODEL: 'env/m'},
				flags: {model: 'flag/m'},
			}).config.model,
		).toBe('flag/m');
	});
});

describe('substituteModel — three shell degradation rules (ADR §13)', () => {
	it('rule 1: {model} present + model set ⇒ substitute (every occurrence)', () => {
		expect(substituteModel('agent --model {model}', 'my/model')).toBe(
			'agent --model my/model',
		);
		expect(substituteModel('a {model} b {model}', 'X')).toBe('a X b X');
	});

	it('rule 2: {model} present + model unset ⇒ clear error (never a literal {model})', () => {
		expect(() => substituteModel('agent --model {model}', undefined)).toThrow(
			/\{model\}/,
		);
		expect(() => substituteModel('agent --model {model}', '')).toThrow(
			/no model is configured/,
		);
	});

	it('rule 3: {model} absent ⇒ run command as-is (model routing offered, not forced)', () => {
		expect(substituteModel('agent --do-thing', 'my/model')).toBe(
			'agent --do-thing',
		);
		expect(substituteModel('agent --do-thing', undefined)).toBe(
			'agent --do-thing',
		);
	});

	it('exposes the {model} placeholder constant', () => {
		expect(MODEL_PLACEHOLDER).toBe('{model}');
	});
});

describe('NullHarness — model injection via {model} placeholder', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-nullmodel-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	it('substitutes {model} in the command and records the substituted command', () => {
		const harness = new NullHarness();
		const out = join(scratch.root, 'model.txt');
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: `printf '%s' '{model}' > ${JSON.stringify(out)}`,
			model: 'my/model',
		});
		expect(result.ok).toBe(true);
		expect(readFileSync(out, 'utf8')).toBe('my/model');
		// The recorded command carries the substituted value, not the placeholder.
		expect(result.record.command).toContain('my/model');
		expect(result.record.command).not.toContain(MODEL_PLACEHOLDER);
	});

	it('errors clearly when {model} is present but no model is configured', () => {
		const harness = new NullHarness();
		expect(() =>
			harness.launch({
				dir: scratch.root,
				slug: 'feat',
				command: 'agent --model {model}',
			}),
		).toThrow(/\{model\}/);
	});

	it('runs the command as-is when {model} is absent (model set or not)', () => {
		const harness = new NullHarness();
		const r1 = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'true',
			model: 'my/model',
		});
		expect(r1.ok).toBe(true);
		expect(r1.record.command).toBe('true');
		const r2 = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'true',
		});
		expect(r2.ok).toBe(true);
	});
});

describe('PiHarness — native --model injection (stubbed pi CLI)', () => {
	let scratch: Scratch;
	beforeEach(() => {
		scratch = makeScratch('dorfl-pimodel-');
	});
	afterEach(() => {
		scratch.cleanup();
	});

	/** A pi stub that records the args it was invoked with. */
	function writePiStub(): {bin: string; argsFile: string} {
		const bin = join(scratch.root, 'pi-stub.sh');
		const argsFile = join(scratch.root, 'pi-args.txt');
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
			'exit 0',
		].join('\n');
		writeFileSync(bin, script + '\n');
		chmodSync(bin, 0o755);
		return {bin, argsFile};
	}

	it('passes --model <model> natively when model is set', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'wt');
		mkdirSync(dir, {recursive: true});
		harness.launch({
			dir,
			slug: 'feat',
			command: 'ignored',
			model: 'a/b',
			prompt: 'p',
		});
		const args = readFileSync(stub.argsFile, 'utf8').split('\n');
		expect(args).toContain('--model');
		expect(args).toContain('a/b');
		// --model appears BEFORE --print (the native model flag layers in first).
		expect(args.indexOf('--model')).toBeLessThan(args.indexOf('--print'));
	});

	it('passes NO --model when model is unset', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'wt');
		mkdirSync(dir, {recursive: true});
		harness.launch({dir, slug: 'feat', command: 'ignored', prompt: 'p'});
		const args = readFileSync(stub.argsFile, 'utf8').split('\n');
		expect(args).not.toContain('--model');
	});

	it('still honours operator extraArgs alongside the native --model', () => {
		const stub = writePiStub();
		const harness = new PiHarness({
			piBin: stub.bin,
			extraArgs: ['--flag', 'value'],
		});
		const dir = join(scratch.root, 'wt');
		mkdirSync(dir, {recursive: true});
		harness.launch({
			dir,
			slug: 'feat',
			command: 'ignored',
			model: 'a/b',
			prompt: 'p',
		});
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toContain('--model');
		expect(args).toContain('a/b');
		expect(args).toContain('--flag');
		expect(args).toContain('value');
	});
});
