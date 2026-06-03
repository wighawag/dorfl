import {readFileSync, existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

/** How a completed item is integrated back to the arbiter's `main`. */
export type IntegrationMode = 'pr' | 'merge';

/**
 * Resolved runner configuration. Increment A (`scan`) consumes the discovery +
 * eligibility fields; increment B (`run --once`) additionally consumes the
 * execution fields (maxParallel, perRepoMax, defaultArbiter, integration,
 * agentCmd).
 */
export interface Config {
	/** Directories to walk looking for participating repos. */
	roots: string[];
	/** Explicit repo paths to include even if detection would skip them. */
	include: string[];
	/** Repo paths to exclude even if detection would find them. */
	exclude: string[];
	/**
	 * Runner policy for items with an unspecified (omitted) `afk` gate.
	 * `false` (default, strict) ⇒ only `afk: true` items are eligible.
	 * `true` ⇒ items with no `afk` set are also eligible.
	 */
	allowUnspecifiedGate: boolean;
	/** Global cap on how many items the runner claims+runs in one tick. */
	maxParallel: number;
	/** Per-repo cap on concurrent claims (≤ maxParallel in effect). */
	perRepoMax: number;
	/** Name of the git remote that serializes claims (the arbiter). */
	defaultArbiter: string;
	/** Integration mode for completed items: `pr` (default) or `merge`. */
	integration: IntegrationMode;
	/**
	 * The command the runner shells out to for one slice. The runner appends the
	 * built prompt on stdin; the command does NO git ops on the repo (the runner
	 * owns those). Empty string ⇒ no agent configured (run will refuse).
	 */
	agentCmd: string;
}

/** A partial config, e.g. loaded from a JSON file or built from CLI flags. */
export type PartialConfig = Partial<Config>;

/**
 * Built-in defaults. Chosen so that zero-config is useful: scan the current
 * working directory and stay strict about the AFK gate.
 */
export const DEFAULT_CONFIG: Config = {
	roots: [process.cwd()],
	include: [],
	exclude: [],
	allowUnspecifiedGate: false,
	maxParallel: 4,
	perRepoMax: 2,
	defaultArbiter: 'origin',
	integration: 'pr',
	agentCmd: '',
};

/** The conventional config location (`~/.config/agent-runner/config.json`). */
export function defaultConfigPath(): string {
	return join(homedir(), '.config', 'agent-runner', 'config.json');
}

/** Merge a partial config over the built-in defaults; arrays are replaced. */
export function mergeConfig(overrides: PartialConfig): Config {
	const merged: Config = {...DEFAULT_CONFIG};
	for (const key of Object.keys(merged) as (keyof Config)[]) {
		const value = overrides[key];
		if (value !== undefined) {
			// Assign through `any`: each key's value type matches by construction.
			(merged as Record<keyof Config, unknown>)[key] = value;
		}
	}
	return merged;
}

/**
 * Load config from `path`, merged over defaults. A missing file is not an error
 * (defaults make the tool work out of the box); invalid JSON is.
 */
export function loadConfig(path: string = defaultConfigPath()): Config {
	if (!existsSync(path)) {
		return mergeConfig({});
	}
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(
			`Failed to read config at ${path}: ${(err as Error).message}`,
		);
	}
	let parsed: PartialConfig;
	try {
		parsed = JSON.parse(raw) as PartialConfig;
	} catch (err) {
		throw new Error(
			`Invalid JSON in config at ${path}: ${(err as Error).message}`,
		);
	}
	return mergeConfig(parsed);
}
