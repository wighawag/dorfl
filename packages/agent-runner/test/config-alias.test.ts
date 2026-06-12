import {describe, it, expect} from 'vitest';
import {
	CONFIG_KEY_ALIASES,
	aliasDeprecationMessage,
	applyConfigKeyAliases,
} from '../src/config-alias.js';

describe('config-alias — the deprecated config-key aliases', () => {
	it('declares the `allowAgents` -> `autoBuild` alias (the build-gate rename)', () => {
		expect(CONFIG_KEY_ALIASES).toContainEqual({
			oldKey: 'allowAgents',
			newKey: 'autoBuild',
		});
	});

	it('builds a deprecation message naming the old key, new key, and source', () => {
		const msg = aliasDeprecationMessage(
			{oldKey: 'allowAgents', newKey: 'autoBuild'},
			'.agent-runner.json',
		);
		expect(msg).toMatch(/allowAgents/);
		expect(msg).toMatch(/autoBuild/);
		expect(msg).toMatch(/\.agent-runner\.json/);
	});
});

describe('applyConfigKeyAliases', () => {
	it('rewrites an old key in place to its new name and warns once', () => {
		const warnings: string[] = [];
		const parsed: Record<string, unknown> = {allowAgents: true};
		applyConfigKeyAliases(parsed, {
			source: 'cfg',
			warn: (m) => warnings.push(m),
		});
		expect(parsed).toEqual({autoBuild: true});
		expect('allowAgents' in parsed).toBe(false);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/allowAgents/);
	});

	it('leaves a config with no deprecated key untouched and silent', () => {
		const warnings: string[] = [];
		const parsed: Record<string, unknown> = {autoBuild: false, maxParallel: 3};
		applyConfigKeyAliases(parsed, {
			source: 'cfg',
			warn: (m) => warnings.push(m),
		});
		expect(parsed).toEqual({autoBuild: false, maxParallel: 3});
		expect(warnings).toHaveLength(0);
	});

	it('lets the NEW key win when both are present (a half-migrated file)', () => {
		const parsed: Record<string, unknown> = {
			allowAgents: true,
			autoBuild: false,
		};
		applyConfigKeyAliases(parsed, {source: 'cfg'});
		expect(parsed).toEqual({autoBuild: false});
	});

	it('drops an old key whose value is undefined without setting the new one', () => {
		const parsed: Record<string, unknown> = {allowAgents: undefined};
		applyConfigKeyAliases(parsed, {source: 'cfg'});
		expect('allowAgents' in parsed).toBe(false);
		expect('autoBuild' in parsed).toBe(false);
	});

	it('works without a warn sink (warn is optional)', () => {
		const parsed: Record<string, unknown> = {allowAgents: true};
		expect(() => applyConfigKeyAliases(parsed, {source: 'cfg'})).not.toThrow();
		expect(parsed).toEqual({autoBuild: true});
	});
});
