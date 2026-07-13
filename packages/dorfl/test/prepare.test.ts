import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	existsSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {
	runPrepare,
	resolvePrepareCommands,
	ensurePrepared,
	isPrepared,
	markPrepared,
	preparedMarkerPath,
	PREPARE_MARKER_BASENAME,
} from '../src/prepare.js';

/**
 * Unit tests for the `prepare` env-prep step (`prepare.ts`), the SIBLING of the
 * `verify` acceptance gate. House style mirrors `verify.test.ts` — a throwaway
 * dir + deterministic shell commands (no model). The KEY difference proven here:
 * unset `prepare` is a genuine NO-OP (no default install, unlike `verify`), and
 * the prepared-ness marker lives in the worktree's git CONTROL area (never the
 * committed tree).
 */

describe('resolvePrepareCommands', () => {
	it('unset ⇒ EMPTY list (a no-op — NO default install, unlike verify)', () => {
		expect(resolvePrepareCommands(undefined)).toEqual([]);
	});

	it('wraps a single configured string command into a one-element list', () => {
		expect(resolvePrepareCommands('pnpm install')).toEqual(['pnpm install']);
	});

	it('keeps an ordered list of commands as-is', () => {
		expect(
			resolvePrepareCommands(['pnpm install', 'git submodule update --init']),
		).toEqual(['pnpm install', 'git submodule update --init']);
	});

	it('drops blank entries (and an all-blank list stays a no-op, NOT a default)', () => {
		expect(resolvePrepareCommands(['', '   '])).toEqual([]);
		expect(resolvePrepareCommands('')).toEqual([]);
	});
});

describe('runPrepare — step status propagation', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dorfl-prepare-'));
	});
	afterEach(() => {
		rmrf(dir);
	});

	it('unset ⇒ no-op pass (runs nothing, reports noop)', async () => {
		const result = await runPrepare({
			cwd: dir,
			prepare: undefined,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.noop).toBe(true);
		expect(result.commands).toEqual([]);
	});

	it('exits 0 when the step passes', async () => {
		const result = await runPrepare({
			cwd: dir,
			prepare: 'exit 0',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(0);
		expect(result.passed).toBe(true);
		expect(result.noop).toBe(false);
	});

	it('exits non-zero when the step fails, propagating its code', async () => {
		const result = await runPrepare({
			cwd: dir,
			prepare: 'exit 7',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(7);
		expect(result.passed).toBe(false);
	});

	it('runs an ordered list in sequence and short-circuits on the first failure', async () => {
		const log = join(dir, 'order.log');
		const result = await runPrepare({
			cwd: dir,
			prepare: [
				`echo one >> ${JSON.stringify(log)}`,
				`echo two >> ${JSON.stringify(log)}; exit 3`,
				`echo three >> ${JSON.stringify(log)}`,
			],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(3);
		expect(result.passed).toBe(false);
		expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
			'one',
			'two',
		]);
	});

	it('runs the step in the given cwd', async () => {
		const marker = join(dir, 'installed.txt');
		await runPrepare({
			cwd: dir,
			prepare: 'echo deps > installed.txt',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(existsSync(marker)).toBe(true);
	});
});

describe('prepared-ness marker — non-committed, in the git control area', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-prepared-'));
		execFileSync('git', ['init', '-q'], {cwd: repo});
		execFileSync('git', ['config', 'user.email', 't@t'], {cwd: repo});
		execFileSync('git', ['config', 'user.name', 't'], {cwd: repo});
		writeFileSync(join(repo, 'README.md'), '# r\n');
		execFileSync('git', ['add', '-A'], {cwd: repo});
		execFileSync('git', ['commit', '-q', '-m', 'init'], {cwd: repo});
	});
	afterEach(() => {
		rmrf(repo);
	});

	it('resolves the marker path INSIDE the git dir (.git), never the work tree', () => {
		const path = preparedMarkerPath(repo);
		expect(path).toBeDefined();
		expect(path).toContain('.git');
		expect(path!.endsWith(PREPARE_MARKER_BASENAME)).toBe(true);
	});

	it('isPrepared flips false→true on markPrepared, and the marker is NOT in the tracked tree', () => {
		expect(isPrepared(repo)).toBe(false);
		markPrepared(repo);
		expect(isPrepared(repo)).toBe(true);
		// The repo tree (git status) is unchanged — the marker lives in .git, so it
		// is invisible to git and can never be committed.
		const status = execFileSync('git', ['status', '--porcelain'], {
			cwd: repo,
			encoding: 'utf8',
		});
		expect(status.trim()).toBe('');
	});

	it('returns undefined for a non-git dir (caller then prepares without a skip signal)', () => {
		const plain = mkdtempSync(join(tmpdir(), 'dorfl-plain-'));
		try {
			expect(preparedMarkerPath(plain)).toBeUndefined();
			expect(isPrepared(plain)).toBe(false);
		} finally {
			rmrf(plain);
		}
	});
});

describe('ensurePrepared — once-per-worktree (marker-gated skip)', () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-ensure-'));
		execFileSync('git', ['init', '-q'], {cwd: repo});
		execFileSync('git', ['config', 'user.email', 't@t'], {cwd: repo});
		execFileSync('git', ['config', 'user.name', 't'], {cwd: repo});
		writeFileSync(join(repo, 'README.md'), '# r\n');
		execFileSync('git', ['add', '-A'], {cwd: repo});
		execFileSync('git', ['commit', '-q', '-m', 'init'], {cwd: repo});
	});
	afterEach(() => {
		rmrf(repo);
	});

	it('runs prepare on a fresh (unmarked) worktree, then SKIPS the second time', async () => {
		const counter = join(repo, 'runs.log');
		const cmd = `echo x >> ${JSON.stringify(counter)}`;

		const first = await ensurePrepared({
			cwd: repo,
			prepare: cmd,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(first.passed).toBe(true);
		expect(first.skipped).toBe(false);
		expect(isPrepared(repo)).toBe(true);

		const second = await ensurePrepared({
			cwd: repo,
			prepare: cmd,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(second.passed).toBe(true);
		expect(second.skipped).toBe(true);

		// The command ran exactly ONCE (the second call skipped via the marker).
		expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['x']);
	});

	it('a FAILING prepare does NOT write the marker (so a retry re-runs it)', async () => {
		const result = await ensurePrepared({
			cwd: repo,
			prepare: 'exit 1',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		expect(result.skipped).toBe(false);
		expect(isPrepared(repo)).toBe(false);
	});

	it('unset ⇒ no-op, no marker written, byte-for-byte unchanged', async () => {
		const before = readdirSync(repo).sort();
		const result = await ensurePrepared({
			cwd: repo,
			prepare: undefined,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.noop).toBe(true);
		expect(result.passed).toBe(true);
		expect(isPrepared(repo)).toBe(false);
		expect(readdirSync(repo).sort()).toEqual(before);
	});

	it('useMarker:false forces a run every time (a throwaway worktree)', async () => {
		const counter = join(repo, 'runs.log');
		const cmd = `echo x >> ${JSON.stringify(counter)}`;
		await ensurePrepared({
			cwd: repo,
			prepare: cmd,
			useMarker: false,
			onStdout: () => {},
			onStderr: () => {},
		});
		await ensurePrepared({
			cwd: repo,
			prepare: cmd,
			useMarker: false,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual([
			'x',
			'x',
		]);
		// No marker written when useMarker is off.
		expect(isPrepared(repo)).toBe(false);
	});
});

describe('prepare does NOT pollute the committed repo tree', () => {
	it('a run leaves git status clean (the only artifact is in .git)', async () => {
		const repo = mkdtempSync(join(tmpdir(), 'dorfl-clean-'));
		try {
			execFileSync('git', ['init', '-q'], {cwd: repo});
			execFileSync('git', ['config', 'user.email', 't@t'], {cwd: repo});
			execFileSync('git', ['config', 'user.name', 't'], {cwd: repo});
			writeFileSync(join(repo, 'README.md'), '# r\n');
			execFileSync('git', ['add', '-A'], {cwd: repo});
			execFileSync('git', ['commit', '-q', '-m', 'init'], {cwd: repo});

			// A prepare whose command touches NOTHING in the tree (a pure env op).
			await ensurePrepared({
				cwd: repo,
				prepare: 'true',
				onStdout: () => {},
				onStderr: () => {},
			});

			const status = execFileSync('git', ['status', '--porcelain'], {
				cwd: repo,
				encoding: 'utf8',
			});
			expect(status.trim()).toBe('');
			// The marker exists, but in .git (untracked-invisible), not the work tree.
			expect(isPrepared(repo)).toBe(true);
		} finally {
			rmrf(repo);
		}
	});
});
