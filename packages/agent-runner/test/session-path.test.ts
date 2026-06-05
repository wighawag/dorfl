import {describe, it, expect} from 'vitest';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {generateSessionPath, piDefaultSessionDir} from '../src/session-path.js';

/**
 * The session-path generator (slice `session-path-pi-default`) — the SINGLE
 * source of the `--session <path>` value. These pin the four load-bearing
 * properties: the arg is ABSOLUTE + ends `.jsonl` (else pi exits 1), it is
 * UNIQUE per launch (else pi would resume/replay the prior session), it lands
 * under the pi-default per-cwd folder by default, and an override redirects it.
 */

describe('piDefaultSessionDir — pi-default per-cwd folder under ~/.pi/agent/sessions', () => {
	it('is a DIRECT child of ~/.pi/agent/sessions (so the dashboard listAll scans it)', () => {
		const cwd = '/home/me/dev/project';
		const dir = piDefaultSessionDir(cwd);
		const sessionsRoot = join(homedir(), '.pi', 'agent', 'sessions');
		// First-level subdir of the sessions root (invariant #4).
		expect(dir.startsWith(sessionsRoot)).toBe(true);
		const rel = dir.slice(sessionsRoot.length + 1);
		expect(rel.includes('/')).toBe(false);
	});

	it('encodes the cwd verbatim per pi getDefaultSessionDirPath', () => {
		const cwd = '/home/me/dev/project';
		const safe = `--${resolve(cwd)
			.replace(/^[/\\]/, '')
			.replace(/[/\\:]/g, '-')}--`;
		expect(piDefaultSessionDir(cwd)).toBe(
			join(homedir(), '.pi', 'agent', 'sessions', safe),
		);
	});
});

describe('generateSessionPath — absolute, .jsonl, unique-per-launch', () => {
	it('returns an ABSOLUTE path ending in .jsonl (the path-shape invariant)', () => {
		const path = generateSessionPath({cwd: '/repo', id: 'feat'});
		expect(isAbsolute(path)).toBe(true);
		expect(path.endsWith('.jsonl')).toBe(true);
	});

	it('defaults under the pi-default per-cwd folder when sessionsDir is unset', () => {
		const cwd = '/home/me/dev/project';
		const path = generateSessionPath({cwd, id: 'feat'});
		expect(path.startsWith(piDefaultSessionDir(cwd))).toBe(true);
	});

	it('redirects under an explicit sessionsDir override (resolved absolute)', () => {
		const path = generateSessionPath({
			sessionsDir: '/srv/fleet-sessions',
			cwd: '/repo',
			id: 'feat',
		});
		expect(path.startsWith('/srv/fleet-sessions/')).toBe(true);
		expect(path.endsWith('.jsonl')).toBe(true);
	});

	it('resolves a RELATIVE sessionsDir to an absolute path', () => {
		const path = generateSessionPath({
			sessionsDir: 'rel/sessions',
			cwd: '/repo',
			id: 'feat',
		});
		expect(isAbsolute(path)).toBe(true);
		expect(path.startsWith(resolve('rel/sessions'))).toBe(true);
	});

	it('is UNIQUE per launch — two calls with the SAME id give DISTINCT paths', () => {
		// The bug this guards: pi resumes+replays an existing non-empty session
		// file, so a reused name would corrupt the audit trail / replay --watch.
		const a = generateSessionPath({cwd: '/repo', id: 'feat'});
		const b = generateSessionPath({cwd: '/repo', id: 'feat'});
		expect(a).not.toBe(b);
		// Both still carry the human-readable id stem.
		expect(a.includes('feat-')).toBe(true);
		expect(b.includes('feat-')).toBe(true);
	});
});
