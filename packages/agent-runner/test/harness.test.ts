import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, readFileSync} from 'node:fs';
import {NullHarness, isBenignPromptWriteError} from '../src/harness.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-harness-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('NullHarness — launch', () => {
	it('runs the configured command in the job dir and records the PID', () => {
		const harness = new NullHarness();
		const out = join(scratch.root, 'out.txt');
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: `printf done > ${JSON.stringify(out)}`,
		});
		expect(result.ok).toBe(true);
		expect(typeof result.record.pid).toBe('number');
		expect(result.record.adapter).toBe('null');
		// The command actually ran in the job dir.
		expect(existsSync(out)).toBe(true);
		expect(readFileSync(out, 'utf8')).toBe('done');
	});

	it('reports a non-zero command as not ok, with detail', () => {
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'exit 7',
		});
		expect(result.ok).toBe(false);
		expect(result.detail).toBeDefined();
	});

	it('records the command in the harness block', () => {
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'true',
		});
		expect(result.record.command).toBe('true');
	});

	it('populates output from the captured command stdout (trimmed)', () => {
		// For the null/shell adapter the command's stdout IS its answer (slice
		// `harness-agent-output`). A synchronous spawn captures it; we return it
		// trimmed as `output`.
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: `printf '  the answer  \\n'`,
		});
		expect(result.ok).toBe(true);
		expect(result.output).toBe('the answer');
	});

	it('output is undefined when the command writes no stdout', () => {
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'true',
		});
		expect(result.output).toBeUndefined();
	});
});

describe('NullHarness — empty-command BACKSTOP (the seam refuses, not just the CLI)', () => {
	// A fresh repo with no config + no --harness resolves the null adapter with an
	// empty agentCmd; without this guard `launch` would `bash -c ''` ⇒ exit 0, no
	// output ⇒ a "successful" build that ran NOTHING. The CLI sites already refuse
	// up-front, but this seam can be reached by OTHER callers, so it must refuse too.
	it("throws (config-error voice) on an empty command instead of spawning bash -c ''", () => {
		const harness = new NullHarness();
		expect(() =>
			harness.launch({dir: scratch.root, slug: 'feat', command: ''}),
		).toThrow(/agentCmd/);
	});

	it('throws on an all-whitespace command too', () => {
		const harness = new NullHarness();
		expect(() =>
			harness.launch({dir: scratch.root, slug: 'feat', command: '   \t\n '}),
		).toThrow(/agentCmd/);
	});

	it('a configured null harness WITH a real agentCmd still launches normally', () => {
		// The footgun is null-AND-empty only; a real command is untouched.
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: `printf '%s' ok`,
		});
		expect(result.ok).toBe(true);
		expect(result.output).toBe('ok');
	});
});

describe('NullHarness — EPIPE on the prompt write is benign (flake fix)', () => {
	// The null/shell adapter feeds the prompt on stdin. When the prompt is empty
	// (the autonomous review/arbiter launches), a child that closes stdin before
	// the parent's zero-byte write surfaces as `EPIPE` under concurrent load. That
	// write failing is harmless — there was nothing to deliver and stdout/status
	// are still captured — so `launch` must NOT throw, while every OTHER spawn
	// error still throws.
	it('classifies EPIPE as benign and any other spawn error as fatal', () => {
		const epipe = Object.assign(new Error('spawnSync bash EPIPE'), {
			code: 'EPIPE',
		});
		const enoent = Object.assign(new Error('spawnSync bash ENOENT'), {
			code: 'ENOENT',
		});
		expect(isBenignPromptWriteError(epipe)).toBe(true);
		expect(isBenignPromptWriteError(enoent)).toBe(false);
		// No `code` at all (a plain Error) is NOT benign — only EPIPE is.
		expect(isBenignPromptWriteError(new Error('boom'))).toBe(false);
	});

	it('does NOT throw when the prompt write hits a real EPIPE; still captures output', () => {
		// Deterministically reproduce the race: a child that closes its stdin and
		// exits 0 while the parent writes a large prompt forces a real `EPIPE` on the
		// write (verified: spawnSync still reports status 0 + captured stdout).
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'printf the-answer; exec 0<&-',
			prompt: 'x'.repeat(8 * 1024 * 1024),
		});
		// The EPIPE was swallowed: we got a normal result, not a thrown error.
		expect(result.ok).toBe(true);
		expect(result.output).toBe('the-answer');
	});

	it('a real NON-EPIPE spawn error still throws end-to-end', () => {
		// Exercise the fatal-error branch through `launch` itself with a REAL spawn:
		// a command whose stdout overflows the adapter's 64MB `maxBuffer` makes
		// spawnSync set `result.error` with code `ENOBUFS` (a non-EPIPE error) — which
		// must still throw, proving only EPIPE is tolerated, not every error.
		const harness = new NullHarness();
		expect(() =>
			harness.launch({
				dir: scratch.root,
				slug: 'feat',
				command: 'yes a | head -c 70000000',
			}),
		).toThrow(/failed to spawn harness command/);
	});
});

describe('NullHarness — liveness (from the harness, NOT mtime)', () => {
	it('a finished synchronous job is not alive (the harness knows, not mtime)', () => {
		const harness = new NullHarness();
		const result = harness.launch({
			dir: scratch.root,
			slug: 'feat',
			command: 'true',
		});
		// The null adapter runs synchronously to completion, so the process is gone.
		expect(harness.isAlive(result.record)).toBe(false);
	});

	it('liveness is computed from the PID, never from filesystem mtime', () => {
		const harness = new NullHarness();
		// A PID we know cannot be alive (process 0 is never a normal user process,
		// and the live one already exited). A live agent can think for minutes
		// without touching files, so mtime must NOT be the signal (ADR §5).
		const dead = harness.isAlive({adapter: 'null', pid: 2 ** 31 - 1});
		expect(dead).toBe(false);
		// Our own process IS alive — proves liveness comes from the PID table.
		const self = harness.isAlive({adapter: 'null', pid: process.pid});
		expect(self).toBe(true);
	});
});
