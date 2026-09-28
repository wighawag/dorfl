import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	existsSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	HandoffRejected,
	setHandoffByteLimitsForTest,
} from '../src/ci-handoff-format.js';
import {readHandoff, writeHandoff} from '../src/ci-handoff.js';
import {
	LFS_POINTER_MAX_BYTES,
	looksLikeLfsPointer,
	parseLfsPointer,
	pushLfsObjects,
} from '../src/ci-handoff-lfs.js';

/**
 * Git LFS in the CI handoff (task `ci-split-handoff-lfs-objects`, decision 6):
 * the strict spec v1 pointer parser, and the agent-side writer that copies
 * every object a new commit's pointer references into `lfs/<oid>`.
 */

function sh(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

function oidOf(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

function pointerOf(content: string): string {
	return (
		'version https://git-lfs.github.com/spec/v1\n' +
		`oid sha256:${oidOf(content)}\n` +
		`size ${Buffer.byteLength(content)}\n`
	);
}

describe('parseLfsPointer (strict spec v1)', () => {
	it('parses the canonical pointer', () => {
		expect(parseLfsPointer(Buffer.from(pointerOf('hello')))).toEqual({
			oid: oidOf('hello'),
			size: 5,
		});
	});

	it('accepts size 0', () => {
		const text =
			'version https://git-lfs.github.com/spec/v1\n' +
			`oid sha256:${oidOf('')}\nsize 0\n`;
		expect(parseLfsPointer(Buffer.from(text))).toEqual({
			oid: oidOf(''),
			size: 0,
		});
	});

	for (const [label, text] of [
		[
			'an extra key',
			pointerOf('x') + 'ext-0-foo sha256:' + 'a'.repeat(64) + '\n',
		],
		['keys out of order', pointerOf('x').split('\n').reverse().join('\n')],
		['no final newline', pointerOf('x').slice(0, -1)],
		['CRLF', pointerOf('x').replace(/\n/g, '\r\n')],
		['leading whitespace', ' ' + pointerOf('x')],
		[
			'an upper-case oid',
			pointerOf('x').replace(
				/sha256:(.*)/,
				(_, h: string) => `sha256:${h.toUpperCase()}`,
			),
		],
		['a short oid', pointerOf('x').replace(/sha256:[0-9a-f]{2}/, 'sha256:')],
		['another hash', pointerOf('x').replace('sha256:', 'sha512:')],
		['a leading-zero size', pointerOf('x').replace('size 1', 'size 01')],
		['a negative size', pointerOf('x').replace('size 1', 'size -1')],
		[
			'an unsafe-integer size',
			pointerOf('x').replace('size 1', 'size 99999999999999999999'),
		],
		['another version', pointerOf('x').replace('spec/v1', 'spec/v2')],
		['the empty blob', ''],
		['ordinary text', 'hello\n'],
	] as const) {
		it(`refuses ${label}`, () => {
			expect(parseLfsPointer(Buffer.from(text))).toBeUndefined();
		});
	}

	it(`refuses anything over ${LFS_POINTER_MAX_BYTES} bytes`, () => {
		const padded = Buffer.alloc(LFS_POINTER_MAX_BYTES + 1, 0x20);
		Buffer.from(pointerOf('x')).copy(padded);
		expect(parseLfsPointer(padded)).toBeUndefined();
	});
});

describe('looksLikeLfsPointer (what git-lfs could read as a pointer)', () => {
	it('is true for a canonical pointer and for a malformed one', () => {
		expect(looksLikeLfsPointer(Buffer.from(pointerOf('x')))).toBe(true);
		expect(
			looksLikeLfsPointer(Buffer.from(pointerOf('x') + 'extra junk\n')),
		).toBe(true);
		expect(
			looksLikeLfsPointer(
				Buffer.from('\n  version https://hawser.github.com/spec/v1\n'),
			),
		).toBe(true);
	});

	it('is false for ordinary files', () => {
		expect(looksLikeLfsPointer(Buffer.from('version 1.2.3\n'))).toBe(false);
		expect(looksLikeLfsPointer(Buffer.from('# readme\n'))).toBe(false);
		expect(looksLikeLfsPointer(Buffer.alloc(0))).toBe(false);
	});

	it('is false over the size cutoff', () => {
		const big = Buffer.alloc(LFS_POINTER_MAX_BYTES + 1, 0x20);
		Buffer.from(pointerOf('x')).copy(big);
		expect(looksLikeLfsPointer(big)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The agent-side writer
// ---------------------------------------------------------------------------

let root: string;
let runnerTemp: string;
let repo: string;
let baseSha: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-handoff-lfs-'));
	runnerTemp = join(root, 'runner-temp');
	mkdirSync(runnerTemp);
	repo = join(root, 'repo');
	mkdirSync(repo);
	sh(repo, 'init', '-q', '-b', 'main');
	sh(repo, 'config', 'user.email', 't@t');
	sh(repo, 'config', 'user.name', 't');
	writeFileSync(join(repo, 'a.txt'), 'a\n');
	// An LFS asset already on main (its object in the local store, as the
	// agent job's `lfs: true` checkout would have it).
	mkdirSync(join(repo, 'assets'));
	writeFileSync(join(repo, 'assets/old.bin'), pointerOf('old asset'));
	storeLocally('old asset');
	sh(repo, 'add', '.');
	sh(repo, 'commit', '-qm', 'base');
	baseSha = sh(repo, 'rev-parse', 'HEAD');
	sh(repo, 'checkout', '-qb', 'work/task-add-thing');
});
afterEach(() => {
	setHandoffByteLimitsForTest(undefined);
	rmSync(root, {recursive: true, force: true});
});

/** Put `content` in the repository's local LFS store, as `git lfs` would. */
function storeLocally(content: string): void {
	const oid = oidOf(content);
	const path = join(
		repo,
		'.git',
		'lfs',
		'objects',
		oid.slice(0, 2),
		oid.slice(2, 4),
		oid,
	);
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, content);
}

function commitFile(rel: string, content: string): void {
	mkdirSync(dirname(join(repo, rel)), {recursive: true});
	writeFileSync(join(repo, rel), content);
	sh(repo, 'add', '.');
	sh(repo, 'commit', '-qm', `add ${rel}`);
}

function writeIt(): string {
	const dir = join(runnerTemp, 'handoff');
	writeHandoff({
		dir,
		rung: 'build-task',
		record: {
			schema: 1,
			item: 'task:add-thing',
			intent: {kind: 'integrate'},
			products: {prTitle: 'Add the thing', prBody: 'Adds it.'},
		},
		bundle: {repo, workBranch: 'work/task-add-thing', baseSha},
	});
	return dir;
}

function lfsDir(dir: string): string[] {
	const p = join(dir, 'lfs');
	return existsSync(p) ? readdirSync(p).sort() : [];
}

describe('writeHandoff: LFS objects', () => {
	it('copies the object of every pointer the new commits add', () => {
		storeLocally('new asset');
		commitFile('assets/new.bin', pointerOf('new asset'));
		const dir = writeIt();
		expect(lfsDir(dir)).toEqual([oidOf('new asset')]);
		expect(readFileSync(join(dir, 'lfs', oidOf('new asset')), 'utf8')).toBe(
			'new asset',
		);
		const read = readHandoff({
			dir,
			runnerTemp,
			trust: {item: 'task:add-thing', rung: 'build-task'},
		});
		expect(read.lfsObjects.map((o) => o.oid)).toEqual([oidOf('new asset')]);
	});

	it('copies an object the agent copied from elsewhere in the repository', () => {
		// Same pointer blob as main's assets/old.bin, at a new path.
		commitFile('assets/copy.bin', pointerOf('old asset'));
		expect(lfsDir(writeIt())).toEqual([oidOf('old asset')]);
	});

	it('copies every version a pointer takes across the new commits', () => {
		storeLocally('v1');
		storeLocally('v2');
		commitFile('assets/x.bin', pointerOf('v1'));
		commitFile('assets/x.bin', pointerOf('v2'));
		expect(lfsDir(writeIt())).toEqual([oidOf('v1'), oidOf('v2')].sort());
	});

	it('writes no lfs/ directory when no new commit carries a pointer', () => {
		commitFile('src/thing.ts', 'export {};\n');
		const dir = writeIt();
		expect(existsSync(join(dir, 'lfs'))).toBe(false);
	});

	it('leaves out an object the local store lacks (the apply job rejects it, naming it)', () => {
		commitFile('assets/ghost.bin', pointerOf('not stored'));
		expect(lfsDir(writeIt())).toEqual([]);
	});

	it('refuses to write LFS objects over the LFS limit', () => {
		storeLocally('new asset');
		commitFile('assets/new.bin', pointerOf('new asset'));
		setHandoffByteLimitsForTest({lfsBytes: 3});
		let caught: unknown;
		try {
			writeIt();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(HandoffRejected);
		expect((caught as HandoffRejected).rule).toBe('size');
	});
});

describe('pushLfsObjects: staging re-checks every byte', () => {
	it('refuses an object that changed after validation, staging nothing and pushing nothing', async () => {
		const file = join(root, 'obj');
		writeFileSync(file, 'swapped bytes');
		let caught: unknown;
		try {
			await pushLfsObjects({
				cwd: repo,
				arbiter: '/nonexistent/arbiter.git',
				objects: [
					{
						oid: oidOf('validated bytes'),
						path: file,
						size: 'validated bytes'.length,
					},
				],
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(HandoffRejected);
		expect((caught as HandoffRejected).rule).toBe('lfs-mismatch');
		const staged = join(
			repo,
			'.git/lfs/objects',
			oidOf('validated bytes').slice(0, 2),
		);
		expect(
			existsSync(staged)
				? readdirSync(join(staged, oidOf('validated bytes').slice(2, 4)))
				: [],
		).toEqual([]);
	});

	it('does nothing (and needs no git-lfs) when there is no object', async () => {
		expect(
			await pushLfsObjects({cwd: repo, arbiter: 'origin', objects: []}),
		).toEqual({status: 0, stderr: ''});
	});
});
