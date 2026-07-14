import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {defaultConfigPath, type PartialConfig} from './config.js';

/**
 * The **per-machine config override layer** (ADR
 * `per-machine-config-override-layer`): a single file at
 * `<configDir>/config.override.json` (sibling of `config.json`) that overrides
 * the COMMITTED per-repo `dorfl.json` but is itself overridden by env
 * and flags. It gives the laptop a stable, file-based, high-precedence per-
 * machine lever symmetric to CI's `DORFL_*` env, fixing "I can't make
 * this checkout override what the repo committed without an env var whose
 * setting depends on where I invoke from."
 *
 * Shape: a JSON object whose keys are HUB KEYS (as
 * `encodeRepoKey(arbiterUrl)` produces, e.g. `github-com/wighawag/dorfl`)
 * plus an optional `"*"` bucket meaning "all repos on this machine":
 *
 * ```json
 * {
 *   "*": { "autoBuild": false },
 *   "github-com/wighawag/dorfl": { "integration": "merge" }
 * }
 * ```
 *
 * Resolution (in {@link resolveRepoConfigFromLoaded}) inserts the override as
 * two spread layers BETWEEN the committed repo file and env \u2014 a sparse,
 * shallow merge, never mutating `global`:
 *
 * ```
 * flag > env > override[hubKey] > override["*"] > committed per-repo > global > default
 * ```
 *
 * The hub-key entry beats `"*"` (most-specific-first), mirroring how the
 * committed per-repo file beats global one level down.
 *
 * The override file is a PER-MACHINE source in the same class as env / flag /
 * the global config, so the sharpened host-only principle (ADR
 * `execution-substrate-decisions.md` \u00a713) is satisfied: it may set ANY
 * `Config` key, host-only included (`piBin`, `agentCmd`, \u2026). It is therefore NOT
 * subject to the {@link REPO_ALLOWED_KEYS}/{@link REPO_REJECTED_KEYS} split that
 * governs only the committed repo file.
 *
 * The file path is INJECTABLE so tests need not touch the real `~/.config/`.
 */

/**
 * A per-machine override map. Keys are HUB KEYS (`encodeRepoKey`); `"*"` is the
 * all-repos bucket. Each value is a sparse {@link PartialConfig} \u2014 only the
 * fields it sets are overridden; everything else falls through the rest of the
 * precedence chain.
 */
export interface ConfigOverrideMap {
	/** The all-repos override bucket (lowest specificity within the override layer). */
	'*'?: PartialConfig;
	/** Per-hub-key override bucket (beats `"*"`); see {@link encodeRepoKey}. */
	[hubKey: string]: PartialConfig | undefined;
}

/**
 * The conventional override file location (`<configDir>/config.override.json`,
 * sibling of `config.json`). Defaults to the standard `defaultConfigPath()`
 * dir; pass a custom `configPath` to derive the override path from a non-
 * default config location (e.g. `--config` on the CLI). Injectable so tests
 * never touch the real `~/.config/dorfl/`.
 */
export function defaultConfigOverridePath(
	configPath: string = defaultConfigPath(),
): string {
	return join(dirname(configPath), 'config.override.json');
}

/**
 * Read the per-machine {@link ConfigOverrideMap} from `path`. A MISSING file is
 * NOT an error (it resolves to an empty map \u2014 byte-identical to today's
 * behaviour). INVALID JSON, or a non-object top-level, FAILS LOUDLY naming the
 * file (like the other config readers). The path is INJECTABLE so tests point
 * it at a scratch file; production defaults to {@link defaultConfigOverridePath}.
 *
 * The values are accepted verbatim \u2014 the override layer is a per-machine source
 * and may set ANY `Config` key (host-only included). Validation of individual
 * keys happens at the resolution site through the SAME merge primitive the rest
 * of the chain uses.
 */
export function loadConfigOverride(
	path: string = defaultConfigOverridePath(),
): ConfigOverrideMap {
	if (!existsSync(path)) {
		return {};
	}
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(
			`Failed to read config override at ${path}: ${(err as Error).message}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Invalid JSON in config override at ${path}: ${(err as Error).message}`,
		);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(
			`Invalid config override at ${path}: expected a JSON object of the shape ` +
				`{"*"?: PartialConfig, "<hub-key>"?: PartialConfig}, got ${
					Array.isArray(parsed) ? 'an array' : typeof parsed
				}.`,
		);
	}
	return parsed as ConfigOverrideMap;
}
