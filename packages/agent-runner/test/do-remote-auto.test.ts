import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	performDoRemoteAuto,
	type DoRemoteRunner,
} from '../src/do-remote-auto.js';
import type {DoResult} from '../src/do.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	registerMirrorWithWork,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do --remote -n` / auto-pick over the MIRROR-SIDE eligible-pool scan — the THIN
 * caller (`advance-drivers-and-gates`, US #25) the `mirror-side-eligible-pool-scan`
 * makes possible, which lets the inline `-n`×`--remote` REFUSAL be removed.
 *
 * House `--bare`-mirror style: seed a bare hub mirror whose committed `main`
 * carries a mix of eligible/gated slices + PRDs, then assert the driver SELECTS +
 * ORDERS them over the mirror scan and runs a STUBBED single-`do --remote` runner
 * per item SEQUENTIALLY — recording WHICH items ran in what ORDER (the real
 * mirror/claim/worktree pipeline is `do-remote`'s tested job). `-n` is sequential;
 * the per-action gates are honoured by the SELECTION layer (the mirror scan).
 */

let scratch: Scratch;
let ws: string;

beforeEach(() => {
	scratch = makeScratch('agent-runner-do-remote-auto-');
	ws = join(scratch.root, '.agent-runner');
});

afterEach(() => {
	scratch.cleanup();
});

function task(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
	lines.push('---', '', 'body');
	return lines.join('\n');
}

function brief(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
	lines.push('---', '', '# PRD');
	return lines.join('\n');
}

/** A recording stub `do --remote` runner: captures each `arg`, always succeeds. */
function recordingRunner(): {run: DoRemoteRunner; args: string[]} {
	const args: string[] = [];
	const run: DoRemoteRunner = async (options) => {
		args.push(options.arg);
		return {
			exitCode: 0,
			outcome: 'completed',
			slug: options.arg,
			message: `did ${options.arg}`,
		} satisfies DoResult;
	};
	return {run, args};
}

describe('performDoRemoteAuto — auto-pick / -n over the mirror-side pool', () => {
	it('auto-picks ONE eligible item (a slice) from the bare mirror', async () => {
		const {originUrl} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'alpha.md': task({slug: 'alpha'})},
			brief: {'gamma.md': brief({slug: 'gamma'})},
		});
		const {run, args} = recordingRunner();
		const result = await performDoRemoteAuto({
			remote: originUrl,
			workspacesDir: ws,
			run,
			config: mergeConfig({autoBuild: true, autoTask: true}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(args).toEqual(['alpha']);
	});

	it('-n <x> takes x items, slices-first then PRDs, IN SEQUENCE', async () => {
		const {originUrl} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'alpha.md': task({slug: 'alpha'})},
			brief: {
				'gamma.md': brief({slug: 'gamma'}),
				'delta.md': brief({slug: 'delta'}),
			},
		});
		const {run, args} = recordingRunner();
		const result = await performDoRemoteAuto({
			remote: originUrl,
			workspacesDir: ws,
			run,
			config: mergeConfig({autoBuild: true, autoTask: true}),
			count: 3,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// the eligible slice drains first, then the two sliceable PRDs (by slug).
		expect(args).toEqual(['alpha', 'brief:delta', 'brief:gamma']);
	});

	it('honours the per-action GATES via the mirror scan: gates off ⇒ nothing selected', async () => {
		const {originUrl} = registerMirrorWithWork(ws, 'repo', {
			backlog: {'alpha.md': task({slug: 'alpha'})},
			brief: {'gamma.md': brief({slug: 'gamma'})},
		});
		const {run, args} = recordingRunner();
		const result = await performDoRemoteAuto({
			remote: originUrl,
			workspacesDir: ws,
			run,
			config: mergeConfig({autoBuild: false, autoTask: false}),
			count: 5,
			env: gitEnv(),
		});
		expect(args).toEqual([]);
		// Nothing eligible under the gates is NOT a failure.
		expect(result.exitCode).toBe(0);
		expect(result.message).toMatch(/nothing eligible/i);
	});

	it('runs the selected items SEQUENTIALLY (never two in flight)', async () => {
		const {originUrl} = registerMirrorWithWork(ws, 'repo', {
			backlog: {
				'alpha.md': task({slug: 'alpha'}),
				'beta.md': task({slug: 'beta'}),
			},
		});
		let inFlight = 0;
		let maxInFlight = 0;
		const run: DoRemoteRunner = async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return {exitCode: 0, outcome: 'completed', message: ''};
		};
		await performDoRemoteAuto({
			remote: originUrl,
			workspacesDir: ws,
			run,
			config: mergeConfig({autoBuild: true, autoTask: true}),
			count: 2,
			env: gitEnv(),
		});
		expect(maxInFlight).toBe(1);
	});
});
