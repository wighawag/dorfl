import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig, loadConfig} from '../src/config.js';

describe('mergeConfig', () => {
	it('returns defaults when given no overrides', () => {
		expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it('defaults allowUnspecifiedGate to false (strict)', () => {
		expect(DEFAULT_CONFIG.allowUnspecifiedGate).toBe(false);
		expect(mergeConfig({}).allowUnspecifiedGate).toBe(false);
	});

	it('defaults include and exclude to empty arrays', () => {
		expect(mergeConfig({}).include).toEqual([]);
		expect(mergeConfig({}).exclude).toEqual([]);
	});

	it('overrides individual fields while keeping the rest as defaults', () => {
		const merged = mergeConfig({allowUnspecifiedGate: true});
		expect(merged.allowUnspecifiedGate).toBe(true);
		expect(merged.include).toEqual([]);
	});

	it('replaces array fields rather than concatenating them', () => {
		const merged = mergeConfig({
			roots: ['/a', '/b'],
			exclude: ['skip-me'],
		});
		expect(merged.roots).toEqual(['/a', '/b']);
		expect(merged.exclude).toEqual(['skip-me']);
	});

	it('ignores undefined override values', () => {
		const merged = mergeConfig({
			roots: undefined,
			allowUnspecifiedGate: true,
		});
		expect(merged.roots).toEqual(DEFAULT_CONFIG.roots);
		expect(merged.allowUnspecifiedGate).toBe(true);
	});
});

describe('loadConfig', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-runner-cfg-'));
	});

	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it('returns merged defaults when the config path does not exist', () => {
		const cfg = loadConfig(join(dir, 'nope.json'));
		expect(cfg).toEqual(DEFAULT_CONFIG);
	});

	it('loads and merges a config file over the defaults', () => {
		const path = join(dir, 'config.json');
		writeFileSync(
			path,
			JSON.stringify({roots: ['/x'], allowUnspecifiedGate: true}),
		);
		const cfg = loadConfig(path);
		expect(cfg.roots).toEqual(['/x']);
		expect(cfg.allowUnspecifiedGate).toBe(true);
		expect(cfg.include).toEqual([]);
	});

	it('throws a helpful error on invalid JSON', () => {
		const path = join(dir, 'broken.json');
		writeFileSync(path, '{ not json');
		expect(() => loadConfig(path)).toThrow(/config/i);
	});
});
