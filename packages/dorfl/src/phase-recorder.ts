import {ledgerWrite} from './ledger-write.js';
import {refWrite} from './ref-write.js';
import type {ReviewProvider} from './integrator.js';
import type {IssueProvider} from './issue-provider.js';
import {enterPhase, type Phase} from './phase.js';

/**
 * **Record at the seams, resume at the boundary** (spec
 * `ci-agent-job-without-write-token` §4, task `ci-split-phase-mode-and-guards`).
 *
 * In the `agent` phase the job token cannot write, and dorfl must not try: every
 * write seam is replaced by a RECORDING implementation. The first post-agent
 * write call the recorder KNOWS captures its intent (seam, method, input) and
 * halts the pipeline with a {@link PhaseHaltSentinel}, which the phase driver
 * ({@link runAgentPhase}) catches. Nothing after the first write runs in the
 * agent phase, so no agent-phase step ever depends on a write RESULT (a PR URL,
 * `mergeNonFastForward`, `publishedHead`, a CAS rejection).
 *
 * A write seam call the recorder does NOT know throws
 * {@link UnrecordedWriteError}: an unrouted write is a bug the tests catch.
 *
 * The write seams covered here are every seam a CI path writes through
 * (task `ci-split-route-direct-writes-through-seams`): `ledgerWrite` (which also
 * reaches the integrator, via `applyCompleteTransition`), `refWrite`, the review
 * provider and the issue provider (whose READS pass through). Which seam calls
 * each path records, and how the captured input maps to a handoff intent kind
 * (`ci-handoff-format.ts`), is decided by the per-path split tasks; this module
 * is the shared machinery.
 *
 * The captured `input` is the seam's in-memory argument, which may hold an env
 * with credentials: it is NEVER serialised as-is. The per-path code builds the
 * handoff record from it field by field.
 */

/** The write seams a CI path reaches (the recorder replaces all of them). */
export type WriteSeamName =
	| 'ledgerWrite'
	| 'refWrite'
	| 'reviewProvider'
	| 'issueProvider';

/** A seam call id: `<seam>.<method>`, e.g. `refWrite.pushContinuedBranch`. */
export type WriteSeamCall = `${WriteSeamName}.${string}`;

/** The captured intent of the first recorded write. */
export interface RecordedWriteIntent {
	/** The seam the write went through. */
	seam: WriteSeamName;
	/** The seam method called. */
	method: string;
	/** The call's argument, in memory only (see the module comment). */
	input: unknown;
}

/**
 * Thrown by a recording seam on the first recorded write: it halts the
 * pipeline so nothing after the boundary runs. The phase driver catches it; it
 * is never a failure.
 */
export class PhaseHaltSentinel extends Error {
	override readonly name = 'PhaseHaltSentinel';
	constructor(readonly intent: RecordedWriteIntent) {
		super(
			`agent phase halted at the first write (${intent.seam}.${intent.method}); ` +
				'the apply phase performs it.',
		);
	}
}

/**
 * A write seam call the recorder does not know, in the agent phase. Always a
 * dorfl bug: the write is not routed through the phase split.
 */
export class UnrecordedWriteError extends Error {
	override readonly name = 'UnrecordedWriteError';
	constructor(
		readonly seam: WriteSeamName,
		readonly method: string,
	) {
		super(
			`agent phase: unrecorded write ${seam}.${method} (the agent job holds a ` +
				'read-only token, and this write is not routed to the apply phase). ' +
				'This is a dorfl bug in the phase split.',
		);
	}
}

/** The recording state one agent-phase run shares across every seam. */
export interface PhaseRecorder {
	/** The seam calls this recorder captures (every other write throws). */
	readonly recordable: ReadonlySet<WriteSeamCall>;
	/** The first recorded write, once the pipeline has reached it. */
	captured(): RecordedWriteIntent | undefined;
	/** The first unrecorded write, if the pipeline made one. */
	violation(): UnrecordedWriteError | undefined;
	/**
	 * Handle one write seam call: always throws. The first recorded call
	 * captures its intent and throws a {@link PhaseHaltSentinel}; any later write
	 * re-throws that same sentinel (nothing after the boundary may write). An
	 * unknown call throws (and remembers) an {@link UnrecordedWriteError}.
	 */
	write(seam: WriteSeamName, method: string, input: unknown): never;
}

/** Create a {@link PhaseRecorder} that captures exactly the `record` calls. */
export function createPhaseRecorder(options: {
	record: Iterable<WriteSeamCall>;
}): PhaseRecorder {
	const recordable = new Set<WriteSeamCall>(options.record);
	let sentinel: PhaseHaltSentinel | undefined;
	let violation: UnrecordedWriteError | undefined;
	return {
		recordable,
		captured: () => sentinel?.intent,
		violation: () => violation,
		write(seam, method, input): never {
			if (violation !== undefined) {
				throw violation;
			}
			if (sentinel !== undefined) {
				throw sentinel;
			}
			if (!recordable.has(`${seam}.${method}`)) {
				violation = new UnrecordedWriteError(seam, method);
				throw violation;
			}
			sentinel = new PhaseHaltSentinel({seam, method, input});
			throw sentinel;
		},
	};
}

/**
 * Replace EVERY method of the process-wide `ledgerWrite` and `refWrite` seams
 * with a recording one, and return a function restoring the originals. Every
 * method is enumerated from the seam object, so a seam method added later is
 * covered (as an unrecorded write) without touching this function.
 */
export function installRecordingSeams(recorder: PhaseRecorder): () => void {
	const restores = [
		swapMethods('ledgerWrite', ledgerWrite, recorder),
		swapMethods('refWrite', refWrite, recorder),
	];
	return () => {
		for (const restore of restores.reverse()) {
			restore();
		}
	};
}

function swapMethods(
	seam: WriteSeamName,
	target: object,
	recorder: PhaseRecorder,
): () => void {
	const record = target as Record<string, unknown>;
	const originals = new Map<string, unknown>();
	for (const [method, value] of Object.entries(record)) {
		if (typeof value !== 'function') {
			continue;
		}
		originals.set(method, value);
		record[method] = (input: unknown) => recorder.write(seam, method, input);
	}
	return () => {
		for (const [method, value] of originals) {
			record[method] = value;
		}
	};
}

/**
 * A recording {@link ReviewProvider}: every method is a write, so every call
 * goes to the recorder. `name` is the wrapped provider's.
 */
export function recordingReviewProvider(
	inner: ReviewProvider,
	recorder: PhaseRecorder,
): ReviewProvider {
	const seam: WriteSeamName = 'reviewProvider';
	return {
		name: inner.name,
		openRequest: (input) => recorder.write(seam, 'openRequest', input),
		postPRComment: (input) => recorder.write(seam, 'postPRComment', input),
		postPRCommentOnBranch: (input) =>
			recorder.write(seam, 'postPRCommentOnBranch', input),
		closeRequestOnBranch: (input) =>
			recorder.write(seam, 'closeRequestOnBranch', input),
	};
}

/**
 * A recording {@link IssueProvider}: the reads (`getIssue`, `listComments`,
 * `getLabels`) pass through to `inner` (the agent job's read token serves
 * them); every write goes to the recorder.
 */
export function recordingIssueProvider(
	inner: IssueProvider,
	recorder: PhaseRecorder,
): IssueProvider {
	const seam: WriteSeamName = 'issueProvider';
	return {
		name: inner.name,
		getIssue: (input) => inner.getIssue(input),
		listComments: (input) => inner.listComments(input),
		getLabels: (input) => inner.getLabels(input),
		postIssueComment: (input) =>
			recorder.write(seam, 'postIssueComment', input),
		addLabel: (input) => recorder.write(seam, 'addLabel', input),
		removeLabel: (input) => recorder.write(seam, 'removeLabel', input),
		closeIssue: (input) => recorder.write(seam, 'closeIssue', input),
	};
}

/** The outcome of one {@link runAgentPhase}. */
export type AgentPhaseOutcome<T> =
	| {
			/** The pipeline finished without reaching a write. */
			halted: false;
			result: T;
	  }
	| {
			/** The pipeline reached its first write and stopped there. */
			halted: true;
			/** The captured first write. */
			intent: RecordedWriteIntent;
			/**
			 * True when the pipeline CAUGHT the sentinel and returned normally
			 * instead of letting it propagate. The intent still stands (the recorder
			 * is authoritative); the flag lets the per-path tasks assert their
			 * pipeline stops cleanly at the boundary.
			 */
			sentinelSwallowed: boolean;
	  };

/**
 * The agent-phase driver: run `pipeline` in the `agent` phase with every write
 * seam recording (the process-wide `ledgerWrite` / `refWrite`; the pipeline
 * wraps its injected providers with {@link recordingReviewProvider} /
 * {@link recordingIssueProvider} on the same `recorder`), catch the
 * {@link PhaseHaltSentinel}, and restore the seams and the previous phase.
 *
 * The recorder, not the exception, is authoritative: a pipeline that swallows
 * the sentinel in a broad `catch` is still reported as halted at the captured
 * intent, and an {@link UnrecordedWriteError} is re-thrown even if the pipeline
 * swallowed it.
 */
export async function runAgentPhase<T>(
	recorder: PhaseRecorder,
	pipeline: () => Promise<T>,
): Promise<AgentPhaseOutcome<T>> {
	const restorePhase = enterPhase('agent');
	const restoreSeams = installRecordingSeams(recorder);
	let result: T | undefined;
	let caught: unknown;
	let threw = false;
	try {
		result = await pipeline();
	} catch (err) {
		threw = true;
		caught = err;
	} finally {
		restoreSeams();
		restorePhase();
	}
	const violation = recorder.violation();
	if (violation !== undefined) {
		throw violation;
	}
	const intent = recorder.captured();
	if (intent !== undefined) {
		if (threw && !(caught instanceof PhaseHaltSentinel)) {
			throw caught;
		}
		return {halted: true, intent, sentinelSwallowed: !threw};
	}
	if (threw) {
		throw caught;
	}
	return {halted: false, result: result as T};
}

/**
 * Enter `phase` for the whole (one-shot) CLI process, the `--phase` entry
 * point: the phase guards fire from here on, and in the `agent` phase every
 * process-wide write seam records into a recorder that knows NO write, so any
 * write that is not inside a per-path {@link runAgentPhase} (which installs its
 * own recorder on top) throws {@link UnrecordedWriteError}. Returns a function
 * restoring the previous state (tests; the CLI process simply exits).
 */
export function activateProcessPhase(phase: Phase): () => void {
	const restorePhase = enterPhase(phase);
	const restoreSeams =
		phase === 'agent'
			? installRecordingSeams(createPhaseRecorder({record: []}))
			: () => {};
	return () => {
		restoreSeams();
		restorePhase();
	};
}
