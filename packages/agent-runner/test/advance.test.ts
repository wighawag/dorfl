import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureFolderRel} from './helpers/gitRepo.js';
import {currentLedgerRead} from '../src/ledger-read.js';
import {
	performAdvance,
	readItemSignals,
	type RungExecutor,
	type RungExecInput,
	type RungExecResult,
	type ItemSignals,
} from '../src/advance.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';
import {newSidecar, serialiseSidecar} from '../src/sidecar.js';

/**
 * `advance-verb-resolver` slice (PRD `advance-loop`, US #1/5/6/18). The
 * classify → lock → execute SKELETON: assert the ORDER (classify is free,
 * read-only; the lock is taken BEFORE the executor; a CAS loser never reaches the
 * executor), the obs/prd/bare resolution flows through, and the build/slice rungs
 * ORCHESTRATE `do`/`do prd:` (never re-implement them). The rung BODIES + drivers
 * are later slices; this pins the seam.
 */

let root: string;

function repoPath(): string {
	return join(root, 'repo');
}

/** Seed one `work/<folder>/<file>` with frontmatter. */
function writeItem(
	folder: string,
	file: string,
	frontmatter: Record<string, string>,
): void {
	const dir = join(repoPath(), 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	writeFileSync(join(dir, file), lines.join('\n'));
}

/** A trace-recording rung executor: every call appends its rung + item. */
function spyExecutor(): {executor: RungExecutor; calls: string[]} {
	const calls: string[] = [];
	const record =
		(rung: string) =>
		async (input: RungExecInput): Promise<RungExecResult> => {
			calls.push(`${rung}:${input.item}`);
			return {exitCode: 0, outcome: 'advanced', message: `${rung} ran`};
		};
	return {
		calls,
		executor: {
			buildSlice: record('build-slice'),
			slicePrd: record('slice-prd'),
			triageObservation: record('triage-observation'),
			surface: record('surface'),
			apply: record('apply'),
		},
	};
}

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const LOST: AcquireAdvancingLockResult = {
	exitCode: 2,
	outcome: 'lost',
	message: 'someone holds the borrow',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-advance-'));
	mkdirSync(repoPath(), {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('advance \u2014 the shared resolver (obs:/prd:/bare, not a do subcommand)', () => {
	it('resolves a bare slug to the SLICE build-slice rung', async () => {
		const {executor, calls} = spyExecutor();
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: undefined, sidecar: undefined}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			read: currentLedgerRead,
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('build-slice');
		expect(result.slug).toBe('feature');
		expect(calls).toEqual(['build-slice:task:feature']);
	});

	it('resolves prd:<slug> to the slice-prd rung', async () => {
		const {executor, calls} = spyExecutor();
		const result = await performAdvance({
			arg: 'brief:autoslice',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: undefined, sidecar: undefined}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.rung).toBe('slice-prd');
		expect(calls).toEqual(['slice-prd:brief:autoslice']);
	});

	it('resolves obs:<slug> (the NEW namespace) to the triage-observation rung', async () => {
		const {executor, calls} = spyExecutor();
		const result = await performAdvance({
			arg: 'obs:stray-note',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: undefined, sidecar: undefined}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.rung).toBe('triage-observation');
		expect(calls).toEqual(['triage-observation:observation:stray-note']);
	});

	it('a bare-slug slice/PRD COLLISION is a loud usage error (resolver cross-check preserved)', async () => {
		writeItem('backlog', 'auto-slice.md', {slug: 'auto-slice'});
		writeItem('prd', 'auto-slice.md', {slug: 'auto-slice'});
		const {executor, calls} = spyExecutor();
		const result = await performAdvance({
			arg: 'auto-slice',
			cwd: repoPath(),
			executor,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			read: currentLedgerRead,
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toContain('ambiguous');
		// Never classified / locked / executed.
		expect(calls).toEqual([]);
	});
});

describe('advance \u2014 classify \u2192 lock \u2192 execute ORDER (the skeleton invariant)', () => {
	it('classifies (free), THEN locks, THEN dispatches winner-only \u2014 in that order', async () => {
		const order: string[] = [];
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			readSignals: () => {
				order.push('classify');
				return {needsAnswers: undefined, sidecar: undefined};
			},
			acquireLock: async () => {
				order.push('lock');
				return ACQUIRED;
			},
			releaseLock: async () => {
				order.push('release');
				return RELEASED;
			},
			executor: {
				buildSlice: async () => {
					order.push('execute');
					return {exitCode: 0, outcome: 'advanced', message: 'built'};
				},
				slicePrd: async () => ({
					exitCode: 0,
					outcome: 'advanced',
					message: '',
				}),
				triageObservation: async () => ({
					exitCode: 0,
					outcome: 'advanced',
					message: '',
				}),
				surface: async () => ({exitCode: 0, outcome: 'advanced', message: ''}),
				apply: async () => ({exitCode: 0, outcome: 'advanced', message: ''}),
			},
		});
		expect(result.exitCode).toBe(0);
		// classify is FREE and FIRST; the lock is taken before the executor; release
		// always runs after (the borrow is short).
		expect(order).toEqual(['classify', 'lock', 'execute', 'release']);
	});

	it('a CAS LOSER backs off having spent ONLY the free classification (never reaches the executor)', async () => {
		const {executor, calls} = spyExecutor();
		let released = false;
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: undefined, sidecar: undefined}),
			acquireLock: async () => LOST,
			releaseLock: async () => {
				released = true;
				return RELEASED;
			},
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(result.rung).toBe('build-slice'); // it DID classify (free)
		expect(calls).toEqual([]); // but never executed
		expect(released).toBe(false); // and never took/held the lock, so no release
	});

	it('a PENDING sidecar is a clean NO-OP that NEVER takes the lock (a run daemon must not spin hot)', async () => {
		let locked = false;
		const {executor, calls} = spyExecutor();
		const pending = newSidecar('task:feature', [{question: 'open?'}]);
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: true, sidecar: pending}),
			acquireLock: async () => {
				locked = true;
				return ACQUIRED;
			},
			releaseLock: async () => RELEASED,
		});
		expect(result.outcome).toBe('no-op');
		expect(result.exitCode).toBe(0);
		expect(locked).toBe(false);
		expect(calls).toEqual([]);
	});

	it('an ALL-ANSWERED sidecar locks + dispatches the apply rung', async () => {
		const {executor, calls} = spyExecutor();
		let model = newSidecar('task:feature', [{question: 'q?'}]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'yes'})),
		};
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: true, sidecar: model}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.rung).toBe('apply');
		expect(calls).toEqual(['apply:task:feature']);
	});

	it('a needsAnswers/sidecar invariant violation REFUSES (no lock, no execute)', async () => {
		const {executor, calls} = spyExecutor();
		let locked = false;
		// sidecar present but needsAnswers NOT true ⇒ invariant 1 broken.
		const orphan = newSidecar('task:feature', [{question: 'q?'}]);
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			executor,
			readSignals: () => ({needsAnswers: undefined, sidecar: orphan}),
			acquireLock: async () => {
				locked = true;
				return ACQUIRED;
			},
			releaseLock: async () => RELEASED,
		});
		expect(result.outcome).toBe('invariant-violation');
		expect(result.exitCode).toBe(1);
		expect(locked).toBe(false);
		expect(calls).toEqual([]);
	});
});

describe('advance \u2014 the single-item tick requires a named item (the bare form is the driver)', () => {
	it('errors CLEARLY on an empty arg (the eligible-SET form is the one-shot driver, not the tick)', async () => {
		// The bare/eligible-SET form is now `performAdvanceAuto`'s job (it selects over
		// the pool + runs THIS tick per item). The single-item tick itself REQUIRES a
		// named item, so an empty arg here is a clear usage error.
		const result = await performAdvance({cwd: repoPath()});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toContain('one-shot driver');
	});
});

describe('advance \u2014 build/slice rungs ORCHESTRATE do (no duplication)', () => {
	it('the default executor needs `do` options threaded \u2014 it ORCHESTRATES performDo, not a re-impl', async () => {
		// With NO doOptions threaded (the driver slice wires them), the default
		// executor reports it WOULD orchestrate `do <item>` \u2014 proving the build path
		// is `performDo`, named not re-implemented. (Running `performDo` for real
		// needs a full arbiter pipeline; the CLI threads the options.)
		const result = await performAdvance({
			arg: 'feature',
			cwd: repoPath(),
			readSignals: () => ({needsAnswers: undefined, sidecar: undefined}),
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			read: currentLedgerRead,
		});
		expect(result.rung).toBe('build-slice');
		expect(result.message).toContain('ORCHESTRATE `do task:feature`');
	});
});

describe('readItemSignals \u2014 reads the two signals off disk (read-only)', () => {
	it('reads needsAnswers from the item body + parses the active sidecar', () => {
		writeItem('backlog', 'feature.md', {slug: 'feature', needsAnswers: 'true'});
		const sidecar = newSidecar('task:feature', [{question: 'q?'}]);
		const qdir = join(repoPath(), 'work', 'questions');
		mkdirSync(qdir, {recursive: true});
		// Write the sidecar at its identity-derived path.
		writeFileSync(join(qdir, 'task-feature.md'), serialiseSidecar(sidecar));

		const signals: ItemSignals = readItemSignals({
			repoPath: repoPath(),
			type: 'task',
			slug: 'feature',
			item: 'task:feature',
		});
		expect(signals.needsAnswers).toBe(true);
		expect(signals.sidecar?.entries).toHaveLength(1);
	});

	it('reports needsAnswers:undefined + no sidecar for an item with neither', () => {
		const signals = readItemSignals({
			repoPath: repoPath(),
			type: 'task',
			slug: 'ghost',
			item: 'task:ghost',
		});
		expect(signals.needsAnswers).toBeUndefined();
		expect(signals.sidecar).toBeUndefined();
	});
});
