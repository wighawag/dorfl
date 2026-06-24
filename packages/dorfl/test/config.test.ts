import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	DEFAULT_CONFIG,
	mergeConfig,
	loadConfig,
	resolvePromptGuidance,
} from '../src/config.js';

describe('mergeConfig', () => {
	it('returns defaults when given no overrides', () => {
		expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it('defaults noPR to false ("I want a PR")', () => {
		expect(DEFAULT_CONFIG.noPR).toBe(false);
		expect(mergeConfig({}).noPR).toBe(false);
		expect(mergeConfig({noPR: true}).noPR).toBe(true);
	});

	it('has NO `provider` key (the override axis is removed)', () => {
		expect('provider' in DEFAULT_CONFIG).toBe(false);
	});

	it('defaults promptGuidance.testFirst to false (a NUDGE, off by default)', () => {
		expect(DEFAULT_CONFIG.promptGuidance).toEqual({testFirst: false});
		expect(mergeConfig({}).promptGuidance).toEqual({testFirst: false});
		// The convenience resolver returns the documented defaults.
		expect(resolvePromptGuidance(mergeConfig({}))).toEqual({testFirst: false});
	});

	it('mergeConfig accepts a per-repo `promptGuidance.testFirst: true` override', () => {
		const merged = mergeConfig({promptGuidance: {testFirst: true}});
		expect(merged.promptGuidance).toEqual({testFirst: true});
		expect(resolvePromptGuidance(merged).testFirst).toBe(true);
	});

	it('promptGuidance is CATEGORICALLY SEPARATE from the gate family (not a verify/autoBuild sibling)', () => {
		// Sanity: the namespace is its own object — NOT a boolean on the Config root
		// like `autoBuild`. The name signals "nudge, not gate".
		expect(typeof DEFAULT_CONFIG.promptGuidance).toBe('object');
		expect('testFirst' in DEFAULT_CONFIG).toBe(false);
	});

	it('defaults autoBuild to false (strict)', () => {
		expect(DEFAULT_CONFIG.autoBuild).toBe(false);
		expect(mergeConfig({}).autoBuild).toBe(false);
	});

	it('defaults autoTask to false (human-first tasking)', () => {
		expect(DEFAULT_CONFIG.autoTask).toBe(false);
		expect(mergeConfig({}).autoTask).toBe(false);
	});

	it('defaults surfaceBlockers to false (declared blocked work stays calm)', () => {
		expect(DEFAULT_CONFIG.surfaceBlockers).toBe(false);
		expect(mergeConfig({}).surfaceBlockers).toBe(false);
	});

	it('defaults selectionOrder to the `drain` preset (tasks-first; subsumes prdsFirst)', () => {
		expect(DEFAULT_CONFIG.selectionOrder).toBe('drain');
		expect(mergeConfig({}).selectionOrder).toBe('drain');
		// A preset string OR an explicit list overrides it.
		expect(mergeConfig({selectionOrder: 'groom'}).selectionOrder).toBe('groom');
		expect(
			mergeConfig({selectionOrder: ['task', 'build']}).selectionOrder,
		).toEqual(['task', 'build']);
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

	it('defaults workspacesDir under ~/.dorfl (STATE, never ~/.cache)', () => {
		const cfg = mergeConfig({});
		expect(cfg.workspacesDir.endsWith('/.dorfl')).toBe(true);
		expect(cfg.workspacesDir).not.toMatch(/\.cache/);
	});

	it('defaults arbitersDir under ~/git (precious DATA, NEVER ~/.dorfl — ADR §7)', () => {
		const cfg = mergeConfig({});
		expect(cfg.arbitersDir.endsWith('/git')).toBe(true);
		expect(cfg.arbitersDir).not.toMatch(/\.dorfl/);
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
		dir = mkdtempSync(join(tmpdir(), 'dorfl-cfg-'));
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

	it('parses a per-repo `promptGuidance.testFirst: true` from .json', () => {
		const path = join(dir, 'config.json');
		writeFileSync(
			path,
			JSON.stringify({promptGuidance: {testFirst: true}, autoBuild: false}),
		);
		const cfg = loadConfig(path);
		expect(cfg.promptGuidance.testFirst).toBe(true);
		// Other defaults still apply (it is its own namespace, not a gate sibling).
		expect(cfg.autoBuild).toBe(false);
	});

	it('tolerates an empty `promptGuidance` object (omitted members read defaults)', () => {
		const path = join(dir, 'config.json');
		writeFileSync(path, JSON.stringify({promptGuidance: {}}));
		const cfg = loadConfig(path);
		// An empty namespace REPLACES the default object; the resolver applies
		// per-member defaults so callers still get a coherent boolean.
		expect(resolvePromptGuidance(cfg).testFirst).toBe(false);
	});

	it('a stale `provider` key is IGNORED with a deprecation warning (never a hard error)', () => {
		const path = join(dir, 'config.json');
		writeFileSync(path, JSON.stringify({provider: 'github', maxParallel: 3}));
		const warnings: string[] = [];
		const origErr = console.error;
		console.error = (m?: unknown) => warnings.push(String(m ?? ''));
		let cfg;
		try {
			cfg = loadConfig(path); // must NOT throw
		} finally {
			console.error = origErr;
		}
		// The rest of the config still loads (the stale key is dropped, not fatal).
		expect(cfg.maxParallel).toBe(3);
		expect('provider' in cfg).toBe(false);
		expect(warnings.some((w) => /deprecated key 'provider'/.test(w))).toBe(
			true,
		);
		expect(warnings.some((w) => /arbiter-derived/.test(w))).toBe(true);
	});

	it('a stale `provider: none` deprecation warning points at the `noPR` replacement', () => {
		const path = join(dir, 'config.json');
		writeFileSync(path, JSON.stringify({provider: 'none'}));
		const warnings: string[] = [];
		const origErr = console.error;
		console.error = (m?: unknown) => warnings.push(String(m ?? ''));
		try {
			loadConfig(path);
		} finally {
			console.error = origErr;
		}
		expect(warnings.some((w) => /noPR/.test(w))).toBe(true);
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
