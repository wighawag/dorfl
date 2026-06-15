/**
 * The provider-agnostic CORE of the `install-ci` scaffolder (PRD `runner-in-ci`,
 * slice `install-ci-core-and-github-adapter`; US #7/#10). `install-ci` is a
 * human-run, one-time SCAFFOLDER (mirrors whitesmith's `src/providers/github-ci.ts`):
 * it writes `.github/**` + a composite setup action + secrets so autonomous work
 * can run headless in CI. The running CI job NEVER edits `.github/workflows/**`
 * (US #9 — that boundary is enforced by the per-capability workflow slices; the
 * core stays agnostic to it).
 *
 * This module is the PROVIDER-AGNOSTIC half: the config model (`ProviderEntry` /
 * `AuthMode` / `CIConfigFile`), the `models.json` builder, the secret-orchestration
 * LOGIC (which secrets, dedup, prompt-or-take-from-config), the `--export-config`
 * (+ `--include-secrets`) round-trip, the composite-setup-action + OAuth-refresh-
 * script generators, the `--fake` snapshot mechanism (write to `.fake/` instead of
 * `.github/`), and the capability-emitter REGISTRY seam. It imports NOTHING
 * GitHub-specific: the thin GitHub adapter (`github-ci.ts`) plugs into the
 * {@link CIProviderContext} seam, so a second provider could slot in WITHOUT
 * touching this core.
 *
 * Reuses whitesmith's PATTERNS (the wizard prompts, the `models.json` shape, the
 * config load/export, the `--fake` mechanism, the secret dedup) but NOT its label
 * state-machine or issue lifecycle (out of scope). The auth/config shape carries
 * NO CI-specific policy field: per ADR `ci-config-policy-and-gate-family`, CI
 * policy is the SAME engine gate family resolved via the generated workflow's
 * `AGENT_RUNNER_*` env block, NOT a new config knob minted here.
 */

import {readFileSync, writeFileSync, mkdirSync, readdirSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {HarnessAdapter} from './config.js';

// ─── Config model ──────────────────────────────────────────────────────────

/**
 * The two auth modes, mirroring whitesmith:
 *   - `models-json` (DEFAULT): one GitHub secret per provider API key; the harness
 *     `models.json` is generated inline and references the env var names. No
 *     OAuth-refresh machinery, no `GH_PAT` — the conservative default.
 *   - `auth-json`: a single `PI_AUTH_JSON` secret + a `GH_PAT` for OAuth-token
 *     refresh + an OAuth-refresh script (the `pi-mono#2743` workaround, the SINGLE
 *     CI→repo mutation in the whole design). The known SHARP EDGE; default AWAY
 *     from it.
 */
export type AuthMode = 'auth-json' | 'models-json';

/**
 * Where the composite setup action gets the `agent-runner` CLI from:
 *   - `registry` (default): `npm install -g agent-runner` — the published CLI,
 *     for every CONSUMER repo;
 *   - `workspace`: build the CLI from the checked-out source (`pnpm install` +
 *     `pnpm -r build`) and link it onto PATH, for the SELF-HOSTING agent-runner
 *     monorepo (which is not published under that npm name, so `registry` would
 *     die with `agent-runner: command not found`). Auto-detected when generating
 *     inside the monorepo (see `installCI`), overridable by an explicit flag/config.
 */
export type InstallSource = 'registry' | 'workspace';

/** A configured AI provider (the harness `models.json` shape this emits). */
export interface ProviderEntry {
	/** Provider name (`anthropic` / `openai` / a custom name). */
	name: string;
	/** Optional custom base URL (overrides the built-in default). */
	baseUrl?: string;
	/** API type for a custom provider (`anthropic-messages` / `openai-completions`). */
	api?: string;
	/** The GitHub-secret / env var name the API key is read from at runtime. */
	apiKeyEnvVar: string;
	/** The model ids exposed for this provider. */
	models: {id: string}[];
	/** OpenAI-compat capability flags for a custom provider. */
	compat?: Record<string, boolean>;
	/** True for the built-in providers (`anthropic` / `openai`). */
	builtin: boolean;
}

/**
 * Serializable CI configuration: the non-interactive `--config <file>` INPUT and
 * the `--export-config` OUTPUT. The wizard gathers exactly this; the config-file
 * path reproduces the wizard's output byte-for-byte from it. When
 * `--include-secrets` is used, `secrets` maps env var names to their actual API
 * key values (set via the provider seam's `setSecret` on install).
 */
export interface CIConfigFile {
	/** The auth mode (`models-json` default). */
	authMode: AuthMode;
	/** The configured providers (empty for `auth-json` mode). */
	providers: ProviderEntry[];
	/** The default provider name. */
	defaultProvider: string;
	/** The default model id. */
	defaultModel: string;
	/** Which harness the composite setup action installs (`pi` default). */
	harness?: HarnessAdapter;
	/** Where to get the CLI from (`registry` default; `workspace` builds from source). */
	installSource?: InstallSource;
	/** API key values keyed by env var name. Only present with `--include-secrets`. */
	secrets?: Record<string, string>;
}

/**
 * The fully-resolved config the generators consume (the wizard / config-file path
 * both produce one of these). Distinct from {@link CIConfigFile} only in that
 * `authMode` + `harness` are guaranteed present and `secrets` is dropped (secrets
 * are orchestrated separately, never written into a generated artifact).
 */
export interface ResolvedCIConfig {
	authMode: AuthMode;
	providers: ProviderEntry[];
	defaultProvider: string;
	defaultModel: string;
	harness: HarnessAdapter;
	installSource: InstallSource;
}

/** The default harness the composite setup action installs. */
export const DEFAULT_HARNESS: HarnessAdapter = 'pi';

/** The default install source: the published CLI via `npm install -g`. */
export const DEFAULT_INSTALL_SOURCE: InstallSource = 'registry';

// ─── The CI-provider SEAM (provider-agnostic; GitHub is the first adapter) ───

/**
 * The thin CI-provider seam (whitesmith's proven `GitHubCIContext` shape,
 * generalised so a second provider could slot in without touching the core). A
 * provider supplies: where it is (`repo`), whether its CLI is usable
 * (`ghAvailable` for GitHub), and how to set a secret (`setSecret`). Tests STUB
 * this entirely — `setSecret` records to memory, `ghAvailable=false`, `repo` a
 * fixture — so no network, no real `gh`, no real GitHub repo detection is touched.
 *
 * The historical GitHub name {@link GitHubCIContext} is kept as an alias so the
 * whitesmith vocabulary the slice adopts reads literally.
 */
export interface CIProviderContext {
	/** The target repo's working directory (where `.github/` / `.fake/` is written). */
	workDir: string;
	/** The `owner/repo` slug, or `undefined` when not (yet) known. */
	repo: string | undefined;
	/** Whether the provider's CLI (`gh`) is available + authenticated. */
	ghAvailable: boolean;
	/** Record/set a secret on the provider. Tests record to memory. */
	setSecret(name: string, value: string): Promise<void>;
	/**
	 * OPTIONALLY set a provider repo-setting (capability-F residue: GitHub's
	 * `delete_branch_on_merge`). Absent on a provider that has no such setting.
	 * Stubbed in tests; never silently toggled (the wizard prompts).
	 */
	setRepoSetting?(name: string, value: boolean): Promise<void>;
}

/** Whitesmith's name for {@link CIProviderContext} (the seam this slice adopts). */
export type GitHubCIContext = CIProviderContext;

// ─── The capability-emitter REGISTRY seam (file-orthogonality) ───────────────

/**
 * One file/artifact a capability emitter produces (a workflow YAML, etc.). `path`
 * is repo-relative (under the output base — `.github/` or `.fake/`).
 */
export interface EmittedFile {
	/** Path relative to the output base (e.g. `workflows/build-tick.yml`). */
	path: string;
	/** The file's full text content. */
	content: string;
}

/**
 * A capability emitter: a per-capability module that, given the resolved config,
 * returns the workflow file(s) for its capability. The four sibling capability
 * slices (build-tick, advance-lifecycle, intake, close-job) each ADD one of these
 * as a NEW self-registering module — NOT an edit to a shared central
 * list/switch — so they stay file-orthogonal and mergeable in parallel
 * (WORK-CONTRACT slice-quality / `to-slices` §3).
 */
export interface CapabilityEmitter {
	/** A stable id for the capability (e.g. `build-slice-tick`). */
	id: string;
	/** Human-readable label for the wizard's capability selection. */
	label: string;
	/** Emit this capability's workflow file(s) for the resolved config. */
	emit(config: ResolvedCIConfig): EmittedFile[];
}

/**
 * The in-memory capability REGISTRY. Capability modules self-register by calling
 * {@link registerCapability} at import time; {@link loadCapabilityRegistry}
 * discovers + imports every module under `install-ci-capabilities/` (a DIRECTORY
 * of emitters, NOT a hand-edited central list), so adding a capability is a NEW
 * file, never an edit to this one.
 */
const REGISTRY = new Map<string, CapabilityEmitter>();

/**
 * Register a capability emitter. Idempotent per id (re-registering the same id
 * replaces it — module import is idempotent). Called at import time by each
 * capability module under `install-ci-capabilities/`.
 */
export function registerCapability(emitter: CapabilityEmitter): void {
	REGISTRY.set(emitter.id, emitter);
}

/** The currently-registered capabilities (in registration order). */
export function registeredCapabilities(): CapabilityEmitter[] {
	return [...REGISTRY.values()];
}

/** Reset the registry (tests; never used in production). */
export function clearCapabilityRegistry(): void {
	REGISTRY.clear();
}

/**
 * Locate the `install-ci-capabilities/` directory next to this module — the
 * DIRECTORY of self-registering capability emitters. Resolved relative to this
 * source file so it works from both `src/` (tsx) and `dist/` (the built CLI).
 * `override` short-circuits for tests / unusual layouts.
 */
export function resolveCapabilitiesDir(override?: string): string {
	if (override) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, 'install-ci-capabilities');
}

/**
 * Discover + import every capability module under `install-ci-capabilities/`,
 * each of which self-registers via {@link registerCapability} at import time.
 * This is the file-orthogonality mechanism: a new capability is a NEW file in
 * that directory, picked up here WITHOUT editing any shared list/switch. Returns
 * the registry after loading. `dir` overrides the directory (tests).
 */
export async function loadCapabilityRegistry(
	dir?: string,
): Promise<CapabilityEmitter[]> {
	const capDir = resolveCapabilitiesDir(dir);
	let entries: string[];
	try {
		entries = readdirSync(capDir);
	} catch {
		return registeredCapabilities(); // no directory yet → nothing to load
	}
	// Import each emitter module. Built output is `.js`; source (tsx) is `.ts`.
	const modules = entries
		.filter((f) => /\.(js|ts)$/.test(f) && !/\.d\.ts$/.test(f))
		.sort();
	for (const file of modules) {
		// A path-based dynamic import works under both tsx (src) and node (dist).
		await import(pathToFileUrl(join(capDir, file)));
	}
	return registeredCapabilities();
}

/** Convert an absolute path to a `file://` URL for a portable dynamic import. */
function pathToFileUrl(absPath: string): string {
	return new URL(`file://${absPath}`).href;
}

// ─── models.json generation ──────────────────────────────────────────────────

/**
 * Build the harness `models.json` object from the providers. Built-in providers
 * (`anthropic`/`openai`) get `{apiKey: <ENV_VAR>}` (the harness resolves the env
 * var at runtime); a custom provider carries its `baseUrl`/`api`/`models`/`compat`.
 * Mirrors whitesmith's `buildModelsJson`.
 */
export function buildModelsJson(providers: ProviderEntry[]): {
	providers: Record<string, unknown>;
} {
	const providersObj: Record<string, unknown> = {};
	for (const p of providers) {
		if (p.builtin) {
			const entry: Record<string, unknown> = {apiKey: p.apiKeyEnvVar};
			if (p.baseUrl) entry.baseUrl = p.baseUrl;
			providersObj[p.name] = entry;
		} else {
			const entry: Record<string, unknown> = {
				baseUrl: p.baseUrl,
				api: p.api,
				apiKey: p.apiKeyEnvVar,
				models: p.models,
			};
			if (p.compat) entry.compat = p.compat;
			providersObj[p.name] = entry;
		}
	}
	return {providers: providersObj};
}

// ─── secret-orchestration LOGIC (which secrets, dedup) ───────────────────────

/**
 * The DEDUPLICATED set of secret env-var names the config requires, in first-seen
 * order. For `models-json` mode it is one per distinct provider `apiKeyEnvVar`;
 * for `auth-json` mode it is the fixed `PI_AUTH_JSON` + `GH_PAT` pair (the sharp
 * edge). This is the pure secret-orchestration LOGIC the adapter's setter
 * consumes — which secrets, deduped — separated from any provider I/O.
 */
export function requiredSecretNames(config: ResolvedCIConfig): string[] {
	if (config.authMode === 'auth-json') {
		return ['PI_AUTH_JSON', 'GH_PAT'];
	}
	const seen = new Set<string>();
	const names: string[] = [];
	for (const p of config.providers) {
		if (seen.has(p.apiKeyEnvVar)) continue;
		seen.add(p.apiKeyEnvVar);
		names.push(p.apiKeyEnvVar);
	}
	return names;
}

/** The outcome of orchestrating one secret through the provider seam. */
export interface SecretSetResult {
	/** The secret env-var name. */
	name: string;
	/** `set` (recorded on the provider) / `skipped` (no value) / `failed`. */
	status: 'set' | 'skipped' | 'failed';
	/** The failure detail when `status === 'failed'`. */
	error?: string;
}

/**
 * Orchestrate the required secrets through the provider seam: for each
 * DEDUPLICATED required name, take its value from `knownSecrets` (the
 * config-file/`--include-secrets` path) when present, else from `prompt` (the
 * interactive path), then record it via `ctx.setSecret`. An empty value is
 * SKIPPED (never set blank); a `setSecret` rejection is reported as `failed`
 * without aborting the rest. Mirrors whitesmith's `setOrPromptSecrets` dedup +
 * prompt-or-take logic, but provider-agnostic (the seam is `ctx.setSecret`).
 *
 * NO real secret is touched in `--fake` mode / tests: the caller passes a STUB
 * `ctx` whose `setSecret` records to memory. This function never reads/writes a
 * real secrets store, `~`, or git config.
 */
export async function orchestrateSecrets(options: {
	ctx: CIProviderContext;
	config: ResolvedCIConfig;
	/** Known secret values (config-file `secrets` / `--include-secrets`). */
	knownSecrets?: Record<string, string>;
	/** Prompt for a missing secret value (interactive path). Tests stub it. */
	prompt?: (name: string) => Promise<string>;
}): Promise<SecretSetResult[]> {
	const {ctx, config, knownSecrets, prompt} = options;
	const results: SecretSetResult[] = [];
	for (const name of requiredSecretNames(config)) {
		let value = knownSecrets?.[name];
		if (value === undefined && prompt) {
			value = await prompt(name);
		}
		if (!value) {
			results.push({name, status: 'skipped'});
			continue;
		}
		try {
			await ctx.setSecret(name, value);
			results.push({name, status: 'set'});
		} catch (err) {
			results.push({
				name,
				status: 'failed',
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return results;
}

// ─── config load + export ────────────────────────────────────────────────────

/** Raised for a malformed `--config <file>`. */
export class CIConfigError extends Error {}

/**
 * Load + validate a `--config <file>`: the non-interactive path that skips all
 * prompts. The loaded config reproduces the wizard's output byte-for-byte. A
 * missing/empty required field is a loud {@link CIConfigError} (never a silent
 * default), because a config file is a deliberate reproduction artifact.
 */
export function loadCIConfigFile(filePath: string): CIConfigFile {
	let data: CIConfigFile;
	try {
		data = JSON.parse(readFileSync(filePath, 'utf8')) as CIConfigFile;
	} catch (err) {
		throw new CIConfigError(
			`could not read/parse config file ${filePath}: ` +
				(err instanceof Error ? err.message : String(err)),
		);
	}
	const authMode = data.authMode ?? 'models-json';
	if (authMode !== 'models-json' && authMode !== 'auth-json') {
		throw new CIConfigError(
			`config file "authMode" must be "models-json" or "auth-json"`,
		);
	}
	if (!data.defaultProvider) {
		throw new CIConfigError('config file must contain "defaultProvider"');
	}
	if (!data.defaultModel) {
		throw new CIConfigError('config file must contain "defaultModel"');
	}
	if (
		data.installSource !== undefined &&
		data.installSource !== 'registry' &&
		data.installSource !== 'workspace'
	) {
		throw new CIConfigError(
			`config file "installSource" must be "registry" or "workspace"`,
		);
	}
	if (authMode === 'models-json') {
		if (
			!data.providers ||
			!Array.isArray(data.providers) ||
			data.providers.length === 0
		) {
			throw new CIConfigError(
				'config file (models-json) must contain a non-empty "providers" array',
			);
		}
	}
	return {
		authMode,
		providers: data.providers ?? [],
		defaultProvider: data.defaultProvider,
		defaultModel: data.defaultModel,
		harness: data.harness,
		installSource: data.installSource,
		secrets: data.secrets,
	};
}

/** Resolve a loaded/gathered {@link CIConfigFile} into a {@link ResolvedCIConfig}. */
export function resolveCIConfig(file: CIConfigFile): ResolvedCIConfig {
	return {
		authMode: file.authMode,
		providers: file.providers,
		defaultProvider: file.defaultProvider,
		defaultModel: file.defaultModel,
		harness: file.harness ?? DEFAULT_HARNESS,
		installSource: file.installSource ?? DEFAULT_INSTALL_SOURCE,
	};
}

/**
 * Serialise a config to the `--export-config` JSON text (stable 2-space indent +
 * trailing newline, exactly the shape {@link loadCIConfigFile} reads back). When
 * `secrets` is supplied (the `--include-secrets` path) it is included; otherwise
 * the `secrets` field is omitted entirely (never an empty object).
 */
export function exportCIConfig(
	config: ResolvedCIConfig,
	secrets?: Record<string, string>,
): string {
	const file: CIConfigFile = {
		authMode: config.authMode,
		providers: config.providers,
		defaultProvider: config.defaultProvider,
		defaultModel: config.defaultModel,
		harness: config.harness,
		installSource: config.installSource,
	};
	if (secrets && Object.keys(secrets).length > 0) {
		file.secrets = secrets;
	}
	return JSON.stringify(file, null, 2) + '\n';
}

// ─── composite setup action + OAuth-refresh script generation ────────────────

/** Indent every non-blank line of `text` by `spaces` spaces. */
function indent(text: string, spaces: number): string {
	const pad = ' '.repeat(spaces);
	return text
		.split('\n')
		.map((line) => (line.trim() === '' ? '' : pad + line))
		.join('\n');
}

/**
 * The install step for the configured harness (the `pi` CLI; `''` ⇒ none).
 * `registry` mode installs via `npm install -g`; `workspace` mode installs via
 * `pnpm add -g` so the harness lands on the pnpm global bin already on
 * `$GITHUB_PATH` (mirroring whitesmith's dev mode).
 */
function harnessInstallStep(
	harness: HarnessAdapter,
	installSource: InstallSource,
): string {
	if (harness === 'pi') {
		const run =
			installSource === 'workspace'
				? 'pnpm add -g @mariozechner/pi-coding-agent'
				: 'npm install -g @mariozechner/pi-coding-agent';
		return `
    - name: Install agent harness (pi)
      shell: bash
      run: ${run}`;
	}
	return '';
}

/**
 * Generate the shared COMPOSITE SETUP ACTION (`agent-runner-setup`): installs
 * Node + `agent-runner` + the configured harness, configures git identity, and
 * configures AI-provider auth. Written to
 * `<base>/actions/agent-runner-setup/action.yml` so a workflow can
 * `uses: ./.github/actions/agent-runner-setup`. The advance-loop seed template
 * already references this exact action name + path (`docs/ci/README.md`).
 *
 * The auth step branches on the mode: `models-json` writes a generated
 * `~/.pi/agent/models.json` inline (the conservative default); `auth-json` writes
 * `~/.pi/agent/auth.json` from `$PI_AUTH_JSON` + runs the OAuth-refresh script
 * (the sharp edge). Deterministic: the same config produces byte-identical output.
 */
export function generateSetupAction(config: ResolvedCIConfig): string {
	let authStep: string;
	if (config.authMode === 'auth-json') {
		authStep = `\
    - name: Configure agent auth (auth.json)
      shell: bash
      run: |
        if [ -z "$PI_AUTH_JSON" ]; then
          echo "ERROR: PI_AUTH_JSON secret is not set" >&2; exit 1
        fi
        mkdir -p ~/.pi/agent
        echo "$PI_AUTH_JSON" > ~/.pi/agent/auth.json
        chmod 600 ~/.pi/agent/auth.json

    # Workaround for https://github.com/badlogic/pi-mono/issues/2743 — the SINGLE
    # CI→repo mutation in the design; needs GH_PAT to rotate PI_AUTH_JSON.
    - name: Refresh OAuth token
      shell: bash
      run: node .github/scripts/refresh-oauth-token.mjs`;
	} else {
		const modelsJsonStr = JSON.stringify(
			buildModelsJson(config.providers),
			null,
			2,
		);
		authStep = `\
    - name: Configure agent models (models.json)
      shell: bash
      run: |
        mkdir -p ~/.pi/agent
        cat > ~/.pi/agent/models.json << 'MODELS_EOF'
${indent(modelsJsonStr, 8)}
        MODELS_EOF`;
	}

	const installHarness = harnessInstallStep(
		config.harness,
		config.installSource,
	);

	// The CLI-install block branches on installSource. `registry` installs the
	// published CLI via `npm install -g agent-runner` (the default for every
	// consumer repo). `workspace` builds the CLI from the checked-out source and
	// links it onto PATH — for the self-hosting agent-runner monorepo, which is
	// not published under that npm name. We add pnpm's global bin to $GITHUB_PATH
	// so the linked `agent-runner` (and the pnpm-installed harness) are on PATH in
	// all subsequent steps; we always rebuild because source changes per commit.
	let installSteps: string;
	if (config.installSource === 'workspace') {
		installSteps = `\
    - name: Setup pnpm
      uses: pnpm/action-setup@v4

    - name: Add pnpm global bin to PATH
      shell: bash
      run: |
        pnpm setup
        echo "$HOME/.local/share/pnpm" >> "$GITHUB_PATH"

    - name: Install dependencies and build agent-runner
      shell: bash
      run: |
        pnpm install
        pnpm -r build
        cd packages/agent-runner && pnpm link --global${installHarness}`;
	} else {
		installSteps = `\
    - name: Install agent-runner
      shell: bash
      run: npm install -g agent-runner${installHarness}`;
	}

	return `\
name: Setup agent-runner
description: Install Node.js, agent-runner, the agent harness, and configure AI provider auth

runs:
  using: composite
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Configure git identity
      shell: bash
      run: |
        git config user.name "agent-runner[bot]"
        git config user.email "agent-runner[bot]@users.noreply.github.com"

${installSteps}

${authStep}
`;
}

/**
 * The OAuth-refresh script emitted ONLY in `auth-json` mode (whitesmith's
 * `pi-mono#2743` workaround): refreshes the Anthropic OAuth token in
 * `~/.pi/agent/auth.json` before the agent runs, then writes the rotated token
 * BACK via `gh secret set PI_AUTH_JSON` (the single CI→repo mutation, needing a
 * `GH_PAT`). This is the documented SHARP EDGE; `models-json` mode avoids it.
 */
export const REFRESH_OAUTH_SCRIPT = `\
#!/usr/bin/env node
/**
 * Refresh OAuth tokens in the agent's auth.json before it runs.
 *
 * Workaround for https://github.com/badlogic/pi-mono/issues/2743.
 * After refreshing, updates the PI_AUTH_JSON GitHub secret so the next run has
 * the latest rotated refresh token (requires GH_PAT with repo scope). This is the
 * known SHARP EDGE of auth-json mode; models-json mode avoids it entirely.
 *
 * Remove this script once the upstream fix is released.
 */
import { readFileSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

const authPath = join(process.env.HOME, ".pi", "agent", "auth.json");
const auth = JSON.parse(readFileSync(authPath, "utf-8"));
const cred = auth.anthropic;

if (!cred || cred.type !== "oauth") {
  console.log("No OAuth credentials for anthropic, skipping refresh");
  process.exit(0);
}

if (Date.now() < cred.expires) {
  console.log("Token still valid until", new Date(cred.expires).toISOString());
  process.exit(0);
}

console.log(
  "Token expired at",
  new Date(cred.expires).toISOString(),
  "- refreshing..."
);

const response = await fetch(ANTHROPIC_TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ANTHROPIC_CLIENT_ID,
    refresh_token: cred.refresh,
  }).toString(),
  signal: AbortSignal.timeout(30_000),
});

const data = await response.json();

if (!response.ok) {
  console.error("Refresh failed:", response.status, JSON.stringify(data));
  process.exit(1);
}

auth.anthropic = {
  type: "oauth",
  refresh: data.refresh_token,
  access: data.access_token,
  expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
};

writeFileSync(authPath, JSON.stringify(auth, null, 2));
chmodSync(authPath, 0o600);
console.log(
  "Token refreshed, new expiry:",
  new Date(auth.anthropic.expires).toISOString()
);

// Update the GitHub secret so the next run has the latest refresh token.
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_PAT;
if (repo && token) {
  try {
    execSync(\`gh secret set PI_AUTH_JSON --repo "\${repo}"\`, {
      input: JSON.stringify(auth),
      env: { ...process.env, GH_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log("PI_AUTH_JSON secret updated");
  } catch (err) {
    console.warn("Failed to update secret (non-fatal):", err.stderr?.toString() || err.message);
  }
} else {
  console.log("Skipping secret update (no GH_PAT or GITHUB_REPOSITORY)");
}
`;

// ─── the --fake snapshot mechanism + artifact assembly ───────────────────────

/**
 * The setup ARTIFACTS this slice generates: the composite setup action + (in
 * `auth-json` mode) the OAuth-refresh script, plus any selected capabilities'
 * workflow files. This slice emits NO capability workflow itself (those are the
 * sibling slices); `capabilities` defaults to none.
 */
export function buildSetupArtifacts(
	config: ResolvedCIConfig,
	capabilities: CapabilityEmitter[] = [],
): EmittedFile[] {
	const files: EmittedFile[] = [
		{
			path: join('actions', 'agent-runner-setup', 'action.yml'),
			content: generateSetupAction(config),
		},
	];
	if (config.authMode === 'auth-json') {
		files.push({
			path: join('scripts', 'refresh-oauth-token.mjs'),
			content: REFRESH_OAUTH_SCRIPT,
		});
	}
	for (const cap of capabilities) {
		files.push(...cap.emit(config));
	}
	return files;
}

/**
 * The output base directory name: `.fake` in `--fake` snapshot mode (a scratch
 * dir, NEVER `.github/`), else `.github`. The `--fake` mechanism: write to a
 * `.fake/` scratch dir, never the real `.github/`, and set NO real secret — so
 * the produced files are snapshot-asserted with no side effects on the repo.
 */
export function outputBaseName(fake: boolean): string {
	return fake ? '.fake' : '.github';
}

/**
 * Write the artifacts under `<workDir>/<base>/` (base = `.fake` when `fake`, else
 * `.github`). Returns the repo-relative paths actually written. Pure filesystem
 * I/O — no secrets, no git. Creates parent dirs as needed.
 */
export function writeArtifacts(options: {
	workDir: string;
	fake: boolean;
	files: EmittedFile[];
}): string[] {
	const base = outputBaseName(options.fake);
	const written: string[] = [];
	for (const file of options.files) {
		const abs = join(options.workDir, base, file.path);
		mkdirSync(dirname(abs), {recursive: true});
		writeFileSync(abs, file.content, 'utf8');
		written.push(relative(options.workDir, abs));
	}
	return written;
}
