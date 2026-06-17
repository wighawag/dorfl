import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
	listAdvancingMarkers,
	advancingMarkerPath,
} from '../src/advancing-lock.js';
import {sweepLedgerDuplicates, formatLedgerSweep} from '../src/ledger-lint.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Regression for `advancing-lock-human-release-verb-and-surface` (PRD
 * `recover-autodetect-and-advancing-lock-crash-safety` Defect C, stories 5+6).
 *
 * Two coupled invariants the slice ships:
 *
 *   1. A stuck `work/advancing/<entry>.md` marker is CLEARABLE by a HUMAN-named
 *      verb (`agent-runner release-advancing <item>`), routed through the SAME
 *      crash-safe `releaseAdvancingLock` + `advancingMarkerPath(entry)` seam the
 *      blocker slice (`advancing-lock-release-crash-safe`) introduced. Never
 *      `--force`. Idempotent (a re-run on an already-cleared lock is exit-0
 *      "nothing to clear", NOT the acquire-path's exit-2 `lost`).
 *
 *   2. A stuck marker is DISCOVERABLE via the `gc --ledger` REPORT (never
 *      deleted), alongside the existing multi-folder-slug report. The single
 *      enumeration seam is `listAdvancingMarkers()` \u2014 the folder-taxonomy reorg
 *      will later repoint this seam without forking the format. There is NO
 *      automatic advancing-lock sweep anywhere in the system (the lock has no
 *      liveness heartbeat, so "provably orphaned" cannot be inferred safely).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advancing-human-release-');
});
afterEach(() => {
	scratch.cleanup();
});

function markerOnArbiter(repo: string, entry: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], repo, {env: gitEnv()});
	return (
		run(
			'git',
			['cat-file', '-e', `arbiter/main:${advancingMarkerPath(entry)}`],
			repo,
			{env: gitEnv()},
		).status === 0
	);
}

describe('release-advancing (named human verb) — clears a stuck marker', () => {
	it('removes a planted `work/advancing/<entry>.md` marker via releaseAdvancingLock (covers story 5)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['stuck']);
		// Plant the orphaned marker by RUNNING the normal acquire path — same shape
		// a live `advance` crash leaves behind (a `+ work/advancing/<entry>.md`
		// micro-commit on `<arbiter>/main` with no matching release commit).
		const acquired = await acquireAdvancingLock({
			item: 'slice:stuck',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		expect(markerOnArbiter(repo, 'slice-stuck')).toBe(true);

		// The human-invoked verb routes through the SAME internal release the
		// blocker slice owns \u2014 we never re-implement the crash-safe path here.
		const released = await releaseAdvancingLock({
			item: 'slice:stuck',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
		expect(released.entry).toBe('slice-stuck');
		expect(markerOnArbiter(repo, 'slice-stuck')).toBe(false);

		// The lifecycle file was NEVER moved \u2014 the borrow is a lock, not a
		// transition. Same invariant the existing release tests pin, repeated here
		// because the HUMAN's mental model is "did I lose the slice?".
		const inBacklog =
			run(
				'git',
				['cat-file', '-e', 'arbiter/main:work/backlog/stuck.md'],
				repo,
				{env: gitEnv()},
			).status === 0;
		expect(inBacklog).toBe(true);
	});

	it('is IDEMPOTENT: a re-run on an already-cleared lock is a clean no-op (the CLI maps `lost` \u2192 exit-0 "nothing to clear")', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['twice']);
		await acquireAdvancingLock({
			item: 'slice:twice',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const first = await releaseAdvancingLock({
			item: 'slice:twice',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.outcome).toBe('released');

		// The SECOND release finds the marker already absent. The library returns
		// `lost` (its "the lock must currently be held" guard \u2014 the SAME guard the
		// acquire path uses to detect a held lock). The CLI verb maps this outcome
		// to a CLEAN exit-0 "nothing to clear" so a HUMAN re-running the verb does
		// not see a confusing exit-2 (which on the acquire path means "someone
		// else holds it"). We pin the SOURCE outcome here so the CLI mapping above
		// in cli.ts has a single, named contract to read.
		const second = await releaseAdvancingLock({
			item: 'slice:twice',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.outcome).toBe('lost');
		expect(second.entry).toBe('slice-twice');
		expect(second.message).toMatch(/nothing to release/i);
		// The arbiter is unchanged \u2014 a re-run does not corrupt the ledger.
		expect(markerOnArbiter(repo, 'slice-twice')).toBe(false);
	});

	it('runs from a CLEAN checkout (no dirty-tree dependency on the blocker\u2019s crash-path scrubbing)', async () => {
		// The human runs `release-advancing` from a normal clean checkout, so the
		// blocker slice\u2019s mid-rebase abort + uncommitted-leftover scrub is NOT a
		// runtime dependency here \u2014 the `blockedBy` is same-module serialisation +
		// helper-reuse only. Acceptance criterion: the verb works on a clean tree.
		const {repo} = seedRepoWithArbiter(scratch.root, ['clean']);
		await acquireAdvancingLock({
			item: 'slice:clean',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// Sanity: the cwd checkout is clean \u2014 no rebase in flight, no leftovers.
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		const released = await releaseAdvancingLock({
			item: 'slice:clean',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(released.outcome).toBe('released');
	});
});

describe('listAdvancingMarkers — single enumeration seam', () => {
	it('lists planted `work/advancing/<entry>.md` markers, sorted (covers story 6 + reusable seam)', () => {
		const repo = join(scratch.root, 'repo-list');
		mkdirSync(join(repo, 'work', 'advancing'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'advancing', 'slice-zeta.md'),
			'---\nentry: slice-zeta\n---\n',
		);
		writeFileSync(
			join(repo, 'work', 'advancing', 'prd-alpha.md'),
			'---\nentry: prd-alpha\n---\n',
		);
		writeFileSync(
			join(repo, 'work', 'advancing', 'observation-mu.md'),
			'---\nentry: observation-mu\n---\n',
		);
		const markers = listAdvancingMarkers(repo);
		expect(markers).toEqual(['observation-mu', 'prd-alpha', 'slice-zeta']);
	});

	it('IGNORES non-marker files (README, .keep, dotfiles, non-md), so a stray file never reads as a stuck lock', () => {
		const repo = join(scratch.root, 'repo-noise');
		mkdirSync(join(repo, 'work', 'advancing'), {recursive: true});
		writeFileSync(join(repo, 'work', 'advancing', 'slice-only.md'), 'lock\n');
		writeFileSync(join(repo, 'work', 'advancing', 'README'), 'notes\n');
		writeFileSync(join(repo, 'work', 'advancing', '.keep'), '');
		writeFileSync(join(repo, 'work', 'advancing', 'notes.txt'), 'x');
		expect(listAdvancingMarkers(repo)).toEqual(['slice-only']);
	});

	it('returns [] when `work/advancing/` does not exist (a clean repo is silent)', () => {
		const repo = join(scratch.root, 'repo-empty');
		mkdirSync(repo, {recursive: true});
		expect(existsSync(join(repo, 'work', 'advancing'))).toBe(false);
		expect(listAdvancingMarkers(repo)).toEqual([]);
	});
});

describe('gc --ledger REPORTS advancing markers (never deletes them)', () => {
	it('a planted marker appears in `sweepLedgerDuplicates` + `formatLedgerSweep` with a release-advancing hint', () => {
		const repo = join(scratch.root, 'repo-report');
		mkdirSync(join(repo, 'work', 'advancing'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'advancing', 'slice-orphaned.md'),
			'---\nentry: slice-orphaned\n---\n',
		);

		const result = sweepLedgerDuplicates(repo);
		expect(result.advancingMarkers).toEqual(['slice-orphaned']);
		// Critical contract: the REPORT does NOT touch the marker \u2014 there is NO
		// automatic advancing-lock sweep / age-based reaper anywhere. The marker
		// remains on disk after the sweep.
		expect(
			existsSync(join(repo, 'work', 'advancing', 'slice-orphaned.md')),
		).toBe(true);
		expect(listAdvancingMarkers(repo)).toEqual(['slice-orphaned']);

		const formatted = formatLedgerSweep(result);
		expect(formatted).toMatch(/Advancing-lock markers/);
		expect(formatted).toMatch(/work\/advancing\/slice-orphaned\.md/);
		// The pointer to the release verb names the canonical item form (the same
		// shape `releaseAdvancingLock` and the CLI verb accept), not the raw
		// entry \u2014 so the human can copy/paste the suggestion as-is.
		expect(formatted).toMatch(/agent-runner release-advancing slice:orphaned/);
		// The suggestion explicitly REMINDS the human it is NEVER `--force` (the verb
		// has no --force flag at all). A stale lease re-fetches and retries.
		expect(formatted).toMatch(/never --force/);
	});

	it('an empty `work/advancing/` is a clean report (no advancing section)', () => {
		const repo = join(scratch.root, 'repo-clean');
		mkdirSync(repo, {recursive: true});
		const result = sweepLedgerDuplicates(repo);
		expect(result.advancingMarkers).toEqual([]);
		expect(formatLedgerSweep(result)).toBe(
			'Ledger clean: every slug is in exactly one work/ status folder.',
		);
	});

	it('NO automatic sweep exists \u2014 the report is the ONLY discoverability surface (story 6 / the PRD\u2019s explicit fence)', () => {
		// Sentinel test that documents the design fence: the advancing lock has no
		// liveness heartbeat, so we never infer "orphaned" from age or absence of
		// activity. `listAdvancingMarkers` is the read-side seam; there is NO
		// caller anywhere that REMOVES a marker based on its return value. A
		// `release-advancing` invocation (which DOES remove a marker) is human-
		// initiated by NAMING the dead lock \u2014 same trust model as `requeue`. If a
		// future PRD wants an automatic sweep, it adds a heartbeat first; this
		// sentinel must then be revisited.
		const repo = join(scratch.root, 'repo-sentinel');
		mkdirSync(join(repo, 'work', 'advancing'), {recursive: true});
		writeFileSync(
			join(repo, 'work', 'advancing', 'slice-untouched.md'),
			'lock\n',
		);
		// Running the report does NOT delete the marker.
		const before = listAdvancingMarkers(repo);
		sweepLedgerDuplicates(repo);
		const after = listAdvancingMarkers(repo);
		expect(after).toEqual(before);
	});
});
