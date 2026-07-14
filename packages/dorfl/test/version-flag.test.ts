import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {buildProgram} from '../src/cli.js';

/**
 * `dorfl --version` (and the lower-case `-v` most users reach for) must print
 * the CLI's version. The version is read from the package's own `package.json`
 * at runtime (the single source of truth changesets bumps on release), NOT a
 * compiled-in literal that would drift silently on the next bump. These tests
 * pin BOTH: the flag exists on both spellings, and it prints EXACTLY the
 * package.json `version` (proving the wiring reads the real source of truth).
 */

/** The version declared in this package's package.json (the source of truth). */
function packageVersion(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// test/ → package root → package.json
	const pkgPath = join(here, '..', 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {version: string};
	return pkg.version;
}

/**
 * Parse argv through a fresh program with commander's exit + output intercepted,
 * returning what it wrote to stdout. commander's `.version()` writes the version
 * to stdout then exits (throws under `exitOverride`).
 */
async function runVersion(argv: string[]): Promise<string> {
	const program = buildProgram();
	program.exitOverride();
	let out = '';
	program.configureOutput({
		writeOut: (str) => {
			out += str;
		},
		writeErr: () => {},
	});
	try {
		await program.parseAsync(['node', 'dorfl', ...argv]);
	} catch {
		// commander throws a CommanderError (code `commander.version`) after
		// writing the version — expected under exitOverride.
	}
	return out.trim();
}

describe('dorfl --version', () => {
	it('registers a -v, --version option in the help', () => {
		const help = buildProgram().helpInformation();
		expect(help).toMatch(/-v, --version/);
		expect(help).toMatch(/print the dorfl version/);
	});

	it('prints the package.json version for --version', async () => {
		const version = packageVersion();
		expect(await runVersion(['--version'])).toBe(version);
	});

	it('prints the same version for the lower-case -v alias', async () => {
		const version = packageVersion();
		expect(await runVersion(['-v'])).toBe(version);
	});

	it('is a real, non-empty semver-shaped string (not the "unknown" fallback)', async () => {
		const printed = await runVersion(['--version']);
		expect(printed).not.toBe('');
		expect(printed).not.toBe('unknown');
		expect(printed).toMatch(/^\d+\.\d+\.\d+/);
	});
});
