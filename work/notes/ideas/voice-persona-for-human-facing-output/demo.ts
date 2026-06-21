/**
 * SPIKE DEMO for the voice-persona idea. Run it to SEE and FEEL the registers:
 *
 *   npx tsx work/notes/ideas/voice-persona-for-human-facing-output/demo.ts
 *
 * It exercises `voice.ts` (co-located) across the three casings and the two
 * off-paths. Exploratory only; not wired into the CLI. The casing transform is
 * what exists today; EMPHASIS (the load-bearing word) is described in the idea
 * file and is NOT yet in the spike.
 */
import {flavour, DORFL_LINES, type VoiceContext} from './voice.js';

const tty = {isTTY: true};
const base = {voice: 'cli' as const, stream: tty, env: {} as NodeJS.ProcessEnv};

function show(casing: 'title' | 'caps' | 'plain') {
	const ctx: VoiceContext = {...base, voiceCasing: casing};
	console.log(`\n=== voiceCasing: ${casing} ===`);
	console.log(
		'claim won   :',
		flavour(ctx, 'Claimed work/foo.', DORFL_LINES.claimWon),
	);
	console.log(
		'claim lost  :',
		flavour(ctx, 'Already claimed; next.', DORFL_LINES.claimLost),
	);
	console.log(
		'gate red    :',
		flavour(ctx, 'Gate failed; needs-attention.', DORFL_LINES.gateRed),
	);
	console.log(
		'pushed      :',
		flavour(ctx, 'Pushed work/foo.', DORFL_LINES.pushedPropose),
	);
	console.log(
		'signature   :',
		flavour(ctx, 'agent-runner', DORFL_LINES.signature),
	);
}

show('title');
show('caps');
show('plain');

// Off-paths: persona disabled, and machine-read (non-TTY) forced off.
const off: VoiceContext = {voice: 'plain', stream: tty, env: {}};
console.log('\n=== voice: plain (off) ===');
console.log(
	'claim won   :',
	flavour(off, 'Claimed work/foo.', DORFL_LINES.claimWon),
);

const piped: VoiceContext = {voice: 'cli', stream: {isTTY: false}, env: {}};
console.log('\n=== piped / non-TTY (forced off) ===');
console.log(
	'claim won   :',
	flavour(piped, 'Claimed work/foo.', DORFL_LINES.claimWon),
);
