import {describe, it, expect} from 'vitest';
import {homedir, userInfo} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_CONFIG, defaultConfigPath} from '../src/config.js';

/**
 * The SUITE-WIDE guard behind `test/setup.ts` point 4: no test can reach the
 * developer's real home state. `DEFAULT_CONFIG.workspacesDir` is computed from
 * `homedir()` ONCE, when `config.ts` is first imported, so a per-test `HOME`
 * override cannot redirect it (observation
 * `default-workspacesdir-frozen-at-module-load-ignores-home-2026-09-28`). Any
 * test that forgot to pass an explicit workspaces dir used to leak hub mirrors
 * into the real `~/.dorfl/repos/`, which then flooded `dorfl status`. The setup
 * file points `HOME` at a scratch dir BEFORE any test file imports product code,
 * so the frozen default is scratch too.
 *
 * `userInfo().homedir` reads the password database, not `HOME`, so it still
 * names the real home to compare against.
 */
describe('suite-wide home isolation (test/setup.ts)', () => {
	const realHome = userInfo().homedir;

	it('homedir() is not the real home', () => {
		expect(homedir()).not.toBe(realHome);
	});

	it('the frozen DEFAULT_CONFIG.workspacesDir is not the real ~/.dorfl', () => {
		expect(DEFAULT_CONFIG.workspacesDir).not.toBe(join(realHome, '.dorfl'));
		expect(DEFAULT_CONFIG.workspacesDir.startsWith(`${realHome}/`)).toBe(false);
	});

	it('the default global config path is not the real one', () => {
		expect(defaultConfigPath().startsWith(`${realHome}/`)).toBe(false);
	});
});
