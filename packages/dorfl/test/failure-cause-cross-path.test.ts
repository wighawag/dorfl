import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {performDo, type DoDorfl} from '../src/do.js';
import {runOnce, type Dorfl} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `failure-cause-classification-model-vs-git-vs-agent` — the CROSS-PATH
 * convergence: `do` and `run` must classify the SAME thrown core error the SAME
 * way. The task's headline divergence (`work/notes/observations/run-thrown-core-error-
 * labeled-agent-failed.md`): a thrown CORE wiring/config error (`review` on with
 * no `reviewGate`) used to read as `usage-error` in `do` but `agent-failed` in
 * `run`. After this task BOTH map it to the SAME `config-error` cause.
 *
 * House style: throwaway checkout + local `--bare` arbiter + stubbed agent. Drives
 * real git + writes main, so (like do.test.ts/run.test.ts) it is non-parallel.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-failcause-xpath-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

const editingDoAgent: DoDorfl = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};
const editingRunAgent: Dorfl = ({cwd, slug}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), `work done for ${slug}\n`);
	return {ok: true};
};

function runConfig(overrides = {}) {
	return mergeConfig({
		defaultArbiter: ARBITER,
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		verify: PASS,
		autoBuild: true,
		...overrides,
	});
}

describe('do and run classify the SAME thrown core error the SAME way (config-error)', () => {
	it('review on with NO reviewGate → config-error on BOTH paths (no usage-error-in-do vs agent-failed-in-run drift)', async () => {
		// --- do path ---
		const seededForDo = seedRepoWithArbiter(scratch.root, ['alpha']);
		const doResult = await performDo({
			arg: 'alpha',
			cwd: seededForDo.repo,
			arbiter: ARBITER,
			verify: PASS,
			review: true, // but NO reviewGate ⇒ the core throws the wiring error
			dorfl: editingDoAgent,
			env: gitEnv(),
		});

		// Fresh scratch state for the run path (its scan reads <root>/project).
		scratch.cleanup();
		scratch = makeScratch('dorfl-failcause-xpath-run-');

		// --- run path ---
		seedRepoWithArbiter(scratch.root, ['feat']);
		const config = runConfig({review: true}); // no reviewGate ⇒ core throws
		const runResult = await runOnce({
			config,
			report: scanRepoPaths([join(scratch.root, 'project')], config),
			workspace: join(scratch.root, 'ws'),
			dorfl: editingRunAgent,
			env: gitEnv(),
			agentId: () => 'agentA',
		});

		// The SAME error → the SAME cause on both paths (the divergence is closed).
		expect(doResult.outcome).toBe('config-error');
		expect(runResult.items[0].status).toBe('config-error');
		expect(doResult.outcome).toBe(runResult.items[0].status);
		// And NOT the old divergent labels.
		expect(doResult.outcome).not.toBe('usage-error');
		expect(runResult.items[0].status).not.toBe('agent-failed');
	});
});
