import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	ACTION_PINS,
	existingPins,
	pinnedUses,
	preserveExistingPins,
} from '../src/install-ci-action-pins.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

describe('ACTION_PINS: the one table of emitted third-party actions', () => {
	it('every entry is a full lowercase commit SHA with a vX.Y.Z version', () => {
		for (const pin of Object.values(ACTION_PINS)) {
			expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
			expect(pin.version).toMatch(/^v\d+\.\d+\.\d+$/);
			expect(pin.action).toMatch(/^[\w.-]+\/[\w.-]+(\/.+)?$/);
		}
	});

	it('pinnedUses writes the Dependabot format', () => {
		expect(pinnedUses(ACTION_PINS.checkout)).toBe(
			'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
		);
	});

	it('the documented seed template and the README example use the table values', () => {
		const root = join(
			dirname(fileURLToPath(import.meta.url)),
			'..',
			'..',
			'..',
		);
		const seed = readFileSync(
			join(root, 'docs', 'ci', 'advance-loop.yml.template'),
			'utf8',
		);
		const seedUses = seed.match(/uses: actions\/checkout@.*$/gm) ?? [];
		expect(seedUses.length).toBeGreaterThan(0);
		for (const u of seedUses) {
			expect(u).toBe(`uses: ${pinnedUses(ACTION_PINS.checkout)}`);
		}
		const readme = readFileSync(join(root, 'docs', 'ci', 'README.md'), 'utf8');
		expect(readme).toContain(`uses: ${pinnedUses(ACTION_PINS.pnpmSetup)}`);
		expect(readme).toContain(`uses: ${pinnedUses(ACTION_PINS.setupNode)}`);
	});
});

describe('preserveExistingPins', () => {
	const generated = [
		'steps:',
		`  - uses: actions/checkout@${SHA_A} # v7.0.1`,
		'    with:',
		'      fetch-depth: 0',
		'  - uses: ./.github/actions/dorfl-setup',
		`  - uses: github/codeql-action/init@${SHA_A} # v4.0.0`,
		`  - uses: github/codeql-action/analyze@${SHA_A} # v4.0.0`,
		'',
	].join('\n');

	it('no existing file, or one without SHA pins: output unchanged', () => {
		expect(preserveExistingPins(generated, undefined)).toBe(generated);
		expect(
			preserveExistingPins(generated, '  - uses: actions/checkout@v4\n'),
		).toBe(generated);
	});

	it('keeps an existing SHA pin and its comment, matched by action not position', () => {
		const existing = [
			`  - uses: github/codeql-action/analyze@${SHA_C} # v4.2.0`,
			`  - uses: actions/checkout@${SHA_B} # v7.1.0`,
		].join('\n');
		const out = preserveExistingPins(generated, existing);
		expect(out).toContain(`  - uses: actions/checkout@${SHA_B} # v7.1.0`);
		// The path is part of the key: analyze moved, init did not.
		expect(out).toContain(
			`  - uses: github/codeql-action/analyze@${SHA_C} # v4.2.0`,
		);
		expect(out).toContain(
			`  - uses: github/codeql-action/init@${SHA_A} # v4.0.0`,
		);
		// Everything except the two `uses:` values is untouched.
		expect(out.split('\n').length).toBe(generated.split('\n').length);
		expect(out.replace(/@\w+ # v[\d.]+/g, '')).toBe(
			generated.replace(/@\w+ # v[\d.]+/g, ''),
		);
	});

	it('keeps an existing pin even when it carries no comment, or a quoted value', () => {
		expect(
			preserveExistingPins(generated, `- uses: actions/checkout@${SHA_B}`),
		).toContain(`  - uses: actions/checkout@${SHA_B}\n`);
		expect(
			preserveExistingPins(generated, `- uses: 'actions/checkout@${SHA_B}'`),
		).toContain(`  - uses: 'actions/checkout@${SHA_B}'\n`);
	});

	it('reads the pins of a CRLF file (a Windows / autocrlf checkout)', () => {
		const existing = [
			`  - uses: actions/checkout@${SHA_B} # v7.1.0`,
			`  - uses: github/codeql-action/init@${SHA_C}`,
			'',
		].join('\r\n');
		const out = preserveExistingPins(generated, existing);
		expect(out).toContain(`  - uses: actions/checkout@${SHA_B} # v7.1.0\n`);
		expect(out).toContain(`  - uses: github/codeql-action/init@${SHA_C}\n`);
	});

	it('matches actions case-insensitively and keeps an uppercase SHA pin', () => {
		const upper = SHA_B.toUpperCase();
		const out = preserveExistingPins(
			generated,
			`  - uses: Actions/Checkout@${upper} # v7.1.0`,
		);
		expect(out).toContain(`  - uses: Actions/Checkout@${upper} # v7.1.0\n`);
	});

	it('never replaces a SHA with a tag or a short SHA', () => {
		const existing = [
			'  - uses: actions/checkout@v7',
			'  - uses: github/codeql-action/init@abc1234',
		].join('\n');
		expect(preserveExistingPins(generated, existing)).toBe(generated);
	});

	it('an existing SHA replaces a generated TAG (e.g. from a project-setup snippet)', () => {
		const out = preserveExistingPins(
			'    - uses: pnpm/action-setup@v6\n',
			`      uses: pnpm/action-setup@${SHA_B} # v6.1.0\n`,
		);
		expect(out).toBe(`    - uses: pnpm/action-setup@${SHA_B} # v6.1.0\n`);
	});

	it('when the existing file pins one action to several SHAs, the highest version wins', () => {
		const pins = existingPins(
			[
				`  - uses: actions/checkout@${SHA_A} # v7.0.1`,
				`  - uses: actions/checkout@${SHA_B} # v7.10.0`,
				`  - uses: actions/checkout@${SHA_C} # v7.2.0`,
			].join('\n'),
		);
		expect(pins.get('actions/checkout')).toBe(
			`actions/checkout@${SHA_B} # v7.10.0`,
		);
	});

	it('ignores `uses:` text inside comments', () => {
		expect(
			existingPins(`    # passes the secret via with: on the uses: line\n`)
				.size,
		).toBe(0);
		expect(
			existingPins(`    # - uses: actions/checkout@${SHA_B} # v9.0.0\n`).size,
		).toBe(0);
	});
});
