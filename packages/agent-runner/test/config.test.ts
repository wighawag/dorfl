import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig, loadConfig} from '../src/config.js';

describe('mergeConfig', () => {
	it('returns defaults when given no overrides', () => {
		expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it('defaults allowAgents to false (strict)', () => {
		expect(DEFAULT_CONFIG.allowAgents).toBe(false);
		expect(mergeConfig({}).allowAgents).toBe(false);
	});

	it('defaults include and exclude to empty arrays', () => {
		expect(mergeConfig({}).include).toEqual([]);
		expect(mergeConfig({}).exclude).toEqual([]);
	});

	it('defaults the execution fields (maxParallel, perRepoMax, arbiter, integration)', () => {
		const cfg = mergeConfig({});
		expect(cfg.maxParallel).toBe(4);
		expect(cfg.perRepoMax).toBe(2);
		expect(cfg.defaultArbiter).toBe('origin');
		expect(cfg.integration).toBe('propose');
		expect(cfg.agentCmd).toBe('');
	});

	it('overrides execution fields', () => {
		const cfg = mergeConfig({
			maxParallel: 8,
			perRepoMax: 3,
			defaultArbiter: 'arbiter',
			integration: 'merge',
			agentCmd: 'my-agent',
		});
		expect(cfg.maxParallel).toBe(8);
		expect(cfg.perRepoMax).toBe(3);
		expect(cfg.defaultArbiter).toBe('arbiter');
		expect(cfg.integration).toBe('merge');
		expect(cfg.agentCmd).toBe('my-agent');
	});

	it('leaves verify unset by default (distinguishable from empty)', () => {
		expect(mergeConfig({}).verify).toBeUndefined();
		expect('verify' in DEFAULT_CONFIG).toBe(false);
	});

	it('carries over an optional verify key (string or list)', () => {
		expect(mergeConfig({verify: 'make check'}).verify).toBe('make check');
		expect(mergeConfig({verify: ['a', 'b']}).verify).toEqual(['a', 'b']);
	});

	it('overrides individual fields while keeping the rest as defaults', () => {
		const merged = mergeConfig({allowAgents: true});
		expect(merged.allowAgents).toBe(true);
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
			allowAgents: true,
		});
		expect(merged.roots).toEqual(DEFAULT_CONFIG.roots);
		expect(merged.allowAgents).toBe(true);
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
		writeFileSync(path, JSON.stringify({roots: ['/x'], allowAgents: true}));
		const cfg = loadConfig(path);
		expect(cfg.roots).toEqual(['/x']);
		expect(cfg.allowAgents).toBe(true);
		expect(cfg.include).toEqual([]);
	});

	it('throws a helpful error on invalid JSON', () => {
		const path = join(dir, 'broken.json');
		writeFileSync(path, '{ not json');
		expect(() => loadConfig(path)).toThrow(/config/i);
	});
});
