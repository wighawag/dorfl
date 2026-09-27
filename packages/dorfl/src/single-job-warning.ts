/**
 * The **old single-job workflow warning** (decision 9 of ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-warn-single-job-workflows`).
 *
 * A consumer that upgrades dorfl but keeps a workflow generated before the CI
 * split runs an agent verb in ONE job whose checkout persisted the write token
 * in `.git/config`. The agent can read that credential. dorfl cannot fix the
 * workflow from inside it, so it warns loudly: in GitHub Actions, when an
 * agent-spawning verb ({@link AGENT_SPAWNING_VERBS}) runs WITHOUT `--phase` in a
 * checkout whose local git config holds a credential. Behaviour is otherwise
 * unchanged; the next minor version turns this warning into a refusal (an
 * intent recorded in the warning text and the changeset, not in code).
 *
 * The credential itself is NEVER printed: detection returns only a boolean.
 */

import {inGitHubActions} from './agent-env.js';
import {run} from './git.js';
import {AGENT_SPAWNING_VERBS, type Phase} from './phase.js';

/**
 * Agent-spawning verbs this warning deliberately skips. `verify` is in
 * {@link AGENT_SPAWNING_VERBS} because it runs repository code, but it launches
 * no agent, and the generated `verify.yml` persists only a `contents: read`
 * credential. Warning there would flag every private consumer's PR check, and
 * the planned refusal would break it. Task `ci-split-generate-workflows` (the
 * workflow guard) must apply the same exemption.
 */
export const SINGLE_JOB_WARNING_EXEMPT_VERBS: ReadonlySet<string> = new Set([
	'verify',
]);

/** An HTTP(S) URL carrying userinfo (`https://user:token@host/...`). */
const URL_WITH_USERINFO = /https?:\/\/[^/@\s]+@/i;

/** An `http.extraheader` / `http.<url>.extraheader` key. */
const EXTRAHEADER_KEY = /^http\.(?:.*\.)?extraheader$/i;

/**
 * Does this `git config --null --list` output hold a credential: a non-empty
 * `http.*.extraheader`, or any value that is an HTTP(S) URL with userinfo?
 * Returns a boolean only, so no caller can print the secret by accident.
 */
export function gitConfigListHoldsCredential(nullList: string): boolean {
	for (const entry of nullList.split('\0')) {
		if (entry === '') {
			continue;
		}
		const newline = entry.indexOf('\n');
		const key = newline === -1 ? entry : entry.slice(0, newline);
		const value = newline === -1 ? '' : entry.slice(newline + 1);
		if (EXTRAHEADER_KEY.test(key) && value.trim() !== '') {
			return true;
		}
		if (URL_WITH_USERINFO.test(value)) {
			return true;
		}
	}
	return false;
}

/**
 * Does the checkout at `cwd` persist a credential in its LOCAL git config
 * (`.git/config` and the files it includes: `actions/checkout` v6+ writes the
 * header to a separate file pulled in by an `includeIf`)? Global, system and
 * environment (`GIT_CONFIG_*`) config are not read: the agent phase hands its
 * read token to dorfl's git through the environment, which is not a persisted
 * credential. Any failure (not a repository, no git) answers `false`: the
 * warning never breaks a run.
 */
export function checkoutPersistsCredential(cwd: string): boolean {
	try {
		const result = run(
			'git',
			['config', '--local', '--includes', '--null', '--list'],
			cwd,
		);
		return result.status === 0 && gitConfigListHoldsCredential(result.stdout);
	} catch {
		return false;
	}
}

/** The warning text (never contains the credential). */
export function singleJobWarningText(verb: string): string {
	return [
		'',
		'!! WARNING: unsafe single-job CI workflow',
		`!! 'dorfl ${verb}' is running in GitHub Actions without --phase, in a checkout`,
		'!! whose git config persists a credential. Any agent this run launches can read',
		'!! and use that token. Re-run `dorfl install-ci` to upgrade to the split',
		'!! lock / agent / apply workflow, where the agent job holds no write token.',
		'!! The next minor version of dorfl will REFUSE to run in this shape.',
		'',
	].join('\n');
}

/** Inputs to {@link singleJobWarning}. */
export interface SingleJobWarningInput {
	/** The top-level CLI verb that is about to run. */
	verb: string;
	/** Its `--phase`, or `undefined` when none was given. */
	phase: Phase | undefined;
	env: NodeJS.ProcessEnv;
	/** The checkout to inspect. */
	cwd: string;
	/** Injectable credential probe (default {@link checkoutPersistsCredential}). */
	persistsCredential?: (cwd: string) => boolean;
}

/**
 * The warning to print for this invocation, or `undefined` when the shape is
 * safe (a `--phase` run, not in GitHub Actions, a verb that spawns no agent or
 * is exempt, or no persisted credential). The git config is read last, only
 * when every cheap condition already says "unsafe".
 */
export function singleJobWarning(
	input: SingleJobWarningInput,
): string | undefined {
	const {verb, phase, env, cwd} = input;
	if (phase !== undefined) {
		return undefined;
	}
	if (!AGENT_SPAWNING_VERBS.has(verb)) {
		return undefined;
	}
	if (SINGLE_JOB_WARNING_EXEMPT_VERBS.has(verb)) {
		return undefined;
	}
	if (!inGitHubActions(env)) {
		return undefined;
	}
	const probe = input.persistsCredential ?? checkoutPersistsCredential;
	return probe(cwd) ? singleJobWarningText(verb) : undefined;
}
