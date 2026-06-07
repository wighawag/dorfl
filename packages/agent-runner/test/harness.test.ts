import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, readFileSync} from 'node:fs';
import {NullHarness} from '../src/harness.js';
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
