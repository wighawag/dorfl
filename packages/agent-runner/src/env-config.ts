import type {Config, PartialConfig} from './config.js';
import {brand, constantCase} from './brand.js';

/**
 * The environment-variable config layer.
 *
 * A per-machine context (a CI job, a developer's shell) can set ANY {@link Config}
 * key via an `AGENT_RUNNER_*` environment variable WITHOUT committing a file —
 * including the host-only keys (`piBin`, `agentCmd`, …) that the per-repo
 * `.agent-runner.json` deliberately rejects.
 *
 * Env is a legitimate *per-machine source* — exactly like a CLI flag or the
 * global `~/.config/agent-runner/config.json` — so it is NOT subject to the
 * per-repo allow/reject split (that split only governs the *committed repo
 * file*). This is the sharpened host-only principle (ADR §13): host-only keys
 * must come from a per-machine source (flag, env, or global file), never the
 * committed repo file; env is simply the per-machine source CI actually has
 * without writing a file.
 *
 * Resolution chain (highest wins):
 *
 *   flag > ENV (AGENT_RUNNER_*) > per-repo > global > built-in default
 *
 * Naming: `AGENT_RUNNER_<SCREAMING_SNAKE(key)>` (mechanical camelCase →
 * SCREAMING_SNAKE, prefixed with `AGENT_RUNNER_` to match the binary). E.g.
 * `AGENT_RUNNER_AGENT_CMD`, `AGENT_RUNNER_PI_BIN`, `AGENT_RUNNER_DEFAULT_ARBITER`,
 * `AGENT_RUNNER_PER_REPO_MAX`.
 *
 * Each value is coerced per the key's type and a typo/invalid value FAILS LOUDLY
 * (never silently ignored) with a message naming the offending variable.
 */

/**
 * The shared `AGENT_RUNNER_` prefix on every env config variable. Derived from
 * the single brand identity (`constantCase(base) + '_'`) so a rename flips the
 * prefix in lockstep with the binary name (see `brand.ts`).
 */
export const ENV_PREFIX = brand.envPrefix;

/** How a key's env value is coerced from its raw string. */
type Coercion =
	| 'string'
	| 'boolean'
	| 'number'
	| 'list'
	| {enum: readonly string[]};

/**
 * The coercion to apply per env-settable {@link Config} key. The source of truth
 * for which env vars exist and how their raw strings become typed values. EVERY
 * SCALAR `Config` key appears here (host-only included) — env is a per-machine
 * source, so no scalar key is off-limits. Keys not listed have no env var.
 *
 * The lone EXCLUSION is `identity`: it is a NESTED structured object (with its
 * own `auth`/`providers` sub-objects), not a scalar a single env string can
 * carry. A `tokenEnv` indirection already covers the one secret a CI/per-machine
 * context legitimately injects via env (the `gh` token), so there is no JSON-in-
 * env hack here. The mapped type is `Partial` precisely to ALLOW this exclusion.
 */
const KEY_COERCIONS: {[K in keyof Config]?: Coercion} = {
	autoBuild: 'boolean',
	autoSlice: 'boolean',
	autoTriage: 'boolean',
	prdsFirst: 'boolean',
	maxParallel: 'number',
	perRepoMax: 'number',
	defaultArbiter: 'string',
	workspacesDir: 'string',
	arbitersDir: 'string',
	humanWorktreesDir: 'string',
	integration: {enum: ['propose', 'merge']},
	provider: {enum: ['none', 'github']},
	agentCmd: 'string',
	model: 'string',
	harness: {enum: ['null', 'pi']},
	piBin: 'string',
	sessionsDir: 'string',
	verify: 'list',
	review: 'boolean',
	autoMerge: 'boolean',
	reviewModel: 'string',
	reviewMaxRounds: 'number',
	slicerLoop: 'boolean',
	slicerLoopMax: 'number',
	slicerLoopModel: 'string',
};

/** The `AGENT_RUNNER_*` env var name for a config key (`perRepoMax` →
 * `AGENT_RUNNER_PER_REPO_MAX`): the brand prefix + the key in `constantCase`. */
export function envVarName(key: keyof Config): string {
	return ENV_PREFIX + constantCase(key);
}

/** A raw env map (defaults to `process.env`). */
export type EnvMap = Record<string, string | undefined>;

/**
 * Coerce a raw env string for one key, FAILING LOUDLY (with the offending var
 * name) on invalid input: booleans accept only `true`/`false`; numbers reject
 * NaN; enums must be in their union; list keys split on comma; strings verbatim.
 */
function coerceValue(
	varName: string,
	raw: string,
	coercion: Coercion,
): unknown {
	if (typeof coercion === 'object') {
		// Enum: validate against the union.
		if (!coercion.enum.includes(raw)) {
			throw new Error(
				`Invalid value for ${varName}: '${raw}'. ` +
					`Expected one of: ${coercion.enum.join(', ')}.`,
			);
		}
		return raw;
	}
	switch (coercion) {
		case 'string':
			return raw;
		case 'boolean':
			if (raw === 'true') {
				return true;
			}
			if (raw === 'false') {
				return false;
			}
			throw new Error(
				`Invalid boolean for ${varName}: '${raw}'. Expected 'true' or 'false'.`,
			);
		case 'number': {
			const n = Number(raw);
			if (raw.trim() === '' || Number.isNaN(n)) {
				throw new Error(
					`Invalid number for ${varName}: '${raw}'. Expected a numeric value.`,
				);
			}
			return n;
		}
		case 'list':
			// Split on comma (cross-platform; not `:`), trimming each entry. An empty
			// string ⇒ an empty list (an explicit "clear" of a list key).
			return raw
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s !== '');
	}
}

/**
 * Read the `AGENT_RUNNER_*` env layer into a {@link PartialConfig}. Only vars
 * actually present (and non-`undefined`) contribute, so absent env ⇒ `{}` and
 * built-in floors/defaults are untouched. Each present var is coerced per its
 * key's type; an invalid value throws LOUDLY naming the variable.
 *
 * Env may set ANY key — host-only included — because env is a per-machine
 * source, NOT the committed repo file (see this module's doc + ADR §13).
 */
export function envOverrides(env: EnvMap = process.env): PartialConfig {
	const overrides: PartialConfig = {};
	for (const key of Object.keys(KEY_COERCIONS) as (keyof Config)[]) {
		const coercion = KEY_COERCIONS[key];
		if (coercion === undefined) {
			continue;
		}
		const varName = envVarName(key);
		const raw = env[varName];
		if (raw === undefined) {
			continue;
		}
		const value = coerceValue(varName, raw, coercion);
		// Type matches by construction: each coercion yields the key's value type.
		(overrides as Record<string, unknown>)[key] = value;
	}
	return overrides;
}
