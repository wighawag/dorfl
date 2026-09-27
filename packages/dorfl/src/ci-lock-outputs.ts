/**
 * **The lock job's `$GITHUB_OUTPUT` facts** (spec
 * `ci-agent-job-without-write-token`).
 *
 * The lock job's outputs are the apply job's TRUSTED channel
 * (`needs.lock.outputs.*`): they choose refs, rungs and artifact names. So the
 * serializer emits only values that cannot carry attacker text: commit ids,
 * enums, booleans, bounded integers (the agent timeout, comment ids) and the
 * dorfl-derived artifact name. Every key is known here with its type, and every
 * value is re-checked at runtime (a TypeScript type does not stop a string read
 * from an issue), so free text such as an issue title is REFUSED, never
 * escaped.
 */

import type {IntegrationMode} from './config.js';
import {
	HANDOFF_NAME_RE,
	HANDOFF_RUNGS,
	type HandoffRung,
} from './ci-handoff-format.js';

/** The facts a lock job publishes (task `ci-split-generate-workflows` lists them). */
export interface LockOutputs {
	/** Whether the lock job took the item's locks. */
	acquired?: boolean;
	/** `false` when the rung runs no agent (decision 11). */
	needsAgent?: boolean;
	/** The classified rung. */
	rung?: HandoffRung;
	/** The arbiter's `main` tip the item was classified against. */
	baseSha?: string;
	/** The lock ref's sha after the acquire. */
	lockSha?: string;
	/** The kept work branch's tip, when one exists (decision 7). */
	continueTip?: string;
	/** The artifact name (`handoffName`). */
	handoffName?: string;
	/** The agent job's timeout, from `dorfl.json` at `baseSha`. */
	agentTimeoutMinutes?: number;
	/** The intake origin trust. */
	originTrust?: 'trusted' | 'untrusted';
	/** The intake document mode. */
	documentMode?: IntegrationMode;
	/** The issue comment ids the lock job read (intake). */
	seenCommentIds?: number[];
}

/** A lock output the serializer will not emit. */
export class LockOutputRefused extends Error {
	constructor(message: string) {
		super(`lock output refused: ${message}`);
		this.name = 'LockOutputRefused';
	}
}

/** The largest agent timeout accepted (GitHub's self-hosted job maximum: 5 days). */
export const MAX_AGENT_TIMEOUT_MINUTES = 7200;
/** The most comment ids one output may list. */
export const MAX_SEEN_COMMENT_IDS = 5000;

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function refuse(key: string, why: string): never {
	throw new LockOutputRefused(`${key} ${why}`);
}

function boolean(key: string, v: unknown): string {
	if (typeof v !== 'boolean') refuse(key, 'is not a boolean');
	return String(v);
}
function sha(key: string, v: unknown): string {
	if (typeof v !== 'string' || !SHA_RE.test(v)) {
		refuse(key, 'is not a full lower-case commit id');
	}
	return v;
}
function oneOf(values: readonly string[]) {
	return (key: string, v: unknown): string => {
		if (typeof v !== 'string' || !values.includes(v)) {
			refuse(key, `is not one of ${values.join(', ')}`);
		}
		return v;
	};
}
function integer(min: number, max: number) {
	return (key: string, v: unknown): string => {
		if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
			refuse(key, `is not an integer in ${min}..${max}`);
		}
		return String(v);
	};
}

/** Every key, in output order, with its value check. */
const SCHEMA: Record<keyof LockOutputs, (key: string, v: unknown) => string> = {
	acquired: boolean,
	needsAgent: boolean,
	rung: oneOf(HANDOFF_RUNGS),
	baseSha: sha,
	lockSha: sha,
	continueTip: sha,
	handoffName: (key, v) => {
		if (typeof v !== 'string' || !HANDOFF_NAME_RE.test(v)) {
			refuse(key, 'is not a dorfl handoff artifact name');
		}
		return v;
	},
	agentTimeoutMinutes: integer(1, MAX_AGENT_TIMEOUT_MINUTES),
	originTrust: oneOf(['trusted', 'untrusted']),
	documentMode: oneOf(['propose', 'merge']),
	seenCommentIds: (key, v) => {
		if (!Array.isArray(v) || v.length > MAX_SEEN_COMMENT_IDS) {
			refuse(key, `is not a list of at most ${MAX_SEEN_COMMENT_IDS} ids`);
		}
		const check = integer(1, Number.MAX_SAFE_INTEGER);
		return v.map((id) => check(key, id)).join(',');
	},
};

/**
 * Serialize lock facts as `$GITHUB_OUTPUT` lines (`key=value\n`, in a fixed
 * order; an `undefined` fact is omitted). Throws {@link LockOutputRefused} for
 * an unknown key or any value outside its type, so free text never reaches the
 * trusted channel.
 */
export function serializeLockOutputs(facts: LockOutputs): string {
	for (const key of Object.keys(facts)) {
		if (!Object.hasOwn(SCHEMA, key)) {
			refuse(JSON.stringify(key).slice(0, 80), 'is not a lock output');
		}
	}
	let out = '';
	for (const [key, check] of Object.entries(SCHEMA)) {
		const v = (facts as Record<string, unknown>)[key];
		if (v === undefined) continue;
		out += `${key}=${check(key, v)}\n`;
	}
	return out;
}
