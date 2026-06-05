import {describe, it, expect} from 'vitest';
import {homedir} from 'node:os';
import {join, isAbsolute, dirname, basename} from 'node:path';
import {
	piSessionsRoot,
	piDefaultSessionsDir,
	sessionFileName,
	generateSessionPath,
} from '../src/session-path.js';

/**
 * Unit tests for the pi session FILE path generator (slice
 * `session-path-pi-default`). These pin the four load-bearing properties of the
 * generated `--session <path>` arg:
 *
 *   1. it is ABSOLUTE and ends `.jsonl` (a bare id would make pi exit 1);
 *   2. the DEFAULT (unset `sessionsDir`) lands under pi's default per-cwd dir —
 *      a FIRST-LEVEL child of `~/.pi/agent/sessions/` so the dashboard scans it;
 *   3. an explicit `sessionsDir` REDIRECTS the file to that arbitrary folder;
 *   4. the filename is UNIQUE per launch (two launches → distinct paths), so pi
 *      never resumes+appends the prior session.
 */

describe('piSessionsRoot / piDefaultSessionsDir', () => {
	it('roots sessions at ~/.pi/agent/sessions', () => {
		expect(piSessionsRoot()).toBe(join(homedir(), '.pi', 'agent', 'sessions'));
	});

	it('derives a FIRST-LEVEL per-cwd subdir (pi getDefaultSessionDir slug)', () => {
		const dir = piDefaultSessionsDir('/home/me/proj');
		// A direct child of the sessions root (so the dashboard's non-recursive
		// listAll() scans it), named by the slug `--<cwd>--`.
		expect(dirname(dir)).toBe(piSessionsRoot());
		expect(basename(dir)).toBe('--home-me-proj--');
	});

	it('strips the leading slash and replaces separators + colons', () => {
		// Mirrors pi's getDefaultSessionDirPath encoding.
		expect(basename(piDefaultSessionsDir('/a/b'))).toBe('--a-b--');
		expect(basename(piDefaultSessionsDir('/x:y/z'))).toBe('--x-y-z--');
	});
});

describe('sessionFileName — unique per launch, .jsonl', () => {
	it('ends in .jsonl and embeds the id', () => {
		const name = sessionFileName('my-slug');
		expect(name.endsWith('.jsonl')).toBe(true);
		expect(name.startsWith('my-slug-')).toBe(true);
	});

	it('is unique across calls (slug alone is not enough)', () => {
		const a = sessionFileName('feat');
		const b = sessionFileName('feat');
		expect(a).not.toBe(b);
	});
});

describe('generateSessionPath', () => {
	it('default (unset sessionsDir) lands under the pi-default per-cwd root, absolute .jsonl', () => {
		const path = generateSessionPath({cwd: '/home/me/proj', id: 'feat'});
		expect(isAbsolute(path)).toBe(true);
		expect(path.endsWith('.jsonl')).toBe(true);
		// The parent is the pi-default per-cwd dir (a direct child of the root).
		expect(dirname(path)).toBe(piDefaultSessionsDir('/home/me/proj'));
	});

	it('an explicit sessionsDir REDIRECTS the file to that arbitrary folder', () => {
		const path = generateSessionPath({
			cwd: '/home/me/proj',
			id: 'feat',
			sessionsDir: '/var/fleet/sessions',
		});
		expect(isAbsolute(path)).toBe(true);
		expect(path.endsWith('.jsonl')).toBe(true);
		expect(dirname(path)).toBe('/var/fleet/sessions');
		// NOT under the pi-default root (no "must be under the sessions root" rule).
		expect(path.startsWith(piSessionsRoot())).toBe(false);
	});

	it('is UNIQUE per launch in the same cwd (no resume+append of the prior run)', () => {
		const a = generateSessionPath({cwd: '/home/me/proj', id: 'feat'});
		const b = generateSessionPath({cwd: '/home/me/proj', id: 'feat'});
		expect(a).not.toBe(b);
	});
});
