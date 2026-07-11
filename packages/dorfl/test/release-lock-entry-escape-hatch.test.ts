import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireItemLock,
	releaseLiteralLockEntry,
	isValidLockEntryName,
	hasCurrentItemForm,
	reportItemLocks,
	formatItemLockReport,
	serialiseLockEntry,
	itemLockRef,
	LOCK_REF_PREFIX,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Regression for `release-lock-entry-escape-hatch-and-literal-entry-reporting`:
 *
 *   (b) `release-lock --entry <literal>` (via `releaseLiteralLockEntry`) clears a
 *       lock whose entry name is NOT derivable from any current item-form (a
 *       pre-vocabulary-cutover `slice-<slug>` / `prd-<slug>` prefix) by targeting
 *       `refs/dorfl/lock/<literal>` VERBATIM, through the SAME leased-delete path
 *       the item-form uses. Absent-on-origin is a recoverable no-op. An invalid
 *       literal is rejected BEFORE any git operation.
 *   (c) `gc --ledger`'s report surfaces the LITERAL entry name and, for an entry
 *       with no current item-form, a one-line `release-lock --entry <literal>` hint.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-release-lock-entry-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does the arbiter currently HOLD the per-item lock ref for `entry`? */
function lockRefOnArbiter(arbiter: string, entry: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/**
 * Plant a LITERAL lock ref (`refs/dorfl/lock/<entry>`) on the arbiter WITHOUT
 * going through `acquireItemLock` — the ONLY way to mint a PRE-CUTOVER
 * `slice-<slug>` / `prd-<slug>` entry (there is no current item-form that
 * produces those). Builds the parentless lock commit via plumbing (mirroring the
 * production acquire) and pushes it create-only.
 */
function plantLiteralLock(repo: string, arbiter: string, entry: string): void {
	const env = gitEnv();
	const body = serialiseLockEntry({
		entry,
		action: 'implement',
		state: 'active',
		holder: 'pre-cutover-holder',
		since: '2026-06-19T00:00:00.000Z',
	});
	const blob = run('git', ['hash-object', '-w', '--stdin'], repo, {
		env,
		input: body,
	}).stdout.trim();
	const tree = run('git', ['mktree'], repo, {
		env,
		input: `100644 blob ${blob}\tlock.md\n`,
	}).stdout.trim();
	const commit = run(
		'git',
		['commit-tree', tree, '-m', `lock: ${entry}`],
		repo,
		{env},
	).stdout.trim();
	const ref = `${LOCK_REF_PREFIX}/${entry}`;
	run('git', ['push', ARBITER, `${commit}:${ref}`], repo, {env});
}

describe('release-lock --entry <literal> — the escape hatch validator', () => {
	it('accepts a plausible entry-name shape (the minting character class)', () => {
		expect(isValidLockEntryName('slice-claim-cas-spinner')).toBe(true);
		expect(isValidLockEntryName('task-foo')).toBe(true);
		expect(isValidLockEntryName('prd-some_thing.v2')).toBe(true);
		expect(isValidLockEntryName('a')).toBe(true);
	});

	it('rejects anything that could escape the refs/dorfl/lock/ namespace', () => {
		// empty
		expect(isValidLockEntryName('')).toBe(false);
		// a slash would address a DIFFERENT ref path (namespace escape)
		expect(isValidLockEntryName('slice/foo')).toBe(false);
		expect(isValidLockEntryName('../heads/main')).toBe(false);
		// whitespace would break the push refspec
		expect(isValidLockEntryName('slice foo')).toBe(false);
		expect(isValidLockEntryName('slice-foo\n')).toBe(false);
		// out-of-class punctuation
		expect(isValidLockEntryName('slice:foo')).toBe(false);
		expect(isValidLockEntryName('slice~foo')).toBe(false);
	});
});

describe('hasCurrentItemForm — which entries reverse-derive to an item-form', () => {
	it('true for the current post-cutover type prefixes', () => {
		expect(hasCurrentItemForm('task-foo')).toBe(true);
		expect(hasCurrentItemForm('spec-foo')).toBe(true);
		expect(hasCurrentItemForm('observation-foo')).toBe(true);
	});
	it('false for a pre-cutover slice-/prd- entry (un-nameable via item-form)', () => {
		expect(hasCurrentItemForm('slice-claim-cas-spinner')).toBe(false);
		expect(hasCurrentItemForm('prd-old-thing')).toBe(false);
	});
});

describe('release-lock --entry — clears a LITERAL pre-cutover lock ref', () => {
	it('(i) happy path: deletes refs/dorfl/lock/<literal> via the leased-delete path', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['unused']);
		// A pre-cutover orphan the item-form path can no longer name.
		plantLiteralLock(repo, arbiter, 'slice-claim-cas-spinner');
		expect(lockRefOnArbiter(arbiter, 'slice-claim-cas-spinner')).toBe(true);

		const rel = await releaseLiteralLockEntry({
			entry: 'slice-claim-cas-spinner',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(rel.entry).toBe('slice-claim-cas-spinner');
		expect(rel.ref).toBe(`${LOCK_REF_PREFIX}/slice-claim-cas-spinner`);
		// SELF-CLEANING: the literal ref is gone.
		expect(lockRefOnArbiter(arbiter, 'slice-claim-cas-spinner')).toBe(false);
	});

	it('(ii) absent-on-origin is a recoverable no-op success (not-held), message names the literal entry', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		// Nothing planted — the literal ref is already absent.
		const rel = await releaseLiteralLockEntry({
			entry: 'slice-never-existed',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('not-held');
		expect(rel.entry).toBe('slice-never-existed');
		expect(rel.ref).toBe(`${LOCK_REF_PREFIX}/slice-never-existed`);
	});

	it('(iii) an INVALID literal is rejected BEFORE any git operation (error, no ref touched)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['unused']);
		// A different, valid lock is held; the invalid call must not touch it.
		await acquireItemLock({
			item: 'task:unused',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const rel = await releaseLiteralLockEntry({
			entry: 'slice/escape',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('error');
		expect(rel.message).toMatch(/invalid --entry/);
		// The unrelated lock is untouched (no git operation ran for the bad entry).
		expect(lockRefOnArbiter(arbiter, 'task-unused')).toBe(true);
	});

	it('reuses the SAME leased-delete path: a valid item-form entry works via --entry too', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['current']);
		await acquireItemLock({
			item: 'task:current',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lockRefOnArbiter(arbiter, 'task-current')).toBe(true);
		const rel = await releaseLiteralLockEntry({
			entry: 'task-current',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'task-current')).toBe(false);
	});
});

describe('gc --ledger report — surfaces literal entry names + the --entry hint', () => {
	it('(v) a slice-prefixed entry prints only the literal name and the release-lock --entry hint', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['unused']);
		plantLiteralLock(repo, repo /*unused*/, 'slice-claim-cas-spinner');

		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		expect(report.locks.map((l) => l.lock.entry)).toContain(
			'slice-claim-cas-spinner',
		);
		const text = formatItemLockReport(report).join('\n');
		// The literal entry name is surfaced.
		expect(text).toMatch(/slice-claim-cas-spinner/);
		// The one-line hint suggests the --entry invocation (copy-pasteable).
		expect(text).toMatch(
			/# no current item-form; clear with: dorfl release-lock --entry slice-claim-cas-spinner/,
		);
		// It does NOT mis-suggest an item-form `release-lock <item>` for this entry.
		expect(text).not.toMatch(
			/release-lock slice:claim-cas-spinner|release-lock slice-claim-cas-spinner`/,
		);
	});

	it('a current-vocabulary entry still gets the item-form release-lock hint (not --entry)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['current']);
		await acquireItemLock({
			item: 'task:current',
			action: 'implement',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const report = await reportItemLocks(repo, ARBITER, gitEnv());
		const text = formatItemLockReport(report).join('\n');
		expect(text).toMatch(/dorfl release-lock task:current/);
		expect(text).not.toMatch(/--entry task-current/);
	});
});
