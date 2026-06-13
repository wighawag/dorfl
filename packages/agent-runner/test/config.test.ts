import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, mergeConfig, loadConfig} from '../src/config.js';

describe('mergeConfig', () => {
	it('returns defaults when given no overrides', () => {
		expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it('defaults autoBuild to false (strict)', () => {
		expect(DEFAULT_CONFIG.autoBuild).toBe(false);
		expect(mergeConfig({}).autoBuild).toBe(false);
	});

	it('defaults autoSlice to false (human-first slicing)', () => {
		expect(DEFAULT_CONFIG.autoSlice).toBe(false);
		expect(mergeConfig({}).autoSlice).toBe(false);
	});

	it('defaults prdsFirst to false (slices-first priority, ADR §3)', () => {
		expect(DEFAULT_CONFIG.prdsFirst).toBe(false);
		expect(mergeConfig({}).prdsFirst).toBe(false);
		expect(mergeConfig({prdsFirst: true}).prdsFirst).toBe(true);
	});

	it('defaults the autonomy gate to strict (autoBuild false)', () => {
		expect(mergeConfig({}).autoBuild).toBe(false);
	});

	it('defaults the execution fields (maxParallel, perRepoMax, arbiter, integration)', () => {
		const cfg = mergeConfig({});
		expect(cfg.maxParallel).toBe(4);
		expect(cfg.perRepoMax).toBe(2);
		expect(cfg.defaultArbiter).toBe('origin');
		expect(cfg.integration).toBe('propose');
		expect(cfg.agentCmd).toBe('');
	});

	it('defaults workspacesDir under ~/.agent-runner (STATE, never ~/.cache)', () => {
		const cfg = mergeConfig({});
		expect(cfg.workspacesDir.endsWith('/.agent-runner')).toBe(true);
		expect(cfg.workspacesDir).not.toMatch(/\.cache/);
	});

	it('defaults arbitersDir under ~/git (precious DATA, NEVER ~/.agent-runner — ADR §7)', () => {
		const cfg = mergeConfig({});
		expect(cfg.arbitersDir.endsWith('/git')).toBe(true);
		expect(cfg.arbitersDir).not.toMatch(/\.agent-runner/);
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
		const merged = mergeConfig({autoBuild: true});
		expect(merged.autoBuild).toBe(true);
		expect(merged.maxParallel).toBe(DEFAULT_CONFIG.maxParallel);
	});

	it('replaces list fields rather than concatenating them', () => {
		const merged = mergeConfig({
			verify: ['a', 'b'],
		});
		expect(merged.verify).toEqual(['a', 'b']);
	});

	it('ignores undefined override values', () => {
		const merged = mergeConfig({
			maxParallel: undefined,
			autoBuild: true,
		});
		expect(merged.maxParallel).toEqual(DEFAULT_CONFIG.maxParallel);
		expect(merged.autoBuild).toBe(true);
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
		writeFileSync(path, JSON.stringify({maxParallel: 7, autoBuild: true}));
		const cfg = loadConfig(path);
		expect(cfg.maxParallel).toEqual(7);
		expect(cfg.autoBuild).toBe(true);
		expect(cfg.perRepoMax).toEqual(DEFAULT_CONFIG.perRepoMax);
	});

	it('throws a helpful error on invalid JSON', () => {
		const path = join(dir, 'broken.json');
		writeFileSync(path, '{ not json');
		expect(() => loadConfig(path)).toThrow(/config/i);
	});

	it('no longer treats `allowAgents` as an alias: it is inert and `autoBuild` is untouched (no crash)', () => {
		const path = join(dir, 'config.json');
		writeFileSync(path, JSON.stringify({allowAgents: true, autoBuild: false}));
		// `allowAgents` is no longer a recognised alias: loading does not throw and
		// never maps onto `autoBuild`, which stands on its own value.
		const cfg = loadConfig(path);
		expect(cfg.autoBuild).toBe(false);
	});

	it('loads a valid identity block', () => {
		const path = join(dir, 'config.json');
		writeFileSync(
			path,
			JSON.stringify({
				identity: {
					name: 'Bot',
					email: 'bot@agents.alt',
					auth: {ssh: '/k', https: 'never'},
					providers: {github: {tokenEnv: 'BOT_TOK'}},
				},
			}),
		);
		const cfg = loadConfig(path);
		expect(cfg.identity?.name).toBe('Bot');
		expect(cfg.identity?.auth.ssh).toBe('/k');
	});

	it('throws a helpful error for an identity missing auth (load-time validation)', () => {
		const path = join(dir, 'config.json');
		writeFileSync(path, JSON.stringify({identity: {name: 'Bot'}}));
		expect(() => loadConfig(path)).toThrow(/identity/i);
	});

	it('throws for an identity github with both token and tokenEnv', () => {
		const path = join(dir, 'config.json');
		writeFileSync(
			path,
			JSON.stringify({
				identity: {
					auth: {ssh: 'ambient', https: 'ambient'},
					providers: {github: {token: 'x', tokenEnv: 'Y'}},
				},
			}),
		);
		expect(() => loadConfig(path)).toThrow(/identity/i);
	});
});
