import {afterEach, describe, expect, it} from 'vitest';
import {ledgerWrite, currentLedgerWrite} from '../src/ledger-write.js';
import {refWrite, currentRefWrite} from '../src/ref-write.js';
import type {ReviewProvider} from '../src/integrator.js';
import type {IssueProvider} from '../src/issue-provider.js';
import {activePhase} from '../src/phase.js';
import {
	PhaseHaltSentinel,
	UnrecordedWriteError,
	activateProcessPhase,
	annotatePhaseBoundary,
	createPhaseRecorder,
	installRecordingSeams,
	recordingIssueProvider,
	recordingReviewProvider,
	runAgentPhase,
} from '../src/phase-recorder.js';

/**
 * The agent-phase recording machinery (task `ci-split-phase-mode-and-guards`),
 * exercised with a TOY pipeline: agent-ish local work, then the first write.
 * The first write the recorder knows captures its intent and halts the
 * pipeline; a write it does not know throws; the seams are restored after.
 */

const refWriteOriginals = {...refWrite};
const ledgerWriteOriginals = {...ledgerWrite};

afterEach(() => {
	// Every test must leave the process-wide seams as it found them.
	expect({...refWrite}).toEqual(refWriteOriginals);
	expect({...ledgerWrite}).toEqual(ledgerWriteOriginals);
	expect(activePhase()).toBeUndefined();
});

const lockInput = {
	arbiter: 'origin',
	ref: 'refs/dorfl/lock/task/x',
	expectedSha: 'a'.repeat(40),
	cwd: '/nowhere',
	env: undefined,
};

function fakeIssueProvider(log: string[]): IssueProvider {
	const no = (what: string) => () => {
		throw new Error(`the recording provider must not call ${what}`);
	};
	return {
		name: 'fake',
		getIssue: async ({issueNumber}) => {
			log.push(`getIssue ${issueNumber}`);
			return {number: issueNumber, title: 't', body: 'b'} as never;
		},
		listComments: async () => {
			log.push('listComments');
			return [];
		},
		getLabels: async () => {
			log.push('getLabels');
			return {labels: []} as never;
		},
		postIssueComment: no('postIssueComment'),
		addLabel: no('addLabel'),
		removeLabel: no('removeLabel'),
		closeIssue: no('closeIssue'),
	};
}

describe('runAgentPhase with a toy pipeline', () => {
	it('halts at the first recorded write with its captured intent; nothing after runs', async () => {
		const steps: string[] = [];
		const recorder = createPhaseRecorder({
			record: ['refWrite.deleteLockRef'],
		});
		const outcome = await runAgentPhase(recorder, async () => {
			expect(activePhase()).toBe('agent');
			steps.push('agent ran');
			steps.push('local commit');
			await refWrite.deleteLockRef(lockInput);
			steps.push('after the write');
			return 'finished';
		});
		expect(outcome).toEqual({
			halted: true,
			intent: {seam: 'refWrite', method: 'deleteLockRef', input: lockInput},
			sentinelSwallowed: false,
		});
		expect(steps).toEqual(['agent ran', 'local commit']);
	});

	it('the first write captures the latest boundary annotation; annotating outside a phase is a no-op', async () => {
		annotatePhaseBoundary({kind: 'ignored'});
		const recorder = createPhaseRecorder({
			record: ['refWrite.deleteLockRef'],
		});
		const outcome = await runAgentPhase(recorder, async () => {
			annotatePhaseBoundary({kind: 'first'});
			annotatePhaseBoundary({kind: 'stop', reason: 'drifted'});
			await refWrite.deleteLockRef(lockInput);
		});
		expect(outcome).toMatchObject({
			halted: true,
			intent: {
				seam: 'refWrite',
				method: 'deleteLockRef',
				annotation: {kind: 'stop', reason: 'drifted'},
			},
		});
		// Restored: a later annotation reaches no recorder.
		annotatePhaseBoundary({kind: 'late'});
		expect(recorder.captured()?.annotation).toEqual({
			kind: 'stop',
			reason: 'drifted',
		});
	});

	it('finishes normally when the pipeline reaches no write', async () => {
		const recorder = createPhaseRecorder({record: ['refWrite.deleteLockRef']});
		const outcome = await runAgentPhase(recorder, async () => 42);
		expect(outcome).toEqual({halted: false, result: 42});
	});

	it('a write seam call the recorder does not know throws UnrecordedWriteError', async () => {
		const recorder = createPhaseRecorder({record: ['refWrite.deleteLockRef']});
		await expect(
			runAgentPhase(recorder, async () => {
				await ledgerWrite.applyTransition({} as never);
			}),
		).rejects.toBeInstanceOf(UnrecordedWriteError);
		expect(recorder.violation()).toMatchObject({
			seam: 'ledgerWrite',
			method: 'applyTransition',
		});
	});

	it('an unrecorded write is re-thrown even when the pipeline swallows it', async () => {
		const recorder = createPhaseRecorder({record: []});
		await expect(
			runAgentPhase(recorder, async () => {
				try {
					await refWrite.publishTreelessResult({} as never);
				} catch {
					// a broad catch in the pipeline must not hide the bug
				}
				return 'done';
			}),
		).rejects.toMatchObject({
			name: 'UnrecordedWriteError',
			method: 'publishTreelessResult',
		});
	});

	it('the captured intent stands when the pipeline swallows the sentinel, and later writes re-halt', async () => {
		const recorder = createPhaseRecorder({
			record: ['refWrite.deleteLockRef', 'refWrite.createLockRef'],
		});
		const outcome = await runAgentPhase(recorder, async () => {
			try {
				await refWrite.deleteLockRef(lockInput);
			} catch {
				// swallowed
			}
			// A second write after the boundary is refused with the SAME sentinel.
			expect(() => refWrite.createLockRef({} as never)).toThrow(
				PhaseHaltSentinel,
			);
			return 'returned';
		});
		expect(outcome).toMatchObject({
			halted: true,
			intent: {seam: 'refWrite', method: 'deleteLockRef'},
			sentinelSwallowed: true,
		});
	});

	it('records through the review and issue providers; issue reads pass through', async () => {
		const log: string[] = [];
		const recorder = createPhaseRecorder({
			record: ['issueProvider.postIssueComment'],
		});
		const issues = recordingIssueProvider(fakeIssueProvider(log), recorder);
		const outcome = await runAgentPhase(recorder, async () => {
			await issues.getIssue({issueNumber: 7} as never);
			await issues.listComments({issueNumber: 7} as never);
			await issues.getLabels({issueNumber: 7} as never);
			await issues.postIssueComment({issueNumber: 7, body: 'hi'} as never);
		});
		expect(log).toEqual(['getIssue 7', 'listComments', 'getLabels']);
		expect(outcome).toMatchObject({
			halted: true,
			intent: {
				seam: 'issueProvider',
				method: 'postIssueComment',
				input: {issueNumber: 7, body: 'hi'},
			},
		});

		const review = recordingReviewProvider(
			{name: 'github'} as ReviewProvider,
			createPhaseRecorder({record: []}),
		);
		expect(review.name).toBe('github');
		expect(() => review.postPRComment({} as never)).toThrow(
			UnrecordedWriteError,
		);
	});

	it('a non-sentinel error from the pipeline propagates', async () => {
		const recorder = createPhaseRecorder({record: []});
		await expect(
			runAgentPhase(recorder, async () => {
				throw new Error('agent crashed');
			}),
		).rejects.toThrow('agent crashed');
	});
});

describe('installRecordingSeams', () => {
	it('replaces EVERY ledgerWrite and refWrite method, then restores the originals', () => {
		const restore = installRecordingSeams(createPhaseRecorder({record: []}));
		try {
			for (const method of Object.keys(currentRefWrite)) {
				expect(
					() => (refWrite as unknown as Record<string, () => void>)[method]!(),
					method,
				).toThrow(UnrecordedWriteError);
			}
			for (const method of Object.keys(currentLedgerWrite)) {
				expect(
					() =>
						(ledgerWrite as unknown as Record<string, () => void>)[method]!(),
					method,
				).toThrow(UnrecordedWriteError);
			}
		} finally {
			restore();
		}
	});
});

describe('activateProcessPhase', () => {
	it('in the agent phase every write seam call throws until restored', () => {
		const restore = activateProcessPhase('agent');
		try {
			expect(activePhase()).toBe('agent');
			expect(() => refWrite.createLockRef({} as never)).toThrow(
				UnrecordedWriteError,
			);
		} finally {
			restore();
		}
	});

	it('in the lock and apply phases the write seams stay live', () => {
		for (const phase of ['lock', 'apply'] as const) {
			const restore = activateProcessPhase(phase);
			try {
				expect(activePhase()).toBe(phase);
				expect(refWrite.createLockRef).toBe(currentRefWrite.createLockRef);
			} finally {
				restore();
			}
		}
	});
});
