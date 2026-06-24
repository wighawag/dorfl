import {describe, it, expect} from 'vitest';
import {
	BASE,
	brand,
	deriveBrand,
	paramCase,
	constantCase,
} from '../src/brand.js';

describe('brand — case transforms (change-name vocabulary)', () => {
	it('paramCase joins lowercase words with dashes', () => {
		// Every input case collapses to the same paramCase form.
		expect(paramCase('robo-forge')).toBe('robo-forge');
		expect(paramCase('roboForge')).toBe('robo-forge');
		expect(paramCase('RoboForge')).toBe('robo-forge');
		expect(paramCase('robo_forge')).toBe('robo-forge');
		expect(paramCase('robo forge')).toBe('robo-forge');
		// A single-word base stays one word.
		expect(paramCase('dorfl')).toBe('dorfl');
		expect(paramCase('forge')).toBe('forge');
	});

	it('constantCase uppercases words joined with underscores', () => {
		expect(constantCase('robo-forge')).toBe('ROBO_FORGE');
		expect(constantCase('roboForge')).toBe('ROBO_FORGE');
		expect(constantCase('dorfl')).toBe('DORFL');
		expect(constantCase('forge')).toBe('FORGE');
	});
});

describe('brand — derived surface equals today’s literals (byte-identical)', () => {
	it('the live base is the current name', () => {
		expect(BASE).toBe('dorfl');
	});

	it('every derived form matches the current hardcoded literal', () => {
		// These are the EXACT strings the codebase used before centralisation; the
		// refactor is a pure no-op iff these hold.
		expect(brand.base).toBe('dorfl');
		expect(brand.envPrefix).toBe('DORFL_');
		expect(brand.repoConfigFilename).toBe('.dorfl.json');
		expect(brand.workdirName).toBe('.dorfl');
		expect(brand.jobRecordFilename).toBe('.dorfl-job.json');
		expect(brand.configDirName).toBe('dorfl');
		expect(brand.bin).toBe('dorfl');
	});
});

describe('brand — changing ONLY the base flips every surface in lockstep', () => {
	it('a rebrand to a multi-word base derives all forms consistently', () => {
		const renamed = deriveBrand('robo-forge');
		expect(renamed.base).toBe('robo-forge');
		expect(renamed.envPrefix).toBe('ROBO_FORGE_');
		expect(renamed.repoConfigFilename).toBe('.robo-forge.json');
		expect(renamed.workdirName).toBe('.robo-forge');
		expect(renamed.jobRecordFilename).toBe('.robo-forge-job.json');
		expect(renamed.configDirName).toBe('robo-forge');
		expect(renamed.bin).toBe('robo-forge');
	});

	it('a single-word rebrand derives all forms consistently', () => {
		const renamed = deriveBrand('forge');
		expect(renamed.envPrefix).toBe('FORGE_');
		expect(renamed.repoConfigFilename).toBe('.forge.json');
		expect(renamed.workdirName).toBe('.forge');
		expect(renamed.jobRecordFilename).toBe('.forge-job.json');
		expect(renamed.configDirName).toBe('forge');
		expect(renamed.bin).toBe('forge');
	});

	it('NO derived field retains the old base after a rebrand (no orphan literal)', () => {
		const renamed = deriveBrand('robo-forge');
		for (const value of Object.values(renamed)) {
			expect(value).not.toMatch(/dorfl|DORFL/);
		}
	});

	it('accepts a camelCase base and still derives canonical forms', () => {
		const renamed = deriveBrand('roboForge');
		expect(renamed.base).toBe('roboForge');
		expect(renamed.envPrefix).toBe('ROBO_FORGE_');
		expect(renamed.repoConfigFilename).toBe('.robo-forge.json');
		expect(renamed.workdirName).toBe('.robo-forge');
		expect(renamed.bin).toBe('robo-forge');
	});
});
