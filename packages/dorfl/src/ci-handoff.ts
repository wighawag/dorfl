/**
 * **The CI handoff artifact on disk**: the writer (agent job) and the safe
 * reader (apply job). The record format and its intent table are
 * `ci-handoff-format.ts`.
 *
 * The artifact directory holds exactly:
 *
 *   - `handoff.json`: the record;
 *   - `work.bundle`: for code-carrying intents only, `git bundle create
 *     work.bundle <work-branch> ^<baseSha>`, exactly one ref;
 *   - `lfs/<oid>`: the object of every LFS pointer the bundle's new commits
 *     add or change (`ci-handoff-lfs.ts`; the reader here checks only their
 *     names and sizes, the apply validation checks them against the pointers).
 *
 * The reader treats the directory as HOSTILE (the agent controls everything in
 * its job): it must sit under `$RUNNER_TEMP`, only those names are read, a
 * symlink or any other entry rejects the whole handoff, files are opened with
 * `O_NOFOLLOW`, and every size limit is checked before anything is parsed. The
 * bundle header is parsed here without running git on hostile bytes; the
 * bundle's CONTENT (history, protected paths) is task
 * `ci-split-apply-rejects-hostile-bundle`.
 */

import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	realpathSync,
	statSync,
	writeFileSync,
	type Stats,
} from 'node:fs';
import {isAbsolute, join, relative, sep} from 'node:path';
import {git} from './git.js';
import {writeLfsObjects} from './ci-handoff-lfs.js';
import {
	canonicalHandoffItem,
	handoffByteLimits,
	intentRowFor,
	rejectHandoff as reject,
	validateHandoffRecord,
	type HandoffRecord,
	type HandoffRung,
	type HandoffTrust,
	type IntentRow,
} from './ci-handoff-format.js';

/** The record file of the artifact. */
export const HANDOFF_JSON = 'handoff.json';
/** The git bundle of the work branch (code-carrying intents only). */
export const HANDOFF_BUNDLE = 'work.bundle';
/** The directory of LFS objects, one file per oid. */
export const HANDOFF_LFS_DIR = 'lfs';

/** The most a bundle header (signature, capabilities, prerequisites, one ref) may take. */
const MAX_BUNDLE_HEADER_BYTES = 64 * 1024;

const HEX_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LFS_OID = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Bundle header
// ---------------------------------------------------------------------------

/** What a bundle header says: its one ref, the ref's tip and the prerequisites. */
export interface BundleHeader {
	ref: string;
	tip: string;
	prerequisites: string[];
}

/**
 * Parse the header of a git bundle (v2, or v3 with only `@object-format`)
 * without running git, and require exactly one ref.
 */
export function parseBundleHeader(head: Buffer): BundleHeader {
	const end = head.indexOf('\n\n');
	if (end === -1) reject('bundle-format', 'no bundle header terminator');
	const lines = head.subarray(0, end).toString('latin1').split('\n');
	const signature = lines.shift();
	const v3 = signature === '# v3 git bundle';
	if (signature !== '# v2 git bundle' && !v3) {
		reject('bundle-format', 'not a v2 or v3 git bundle');
	}
	const prerequisites: string[] = [];
	const refs: {tip: string; ref: string}[] = [];
	for (const l of lines) {
		if (l.startsWith('@')) {
			if (!v3 || !/^@object-format=(?:sha1|sha256)$/.test(l)) {
				reject('bundle-format', 'unsupported bundle capability');
			}
		} else if (l.startsWith('-')) {
			const oid = l.slice(1).split(' ', 1)[0];
			if (!HEX_OID.test(oid)) reject('bundle-format', 'bad prerequisite line');
			prerequisites.push(oid);
		} else {
			const m = /^([0-9a-f]{40}|[0-9a-f]{64}) (refs\/[\x21-\x7e]+)$/.exec(l);
			if (m === null) reject('bundle-format', 'bad bundle ref line');
			refs.push({tip: m[1], ref: m[2]});
		}
	}
	if (refs.length !== 1) {
		reject('bundle-refs', `the bundle carries ${refs.length} refs, not 1`);
	}
	return {...refs[0], prerequisites};
}

// ---------------------------------------------------------------------------
// Low-level safe reads
// ---------------------------------------------------------------------------

/** Open a path for reading, refusing a symlink at open time (`O_NOFOLLOW`). */
function openNoFollow(path: string, name: string): number {
	try {
		return openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	} catch {
		reject('symlink', `${name} could not be opened as a regular file`);
	}
}

/**
 * Read a regular file of at most `max` bytes (whole, or only its first
 * `headOnly` bytes), refusing a symlink and re-checking the size on the open
 * descriptor so a file swapped after the directory scan is still bounded.
 */
function readBounded(
	path: string,
	name: string,
	max: number,
	headOnly?: number,
): Buffer {
	const fd = openNoFollow(path, name);
	try {
		const st = fstatSync(fd);
		if (!st.isFile()) reject('layout', `${name} is not a regular file`);
		if (st.size > max) reject('size', `${name} is over ${max} bytes`);
		const want = headOnly ?? max + 1;
		const buf = Buffer.alloc(Math.min(want, st.size + 1));
		const n = readSync(fd, buf, 0, buf.length, 0);
		if (headOnly === undefined && n > max) {
			reject('size', `${name} is over ${max} bytes`);
		}
		return buf.subarray(0, n);
	} finally {
		closeSync(fd);
	}
}

/** `lstat` an entry; refuse a symlink or an entry of the wrong type. */
function entryStat(path: string, name: string, want: 'file' | 'dir'): Stats {
	const st = lstatSync(path);
	if (st.isSymbolicLink()) reject('symlink', `${name} is a symlink`);
	const ok = want === 'file' ? st.isFile() : st.isDirectory();
	if (!ok) {
		reject(
			'layout',
			`${name} is not a ${want === 'file' ? 'file' : 'directory'}`,
		);
	}
	return st;
}

function isStrictlyInside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return (
		rel !== '' &&
		rel !== '..' &&
		!rel.startsWith(`..${sep}`) &&
		!isAbsolute(rel)
	);
}

function checkBundlePresence(row: IntentRow, present: boolean): void {
	if (row.bundle.rule === 'required' && !present) {
		reject('bundle-presence', `${row.kind} needs ${HANDOFF_BUNDLE}`);
	}
	if (row.bundle.rule === 'none' && present) {
		reject('bundle-presence', `${row.kind} carries no ${HANDOFF_BUNDLE}`);
	}
}

// ---------------------------------------------------------------------------
// Writing (agent side)
// ---------------------------------------------------------------------------

/** What {@link writeHandoff} needs to also write `work.bundle`. */
export interface HandoffBundleSource {
	/** The repository (the agent job's checkout). */
	repo: string;
	/** The work branch name; the bundle's one ref is `refs/heads/<workBranch>`. */
	workBranch: string;
	/** The trusted base: the bundle holds `<workBranch> ^<baseSha>`. */
	baseSha: string;
}

/**
 * Write the handoff into `dir` (created, and required to be empty): validate
 * the record exactly as the reader will, then write `handoff.json` and, for a
 * code-carrying intent, `work.bundle` with exactly one ref, and `lfs/<oid>` for
 * the object of every LFS pointer its new commits add or change (from the
 * local store; one the store lacks is left out and returned in `lfsMissing`,
 * and the apply job then rejects the handoff naming it). The record's item is
 * written in its canonical form.
 */
export function writeHandoff(params: {
	dir: string;
	rung: HandoffRung;
	record: HandoffRecord;
	bundle?: HandoffBundleSource;
}): {lfsMissing: string[]} {
	const {dir, rung, bundle} = params;
	const item = canonicalHandoffItem(params.record.item);
	const json = JSON.stringify({...params.record, item});
	const {row} = validateHandoffRecord(JSON.parse(json), {item, rung});
	checkBundlePresence(row, bundle !== undefined);
	if (Buffer.byteLength(json) > handoffByteLimits().handoffJsonBytes) {
		reject(
			'size',
			`${HANDOFF_JSON} is over ${handoffByteLimits().handoffJsonBytes} bytes`,
		);
	}
	mkdirSync(dir, {recursive: true});
	if (readdirSync(dir).length > 0) {
		reject('layout', `the handoff directory ${dir} is not empty`);
	}
	writeFileSync(join(dir, HANDOFF_JSON), json);
	if (bundle === undefined) return {lfsMissing: []};
	writeBundle(dir, bundle);
	const {missing} = writeLfsObjects({
		dir,
		repo: bundle.repo,
		ref: `refs/heads/${bundle.workBranch}`,
		baseSha: bundle.baseSha,
	});
	return {lfsMissing: missing};
}

/** `git bundle create work.bundle refs/heads/<branch> ^<baseSha>`, then check it. */
function writeBundle(dir: string, source: HandoffBundleSource): void {
	if (!HEX_OID.test(source.baseSha)) {
		reject('bundle-format', 'baseSha is not a full commit id');
	}
	const ref = `refs/heads/${source.workBranch}`;
	git(['check-ref-format', ref], source.repo);
	const out = join(dir, HANDOFF_BUNDLE);
	git(['bundle', 'create', out, ref, `^${source.baseSha}`], source.repo);
	const header = parseBundleHeader(
		readBounded(
			out,
			HANDOFF_BUNDLE,
			Number.MAX_SAFE_INTEGER,
			MAX_BUNDLE_HEADER_BYTES,
		),
	);
	if (header.ref !== ref) {
		reject('bundle-refs', `the bundle carries ${header.ref}, not ${ref}`);
	}
	if (statSync(out).size > handoffByteLimits().bundleBytes) {
		reject(
			'size',
			`${HANDOFF_BUNDLE} is over ${handoffByteLimits().bundleBytes} bytes`,
		);
	}
}

// ---------------------------------------------------------------------------
// Reading (apply side)
// ---------------------------------------------------------------------------

/** An LFS object file of the artifact (checked against pointers elsewhere). */
export interface HandoffLfsObject {
	oid: string;
	path: string;
	size: number;
}

/** A read, validated handoff. */
export interface ReadHandoff {
	record: HandoffRecord;
	/** The intent table row the record was validated against. */
	row: IntentRow;
	/** `work.bundle` with its parsed header, when the artifact carries one. */
	bundle?: {path: string; size: number} & BundleHeader;
	lfsObjects: HandoffLfsObject[];
}

/**
 * Read and validate the handoff the agent job uploaded. `dir` is where the
 * artifact was downloaded: a real directory strictly inside `runnerTemp`
 * (`$RUNNER_TEMP`). Rejects ({@link HandoffRejected}) a symlink anywhere, any
 * entry but `handoff.json`, `work.bundle` and `lfs/<64-hex oid>`, any size over
 * the byte limits (`handoffByteLimits`), a record that fails `validateHandoffRecord`, a bundle
 * the intent forbids or lacks, `lfs/` without a bundle, and a bundle whose
 * header is malformed or carries other than one ref.
 */
export function readHandoff(params: {
	dir: string;
	runnerTemp: string;
	trust: HandoffTrust;
}): ReadHandoff {
	const {dir, runnerTemp, trust} = params;
	const rootStat = lstatSync(dir, {throwIfNoEntry: false});
	if (rootStat === undefined) {
		reject('layout', 'the handoff directory is missing');
	}
	if (rootStat.isSymbolicLink()) {
		reject('symlink', 'the handoff directory is a symlink');
	}
	if (!rootStat.isDirectory()) {
		reject('layout', 'the handoff path is not a directory');
	}
	if (!isStrictlyInside(realpathSync(runnerTemp), realpathSync(dir))) {
		reject('location', 'the handoff directory is not under $RUNNER_TEMP');
	}

	let total = 0;
	let hasJson = false;
	let hasBundle = false;
	let lfsTotal = 0;
	const lfsObjects: HandoffLfsObject[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (name === HANDOFF_JSON) {
			total += entryStat(path, name, 'file').size;
			hasJson = true;
		} else if (name === HANDOFF_BUNDLE) {
			total += entryStat(path, name, 'file').size;
			hasBundle = true;
		} else if (name === HANDOFF_LFS_DIR) {
			entryStat(path, name, 'dir');
			for (const oid of readdirSync(path)) {
				const objName = `${HANDOFF_LFS_DIR}/${JSON.stringify(oid).slice(0, 80)}`;
				if (!LFS_OID.test(oid)) reject('layout', `unexpected entry ${objName}`);
				const objPath = join(path, oid);
				const size = entryStat(objPath, objName, 'file').size;
				lfsTotal += size;
				lfsObjects.push({oid, path: objPath, size});
			}
		} else {
			reject('layout', `unexpected entry ${JSON.stringify(name).slice(0, 80)}`);
		}
	}
	if (!hasJson) reject('layout', `${HANDOFF_JSON} is missing`);
	if (lfsTotal > handoffByteLimits().lfsBytes) {
		reject(
			'size',
			`the LFS objects are over ${handoffByteLimits().lfsBytes} bytes`,
		);
	}
	total += lfsTotal;
	if (total > handoffByteLimits().artifactBytes) {
		reject(
			'size',
			`the artifact is over ${handoffByteLimits().artifactBytes} bytes`,
		);
	}
	if (lfsObjects.length > 0 && !hasBundle) {
		reject('layout', `${HANDOFF_LFS_DIR}/ without ${HANDOFF_BUNDLE}`);
	}

	const raw = readBounded(
		join(dir, HANDOFF_JSON),
		HANDOFF_JSON,
		handoffByteLimits().handoffJsonBytes,
	);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.toString('utf8'));
	} catch {
		reject('json', `${HANDOFF_JSON} is not valid JSON`);
	}
	const {record, row} = validateHandoffRecord(parsed, trust);
	checkBundlePresence(row, hasBundle);

	let bundle: ReadHandoff['bundle'];
	if (hasBundle) {
		const path = join(dir, HANDOFF_BUNDLE);
		const head = readBounded(
			path,
			HANDOFF_BUNDLE,
			handoffByteLimits().bundleBytes,
			MAX_BUNDLE_HEADER_BYTES,
		);
		bundle = {path, size: lstatSync(path).size, ...parseBundleHeader(head)};
	}
	return {record, row, bundle, lfsObjects};
}
