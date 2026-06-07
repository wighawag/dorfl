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
		expect(paramCase('agent-runner')).toBe('agent-runner');
		expect(paramCase('agentRunner')).toBe('agent-runner');
		expect(paramCase('AgentRunner')).toBe('agent-runner');
		expect(paramCase('agent_runner')).toBe('agent-runner');
		expect(paramCase('agent runner')).toBe('agent-runner');
		// A single-word base stays one word.
		expect(paramCase('forge')).toBe('forge');
	});

	it('constantCase uppercases words joined with underscores', () => {
		expect(constantCase('agent-runner')).toBe('AGENT_RUNNER');
		expect(constantCase('agentRunner')).toBe('AGENT_RUNNER');
		expect(constantCase('forge')).toBe('FORGE');
	});
});

describe('brand — derived surface equals today’s literals (byte-identical)', () => {
	it('the live base is the current name', () => {
		expect(BASE).toBe('agent-runner');
	});

	it('every derived form matches the current hardcoded literal', () => {
		// These are the EXACT strings the codebase used before centralisation; the
		// refactor is a pure no-op iff these hold.
		expect(brand.base).toBe('agent-runner');
		expect(brand.envPrefix).toBe('AGENT_RUNNER_');
		expect(brand.repoConfigFilename).toBe('.agent-runner.json');
		expect(brand.workdirName).toBe('.agent-runner');
		expect(brand.jobRecordFilename).toBe('.agent-runner-job.json');
		expect(brand.configDirName).toBe('agent-runner');
		expect(brand.bin).toBe('agent-runner');
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
			expect(value).not.toMatch(/agent-runner|AGENT_RUNNER/);
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
