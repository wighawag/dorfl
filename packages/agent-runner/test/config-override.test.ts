import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	existsSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {
	defaultConfigOverridePath,
	loadConfigOverride,
	type ConfigOverrideMap,
} from '../src/config-override.js';
import {defaultConfigPath, mergeConfig} from '../src/config.js';
import {
	REPO_CONFIG_FILENAME,
	resolveRepoConfig,
	resolveRepoConfigFromLoaded,
} from '../src/repo-config.js';
import {encodeRepoKey} from '../src/repo-key.js';

/**
 * The per-machine config override layer (ADR
 * `per-machine-config-override-layer`): a single file at
 * `<configDir>/config.override.json` (sibling of `config.json`) that overrides
 * the committed per-repo `.agent-runner.json` but is itself overridden by env
 * and flags. The reader takes an INJECTABLE path so tests never touch the real
 * `~/.config/agent-runner/`; the resolution layers ingest a map directly so
 * tests can also bypass disk entirely.
 */

describe('config-override paths', () => {
	it('defaults to `<configDir>/config.override.json` (sibling of config.json)', () => {
		expect(defaultConfigOverridePath()).toBe(
			join(dirname(defaultConfigPath()), 'config.override.json'),
		);
	});

	it('derives the override path from a custom config path (e.g. --config)', () => {
		const custom = '/tmp/some-non-default/config.json';
		expect(defaultConfigOverridePath(custom)).toBe(
			'/tmp/some-non-default/config.override.json',
		);
	});

	it('the real ~/.config/agent-runner/ is NEVER read by the loader unless we name it', () => {
		// The reader is path-injectable: pointing it at a scratch path proves it
		// has no implicit dependency on the real config dir. (This test does NOT
		// touch the real `~`.)
		const scratch = mkdtempSync(join(tmpdir(), 'agent-runner-override-'));
		try {
			const missing = join(scratch, 'config.override.json');
			expect(loadConfigOverride(missing)).toEqual({});
			expect(existsSync(missing)).toBe(false);
			// Sanity: the real home is unchanged (we did not write into it).
			const real = join(
				homedir(),
				'.config',
				'agent-runner',
				'config.override.json.test-must-not-exist',
			);
			expect(existsSync(real)).toBe(false);
		} finally {
			rmSync(scratch, {recursive: true, force: true});
		}
	});
});

describe('loadConfigOverride', () => {
	let dir: string;
	let path: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-runner-override-'));
		path = join(dir, 'config.override.json');
	});
	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it('returns an empty map when the file is missing (a no-op)', () => {
		expect(loadConfigOverride(path)).toEqual({});
	});

	it('reads a valid map verbatim (`*` + a hub-key bucket)', () => {
		writeFileSync(
			path,
			JSON.stringify({
				'*': {autoBuild: false},
				'github-com/wighawag/agent-runner': {integration: 'merge'},
			}),
		);
		const map = loadConfigOverride(path);
		expect(map['*']).toEqual({autoBuild: false});
		expect(map['github-com/wighawag/agent-runner']).toEqual({
			integration: 'merge',
		});
	});

	it('fails LOUDLY on invalid JSON, naming the file', () => {
		writeFileSync(path, '{ not json');
		expect(() => loadConfigOverride(path)).toThrow(/config\.override\.json/);
		expect(() => loadConfigOverride(path)).toThrow(/Invalid JSON/);
	});

	it('fails LOUDLY on a non-object top-level (array / scalar)', () => {
		writeFileSync(path, '[]');
		expect(() => loadConfigOverride(path)).toThrow(/config\.override\.json/);
		expect(() => loadConfigOverride(path)).toThrow(/expected a JSON object/);
		writeFileSync(path, '"a string"');
		expect(() => loadConfigOverride(path)).toThrow(/expected a JSON object/);
	});
});

describe('resolveRepoConfigFromLoaded \u2014 override layering', () => {
	const URL = 'git@github.com:wighawag/agent-runner.git';
	const HUB = encodeRepoKey(URL); // `github-com/wighawag/agent-runner`
	const global = mergeConfig({});

	it('a specific hub-key entry overrides the committed per-repo file', () => {
		const override: ConfigOverrideMap = {
			[HUB]: {integration: 'merge'},
		};
		const resolved = resolveRepoConfigFromLoaded(
			{
				path: 'x',
				config: {integration: 'propose'},
				rejected: [],
			},
			{global, override, arbiterUrl: URL},
		);
		expect(resolved.config.integration).toBe('merge');
	});

	it('`"*"` overrides the committed file for repos with no specific entry', () => {
		const override: ConfigOverrideMap = {'*': {integration: 'merge'}};
		const resolved = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'propose'}, rejected: []},
			{
				global,
				override,
				arbiterUrl: 'git@github.com:other/repo.git',
			},
		);
		expect(resolved.config.integration).toBe('merge');
	});

	it('a hub-key entry beats `"*"` (most-specific-first)', () => {
		const override: ConfigOverrideMap = {
			'*': {integration: 'propose'},
			[HUB]: {integration: 'merge'},
		};
		const resolved = resolveRepoConfigFromLoaded(
			{path: 'x', config: {}, rejected: []},
			{global, override, arbiterUrl: URL},
		);
		expect(resolved.config.integration).toBe('merge');
	});

	it('a SPARSE override touches only the keys it names; others fall through', () => {
		const override: ConfigOverrideMap = {[HUB]: {integration: 'merge'}};
		const resolved = resolveRepoConfigFromLoaded(
			{
				path: 'x',
				config: {integration: 'propose', autoBuild: true},
				rejected: [],
			},
			{global, override, arbiterUrl: URL},
		);
		// `integration` is overridden; `autoBuild` (untouched) keeps the committed value.
		expect(resolved.config.integration).toBe('merge');
		expect(resolved.config.autoBuild).toBe(true);
	});

	it('FLAG > ENV > override:hub > override:* > committed > global > default', () => {
		// Build EVERY layer with a distinct integration value to prove order.
		const overrideMap: ConfigOverrideMap = {
			'*': {integration: 'propose'},
			[HUB]: {integration: 'merge'},
		};
		const env = {AGENT_RUNNER_INTEGRATION: 'propose'} as NodeJS.ProcessEnv;
		// Top: a flag wins over EVERYTHING (env included).
		const flag = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'propose'}, rejected: []},
			{
				global: mergeConfig({integration: 'propose'}),
				override: overrideMap,
				arbiterUrl: URL,
				env,
				flags: {integration: 'merge'},
			},
		);
		expect(flag.config.integration).toBe('merge');

		// Env wins over the override layer.
		const envWins = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'propose'}, rejected: []},
			{
				global: mergeConfig({integration: 'propose'}),
				override: overrideMap, // hub-key = merge
				arbiterUrl: URL,
				env: {AGENT_RUNNER_INTEGRATION: 'propose'} as NodeJS.ProcessEnv,
			},
		);
		expect(envWins.config.integration).toBe('propose');

		// Override:hub beats override:* beats committed beats global.
		const overrideWins = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'propose'}, rejected: []},
			{
				global: mergeConfig({integration: 'propose'}),
				override: overrideMap,
				arbiterUrl: URL,
			},
		);
		expect(overrideWins.config.integration).toBe('merge');

		// Committed beats global (precedence unchanged by this slice).
		const committed = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'merge'}, rejected: []},
			{global: mergeConfig({integration: 'propose'})},
		);
		expect(committed.config.integration).toBe('merge');
	});

	it('may set HOST-ONLY keys (e.g. `piBin`) \u2014 unlike the committed repo file', () => {
		// The override is a per-machine source (ADR \u00a713), so host-only keys are
		// HONOURED \u2014 NOT routed through the per-repo allow/reject split.
		const override: ConfigOverrideMap = {
			[HUB]: {piBin: '/opt/bin/pi'},
			'*': {agentCmd: '/usr/local/bin/agent {model}'},
		};
		const resolved = resolveRepoConfigFromLoaded(
			{path: 'x', config: {}, rejected: []},
			{global, override, arbiterUrl: URL},
		);
		expect(resolved.config.piBin).toBe('/opt/bin/pi');
		expect(resolved.config.agentCmd).toBe('/usr/local/bin/agent {model}');
	});

	it('UNRESOLVABLE arbiter URL \u21d2 hub-key bucket SKIPPED but `"*"` still applies', () => {
		const override: ConfigOverrideMap = {
			'*': {integration: 'merge'},
			[HUB]: {integration: 'propose'},
		};
		const resolved = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'propose'}, rejected: []},
			{global, override /* no arbiterUrl */},
		);
		// hub-key entry could not be looked up; `"*"` still applies.
		expect(resolved.config.integration).toBe('merge');
	});

	it('no override + no arbiter URL \u21d2 byte-identical to the pre-override resolution', () => {
		const resolved = resolveRepoConfigFromLoaded(
			{path: 'x', config: {integration: 'merge'}, rejected: []},
			{global},
		);
		expect(resolved.config.integration).toBe('merge');
		expect(resolved.config.autoBuild).toBe(false); // built-in default
	});

	it('does NOT mutate the shared `global` object across two repos', () => {
		const sharedGlobal = mergeConfig({integration: 'propose'});
		const before = {...sharedGlobal};
		const URL_A = 'git@github.com:org/repo-a.git';
		const URL_B = 'git@github.com:org/repo-b.git';
		const override: ConfigOverrideMap = {
			[encodeRepoKey(URL_A)]: {integration: 'merge'},
		};
		const a = resolveRepoConfigFromLoaded(
			{path: 'x', config: {}, rejected: []},
			{global: sharedGlobal, override, arbiterUrl: URL_A},
		);
		const b = resolveRepoConfigFromLoaded(
			{path: 'x', config: {}, rejected: []},
			{global: sharedGlobal, override, arbiterUrl: URL_B},
		);
		// The hub-key bucket matches A's URL exactly.
		expect(a.config.integration).toBe('merge');
		// B has no specific entry and no `"*"` \u2014 stays at `propose` from global.
		expect(b.config.integration).toBe('propose');
		// `global` untouched.
		expect(sharedGlobal).toEqual(before);
	});
});

describe('resolveRepoConfig \u2014 working-tree path resolves the arbiter URL itself', () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'agent-runner-override-rt-'));
		spawnSync('git', ['init', '-q', '-b', 'main', repo]);
	});
	afterEach(() => {
		rmSync(repo, {recursive: true, force: true});
	});

	it('reads the checkout`s `<defaultArbiter>` remote and applies the matching hub-key entry', () => {
		const URL = 'git@github.com:example/foo.git';
		spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', URL]);
		const HUB = encodeRepoKey(URL);
		const override: ConfigOverrideMap = {
			[HUB]: {integration: 'merge'},
		};
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({integration: 'propose'}),
			override,
		});
		expect(resolved.config.integration).toBe('merge');
	});

	it('an UNRESOLVABLE arbiter remote falls back to `"*"` only \u2014 never errors', () => {
		// No `origin` remote configured \u21d2 the hub-key lookup is skipped.
		const override: ConfigOverrideMap = {
			'*': {integration: 'merge'},
			'never-matched': {integration: 'propose'},
		};
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({integration: 'propose'}),
			override,
		});
		expect(resolved.config.integration).toBe('merge');
	});

	it('an explicitly-passed `arbiterUrl` short-circuits the git lookup', () => {
		// No remote configured at all, but the caller supplies the URL directly
		// (the `do --remote` path's behaviour, here mimicked).
		const URL = 'git@github.com:explicit/repo.git';
		const HUB = encodeRepoKey(URL);
		const override: ConfigOverrideMap = {[HUB]: {integration: 'merge'}};
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({integration: 'propose'}),
			override,
			arbiterUrl: URL,
		});
		expect(resolved.config.integration).toBe('merge');
	});

	it('honours a per-repo `.agent-runner.json` BENEATH the override (precedence)', () => {
		writeFileSync(
			join(repo, REPO_CONFIG_FILENAME),
			JSON.stringify({integration: 'propose', autoBuild: true}),
		);
		const URL = 'git@github.com:example/foo.git';
		spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', URL]);
		const override: ConfigOverrideMap = {
			[encodeRepoKey(URL)]: {integration: 'merge'},
		};
		const resolved = resolveRepoConfig({
			repoPath: repo,
			global: mergeConfig({}),
			override,
		});
		expect(resolved.config.integration).toBe('merge'); // override wins
		expect(resolved.config.autoBuild).toBe(true); // committed file falls through
	});
});

describe('resolveRepoConfigFromMirror \u2014 mirror path resolves origin itself', () => {
	let workdir: string;
	let mirror: string;
	let tmp: string;
	const gitEnv = {
		...process.env,
		GIT_AUTHOR_NAME: 't',
		GIT_AUTHOR_EMAIL: 't@t',
		GIT_COMMITTER_NAME: 't',
		GIT_COMMITTER_EMAIL: 't@t',
	};
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'agent-runner-override-mirror-'));
		workdir = join(tmp, 'work');
		mirror = join(tmp, 'mirror.git');
		mkdirSync(workdir);
		spawnSync('git', ['init', '-q', '-b', 'main', workdir], {env: gitEnv});
		spawnSync(
			'git',
			['-C', workdir, 'commit', '-q', '--allow-empty', '-m', 'init'],
			{env: gitEnv},
		);
		spawnSync('git', ['clone', '-q', '--bare', workdir, mirror], {env: gitEnv});
		spawnSync('git', ['-C', mirror, 'remote', 'remove', 'origin']);
	});
	afterEach(() => {
		rmSync(tmp, {recursive: true, force: true});
	});

	it('looks up the hub-key bucket from the mirror`s `origin` URL', async () => {
		const URL = 'git@github.com:mirror/repo.git';
		spawnSync('git', ['-C', mirror, 'remote', 'add', 'origin', URL]);
		const {resolveRepoConfigFromMirror} = await import('../src/repo-mirror.js');
		const HUB = encodeRepoKey(URL);
		const override: ConfigOverrideMap = {
			[HUB]: {integration: 'merge'},
		};
		const cfg = resolveRepoConfigFromMirror({
			mirrorPath: mirror,
			global: mergeConfig({integration: 'propose'}),
			override,
		});
		expect(cfg.integration).toBe('merge');
	});

	it('mirror with no `origin` falls back to `"*"` only (graceful degrade)', async () => {
		const {resolveRepoConfigFromMirror} = await import('../src/repo-mirror.js');
		const override: ConfigOverrideMap = {
			'*': {integration: 'merge'},
			'never-matched': {integration: 'propose'},
		};
		const cfg = resolveRepoConfigFromMirror({
			mirrorPath: mirror,
			global: mergeConfig({integration: 'propose'}),
			override,
		});
		expect(cfg.integration).toBe('merge');
	});
});
