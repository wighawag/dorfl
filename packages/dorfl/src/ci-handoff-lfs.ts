/**
 * **Git LFS objects in the CI handoff** (spec `ci-agent-job-without-write-token`,
 * ADR `ci-agent-job-holds-no-write-token` decision 6, task
 * `ci-split-handoff-lfs-objects`).
 *
 * The agent job commits LFS-tracked paths as pointers (its checkout runs
 * `git lfs install --local`), with the objects under `.git/lfs/objects/`. It
 * holds no write token, so it cannot upload them: the handoff carries them as
 * `lfs/<oid>`, and the apply job pushes them to the arbiter's LFS store BEFORE
 * any ref, so a ref never lands pointing at a missing object.
 *
 * Pointers are found by scanning the blobs the new commits add or change (a
 * blob that parses as a pointer counts, whatever `.gitattributes` says), never
 * by trusting `git lfs ls-files`. Accepted consequence: a legitimate text file
 * that happens to parse as a pointer is treated as one, and its object must be
 * present or the handoff is rejected.
 *
 *  - agent side: {@link writeLfsObjects} copies every referenced object from
 *    the local store into `lfs/<oid>`, including one the agent copied from
 *    elsewhere in the repository;
 *  - apply side: {@link checkLfsObjects} runs the strict parser's verdicts
 *    against the artifact's objects (present, a regular file, exactly `size`
 *    bytes, hashing to `oid`, none unreferenced, within the size limit), and
 *    {@link pushLfsObjects} stages the validated objects into the apply
 *    checkout's own store (re-hashing every byte it copies) and pushes them with
 *    `git lfs push --object-id <arbiter> <oids>` from that checkout of the
 *    trusted base, so `.lfsconfig` and the endpoint come from `main` (the
 *    bundle cannot change `.lfsconfig`: it is a protected path).
 *
 * Content addressing means a hostile object can only be itself: it cannot
 * overwrite another object.
 */

import {createHash} from 'node:crypto';
import {
	closeSync,
	constants as fsConstants,
	copyFileSync,
	existsSync,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {
	handoffByteLimits,
	rejectHandoff as reject,
} from './ci-handoff-format.js';
import {git, gitBytes, run} from './git.js';
import {refWrite} from './ref-write.js';

/** git-lfs's blob size cutoff: a larger blob is never read as a pointer. */
export const LFS_POINTER_MAX_BYTES = 1024;

/**
 * The directory of the artifact that holds the objects (`lfs/<oid>`): the
 * same name as `HANDOFF_LFS_DIR` in `ci-handoff.ts`, which imports this module.
 */
const LFS_ARTIFACT_DIR = 'lfs';

/** The one pointer form accepted: spec v1, keys in order, nothing else. */
const STRICT_POINTER =
	/^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (0|[1-9][0-9]*)\n$/;

/**
 * What git-lfs itself could read as a pointer: a first key `version` naming an
 * LFS spec (current or the legacy `hawser` one), after leading whitespace.
 */
const POINTER_LIKE =
	/^[ \t\r\n]*version https:\/\/(?:git-lfs|hawser)\.github\.com\/spec\//;

const MODE_FILE = '100644';
const MODE_EXEC = '100755';

/** A parsed LFS pointer. */
export interface LfsPointer {
	/** The sha256 of the object, 64 lower-case hex. */
	oid: string;
	/** The object's size in bytes. */
	size: number;
}

/**
 * Parse a blob as a spec v1 LFS pointer, STRICTLY: at most
 * {@link LFS_POINTER_MAX_BYTES} bytes, exactly
 * `version https://git-lfs.github.com/spec/v1`, `oid sha256:<64 hex>`,
 * `size <n>` (no leading zero, a safe integer), each ending in `\n`, in that
 * order, nothing else. `undefined` when the blob is not such a pointer.
 */
export function parseLfsPointer(content: Buffer): LfsPointer | undefined {
	if (content.length > LFS_POINTER_MAX_BYTES) return undefined;
	const m = STRICT_POINTER.exec(content.toString('latin1'));
	if (m === null) return undefined;
	const size = Number(m[2]);
	if (!Number.isSafeInteger(size)) return undefined;
	return {oid: m[1], size};
}

/**
 * Whether git-lfs could read a blob as a pointer (see {@link POINTER_LIKE}). A
 * blob that looks like one but does not parse strictly is a MALFORMED pointer,
 * which the apply job rejects rather than treating as an ordinary file.
 */
export function looksLikeLfsPointer(content: Buffer): boolean {
	if (content.length === 0 || content.length > LFS_POINTER_MAX_BYTES) {
		return false;
	}
	return POINTER_LIKE.test(content.toString('latin1'));
}

/** A regular-file blob a new commit adds or changes, with one path it has. */
export interface ChangedBlob {
	oid: string;
	path: string;
}

/** A pointer found in the new commits, with a path that carries it. */
export interface FoundPointer extends LfsPointer {
	path: string;
}

/** What {@link scanLfsPointers} found. */
export interface LfsScan {
	pointers: FoundPointer[];
	/** Paths of blobs that look like pointers but do not parse strictly. */
	malformed: string[];
}

/** Whether a tree entry mode is a regular file (LFS applies to nothing else). */
export function isRegularFileMode(mode: string): boolean {
	return mode === MODE_FILE || mode === MODE_EXEC;
}

/**
 * Scan `blobs` (read in `cwd`) for LFS pointers: every blob of at most
 * {@link LFS_POINTER_MAX_BYTES} bytes is read, in one `cat-file --batch`.
 */
export function scanLfsPointers(params: {
	cwd: string;
	blobs: readonly ChangedBlob[];
	env?: NodeJS.ProcessEnv;
}): LfsScan {
	const {cwd, env} = params;
	const pathOf = new Map<string, string>();
	for (const b of params.blobs) {
		if (!pathOf.has(b.oid)) pathOf.set(b.oid, b.path);
	}
	if (pathOf.size === 0) return {pointers: [], malformed: []};

	const small: string[] = [];
	const checks = git(
		['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
		cwd,
		{env, input: [...pathOf.keys()].join('\n') + '\n'},
	)
		.trim()
		.split('\n');
	for (const line of checks) {
		const [oid, type, size] = line.split(' ');
		const n = Number(size);
		if (type === 'blob' && n > 0 && n <= LFS_POINTER_MAX_BYTES) small.push(oid);
	}
	if (small.length === 0) return {pointers: [], malformed: []};

	const out = gitBytes(['cat-file', '--batch'], cwd, {
		env,
		input: small.join('\n') + '\n',
	});
	const pointers: FoundPointer[] = [];
	const malformed: string[] = [];
	let at = 0;
	for (let i = 0; i < small.length; i++) {
		const eol = out.indexOf(0x0a, at);
		if (eol === -1) throw new Error('git cat-file --batch: truncated output');
		const [oid, type, size] = out
			.subarray(at, eol)
			.toString('latin1')
			.split(' ');
		const n = Number(size);
		if (type !== 'blob' || !Number.isSafeInteger(n)) {
			throw new Error(`git cat-file --batch: unexpected header for ${oid}`);
		}
		const content = out.subarray(eol + 1, eol + 1 + n);
		at = eol + 1 + n + 1;
		const path = pathOf.get(oid) ?? oid;
		const pointer = parseLfsPointer(content);
		if (pointer !== undefined) {
			pointers.push({...pointer, path});
		} else if (looksLikeLfsPointer(content)) {
			malformed.push(path);
		}
	}
	return {pointers, malformed};
}

/**
 * The regular-file blobs `commits` add or change against their first parent
 * (a root commit against the empty tree). Deletions carry no blob.
 */
export function changedFileBlobs(
	cwd: string,
	commits: readonly string[],
	env?: NodeJS.ProcessEnv,
): ChangedBlob[] {
	if (commits.length === 0) return [];
	const out = git(
		[
			'-c',
			'diff.renames=false',
			'diff-tree',
			'--stdin',
			'--root',
			'-r',
			'-z',
			'--raw',
			'--no-renames',
			'--no-commit-id',
		],
		cwd,
		{env, input: commits.join('\n') + '\n'},
	);
	const fields = out.split('\0');
	const blobs: ChangedBlob[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const meta = fields[i];
		if (!meta.startsWith(':')) {
			// `--stdin` may echo a commit id line; skip it.
			i -= 1;
			continue;
		}
		const [, newMode, , newOid, status] = meta.slice(1).split(' ');
		if (status === 'D' || !isRegularFileMode(newMode)) continue;
		blobs.push({oid: newOid, path: fields[i + 1]});
	}
	return blobs;
}

// ---------------------------------------------------------------------------
// The local object store
// ---------------------------------------------------------------------------

/**
 * The repository's local LFS object directory: `<storage>/objects`, where the
 * storage is `lfs.storage` (relative to the git directory) or `<git dir>/lfs`.
 */
export function localLfsObjectsDir(
	repo: string,
	env?: NodeJS.ProcessEnv,
): string {
	const common = git(
		['rev-parse', '--path-format=absolute', '--git-common-dir'],
		repo,
		{env},
	).trim();
	const custom = run('git', ['config', '--get', 'lfs.storage'], repo, {
		env,
	}).stdout.trim();
	const storage =
		custom === ''
			? join(common, 'lfs')
			: isAbsolute(custom)
				? custom
				: resolve(common, custom);
	return join(storage, 'objects');
}

/** Where the store keeps `oid`: `<objects>/<oid[0:2]>/<oid[2:4]>/<oid>`. */
export function lfsObjectPath(objectsDir: string, oid: string): string {
	return join(objectsDir, oid.slice(0, 2), oid.slice(2, 4), oid);
}

// ---------------------------------------------------------------------------
// Agent side
// ---------------------------------------------------------------------------

/**
 * Copy into `<dir>/lfs/<oid>` the object of every pointer the commits
 * `<ref> ^<baseSha>` add or change, from `repo`'s local store. An object the
 * store lacks is left out: the apply job then rejects the handoff naming it
 * (that is also the fate of a text file that parses as a pointer). Refuses
 * ({@link HandoffRejected} `size`) objects over the LFS limit together.
 * Returns the oids left out.
 */
export function writeLfsObjects(params: {
	dir: string;
	repo: string;
	ref: string;
	baseSha: string;
	env?: NodeJS.ProcessEnv;
}): {missing: string[]} {
	const {dir, repo, env} = params;
	const commits = git(['rev-list', params.ref, `^${params.baseSha}`], repo, {
		env,
	})
		.split('\n')
		.filter((l) => l !== '');
	const {pointers} = scanLfsPointers({
		cwd: repo,
		blobs: changedFileBlobs(repo, commits, env),
		env,
	});
	const oids = [...new Set(pointers.map((p) => p.oid))].sort();
	if (oids.length === 0) return {missing: []};

	const store = localLfsObjectsDir(repo, env);
	const present: string[] = [];
	const missing: string[] = [];
	let total = 0;
	for (const oid of oids) {
		const src = lfsObjectPath(store, oid);
		if (!existsSync(src) || !statSync(src).isFile()) {
			missing.push(oid);
			continue;
		}
		total += statSync(src).size;
		present.push(oid);
	}
	const limit = handoffByteLimits().lfsBytes;
	if (total > limit) {
		reject('size', `the LFS objects are over ${limit} bytes`);
	}
	if (present.length > 0) {
		mkdirSync(join(dir, LFS_ARTIFACT_DIR), {recursive: true});
		for (const oid of present) {
			copyFileSync(lfsObjectPath(store, oid), join(dir, LFS_ARTIFACT_DIR, oid));
		}
	}
	return {missing};
}

// ---------------------------------------------------------------------------
// Apply side
// ---------------------------------------------------------------------------

/** An object file of the artifact (`lfs/<oid>`, already a named regular file). */
export interface LfsArtifactObject {
	oid: string;
	path: string;
	size: number;
}

function q(path: string): string {
	return JSON.stringify(path.slice(0, 300));
}

/**
 * Stream a regular file (refusing a symlink at open time) through sha256,
 * reading at most `max + 1` bytes; optionally copy every byte read to `outFd`.
 */
function hashFile(
	path: string,
	max: number,
	outFd?: number,
): {sha256: string; size: number} {
	let fd: number;
	try {
		fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	} catch {
		reject('symlink', `${q(path)} could not be opened as a regular file`);
	}
	try {
		if (!fstatSync(fd).isFile()) {
			reject('layout', `${q(path)} is not a regular file`);
		}
		const hash = createHash('sha256');
		const buf = Buffer.alloc(1024 * 1024);
		let size = 0;
		while (size <= max) {
			const n = readSync(fd, buf, 0, buf.length, null);
			if (n === 0) break;
			hash.update(buf.subarray(0, n));
			if (outFd !== undefined) writeSync(outFd, buf, 0, n);
			size += n;
		}
		return {sha256: hash.digest('hex'), size};
	} finally {
		closeSync(fd);
	}
}

/**
 * Check the artifact's LFS objects against the pointers the new commits carry
 * (decision 6). Rejects ({@link HandoffRejected}): a blob that looks like a
 * pointer but does not parse strictly (`lfs-pointer`); two pointers giving one
 * oid different sizes, or an object whose size or hash differs from its
 * pointer (`lfs-mismatch`); a pointer whose object is not in `lfs/`
 * (`lfs-missing`); an object no pointer references (`lfs-extra`); a pointer, or
 * all of them together, over the LFS limit (`size`). Returns the referenced
 * objects, sorted by oid.
 */
export function checkLfsObjects(
	scan: LfsScan,
	objects: readonly LfsArtifactObject[],
): LfsArtifactObject[] {
	if (scan.malformed.length > 0) {
		reject(
			'lfs-pointer',
			`the file ${q(scan.malformed[0])} looks like a Git LFS pointer but is not a ` +
				'strict spec v1 pointer (version, oid sha256:<64 hex>, size, in order, nothing else)',
		);
	}
	const limit = handoffByteLimits().lfsBytes;
	const want = new Map<string, FoundPointer>();
	let total = 0;
	for (const p of scan.pointers) {
		if (p.size > limit) {
			reject(
				'size',
				`the LFS pointer ${q(p.path)} names a ${p.size}-byte object, over the ` +
					`LFS limit of ${limit} bytes`,
			);
		}
		const seen = want.get(p.oid);
		if (seen !== undefined) {
			if (seen.size !== p.size) {
				reject(
					'lfs-mismatch',
					`the LFS pointers ${q(seen.path)} and ${q(p.path)} give the object ` +
						`${p.oid} different sizes`,
				);
			}
			continue;
		}
		want.set(p.oid, p);
		total += p.size;
	}
	if (total > limit) {
		reject('size', `the LFS objects are over ${limit} bytes`);
	}

	const byOid = new Map(objects.map((o) => [o.oid, o]));
	for (const o of objects) {
		if (!want.has(o.oid)) {
			reject(
				'lfs-extra',
				`lfs/${o.oid} is referenced by no LFS pointer of the new commits`,
			);
		}
	}
	const referenced: LfsArtifactObject[] = [];
	for (const [oid, p] of [...want].sort(([a], [b]) => a.localeCompare(b))) {
		const obj = byOid.get(oid);
		if (obj === undefined) {
			reject(
				'lfs-missing',
				`the LFS object ${oid} of ${q(p.path)} is not in lfs/ (a text file ` +
					'that parses as an LFS pointer counts as one)',
			);
		}
		const got = hashFile(obj.path, p.size);
		if (got.size !== p.size) {
			reject(
				'lfs-mismatch',
				`lfs/${oid} is ${got.size > p.size ? 'over ' : ''}${got.size} bytes, but ` +
					`its pointer ${q(p.path)} says ${p.size} bytes`,
			);
		}
		if (got.sha256 !== oid) {
			reject(
				'lfs-mismatch',
				`lfs/${oid} does not hash to its oid (its sha256 hash is ${got.sha256})`,
			);
		}
		referenced.push(obj);
	}
	return referenced;
}

/**
 * Stage the validated objects into `cwd`'s own LFS store and push them to
 * `arbiter` with `git lfs push --object-id`, BEFORE any ref is pushed. `cwd`
 * is the apply job's checkout of the trusted base, so `.lfsconfig` and the
 * endpoint come from `main`. Every byte staged is hashed again as it is copied
 * (a file that changed since validation rejects, `lfs-mismatch`); an object
 * the store already holds is not copied. The upload itself is the write seam
 * `refWrite.pushLfsObjects`. Returns the push's status and stderr.
 */
export async function pushLfsObjects(params: {
	cwd: string;
	arbiter: string;
	objects: readonly LfsArtifactObject[];
	env?: NodeJS.ProcessEnv;
}): Promise<{status: number; stderr: string}> {
	const {cwd, arbiter, objects, env} = params;
	if (objects.length === 0) return {status: 0, stderr: ''};
	const store = localLfsObjectsDir(cwd, env);
	for (const o of objects) stageObject(store, o);
	const r = await refWrite.pushLfsObjects({
		arbiter,
		oids: objects.map((o) => o.oid),
		cwd,
		env,
	});
	return {status: r.status, stderr: r.stderr};
}

function stageObject(store: string, o: LfsArtifactObject): void {
	const dest = lfsObjectPath(store, o.oid);
	if (existsSync(dest)) return;
	mkdirSync(dirname(dest), {recursive: true});
	const tmp = `${dest}.dorfl-${process.pid}.tmp`;
	const out = openSync(tmp, 'w', 0o644);
	let got: {sha256: string; size: number};
	try {
		got = hashFile(o.path, o.size, out);
	} finally {
		closeSync(out);
	}
	if (got.size !== o.size || got.sha256 !== o.oid) {
		rmSync(tmp, {force: true});
		reject('lfs-mismatch', `lfs/${o.oid} changed after it was validated`);
	}
	renameSync(tmp, dest);
}
