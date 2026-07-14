<script lang="ts">
	import '../app.css';
	import {base} from '$app/paths';
	import Lockup from '$lib/Lockup.svelte';

	const repoUrl = 'https://github.com/wighawag/dorfl';

	// Product framing from the repo's CONTEXT.md and work/protocol/WORK-CONTRACT.md.
	const pillars = [
		{
			title: 'Discovers',
			body: 'Point Dorfl at your repos. It finds the ones participating in the file-based work/ contract and surveys what is ready to build.',
		},
		{
			title: 'Schedules',
			body: 'Ready tasks are picked and ordered across many repos at once, as a guided human loop or as an unattended autonomous runner.',
		},
		{
			title: 'Claims',
			body: 'Claiming a task acquires its own per-item lock ref with a single create-only push. First to create it wins; the loser is told no. No coordination server, no lock table.',
		},
		{
			title: 'Runs',
			body: 'Each claimed task is built in its own isolated worktree, taken to a green acceptance gate, and integrated. Then Dorfl moves on.',
		},
	];

	const steps = [
		{
			n: '01',
			title: 'Durable status is the folder',
			body: 'Every work item is one markdown file, on a Kanban board of folders (tasks: backlog → todo → done). Its resting status is the folder it lives in, never a field. No database to keep in sync.',
		},
		{
			n: '02',
			title: 'Claiming is a lock ref',
			body: 'Claiming a task acquires a per-item lock ref, not a file move: a create-only push that is self-arbitrating, with no retry budget. The task stays in the pool, so a worker can even claim on a protected main.',
		},
		{
			n: '03',
			title: 'Build, verify, integrate',
			body: 'A worker builds the task on a work/<slug> branch, runs the acceptance gate, and proposes or merges. Conflicts rebase-or-abort, never auto-resolve.',
		},
	];
</script>

<svelte:head>
	<title>Dorfl: It Claims Its Own Work</title>
</svelte:head>

<!-- Navigation -->
<nav
	class="fixed top-0 right-0 left-0 z-50 border-b border-border bg-slate/80 backdrop-blur-md"
>
	<div
		class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
	>
		<a href="#top" class="flex items-center gap-2">
			<img src="{base}/icon.svg" alt="" class="h-8 w-8" />
			<span class="font-serif text-lg font-bold tracking-tight text-bone"
				>Dorfl</span
			>
		</a>
		<div class="flex items-center gap-6 text-sm">
			<a
				href="#what"
				class="hidden text-bone-muted transition-colors hover:text-bone sm:inline"
				>What it is</a
			>
			<a
				href="#how"
				class="hidden text-bone-muted transition-colors hover:text-bone sm:inline"
				>How it works</a
			>
			<a
				href="#install"
				class="hidden text-bone-muted transition-colors hover:text-bone sm:inline"
				>Get started</a
			>
			<a
				href={repoUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-2 rounded-lg border border-border bg-slate-2 px-3 py-1.5 font-medium transition-colors hover:bg-slate-3"
			>
				<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"
					><path
						d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
					/></svg
				>
				<span class="hidden sm:inline">GitHub</span>
			</a>
		</div>
	</div>
</nav>

<!-- Hero -->
<section
	id="top"
	class="relative overflow-hidden px-4 pt-28 pb-10 sm:px-6 sm:pt-32 sm:pb-12"
>
	<div class="clay-glow pointer-events-none absolute inset-0"></div>
	<div class="relative z-10 mx-auto max-w-3xl text-center">
		<div class="mb-10">
			<Lockup />
		</div>
		<p class="mx-auto mb-8 max-w-xl text-lg text-bone-muted">
			A small CLI that discovers, schedules, and runs work across many repos,
			autonomously and as a guided human loop, on a file-based
			<code class="rounded bg-slate-2 px-1.5 py-0.5 font-mono text-clay-light"
				>work/</code
			>
			contract with an atomic git-ref claim protocol. Folders hold the durable status,
			lock refs hold the live one. No database.
		</p>
		<div class="flex flex-col justify-center gap-4 sm:flex-row">
			<a
				href="#install"
				class="rounded-xl bg-clay px-7 py-3.5 text-center font-semibold text-bone shadow-lg shadow-clay-dark/30 transition-colors hover:bg-clay-light"
				>Get started</a
			>
			<a
				href={repoUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center justify-center gap-2 rounded-xl border border-border bg-slate-2 px-7 py-3.5 font-semibold text-bone transition-colors hover:bg-slate-3"
			>
				<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
					><path
						d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
					/></svg
				>
				View on GitHub
			</a>
		</div>
		<!-- Dorfl's signature line, set as carved clay (his vow in Feet of Clay).
		     Set in Hananiah, a Hebrew-SIMULATION face (Latin drawn to read as Hebrew)
		     — faithful to the books, where golem writing is "a corrupted form of the
		     Hebrew alphabet made to appear as roman letters". A deadpan accent. -->
		<p class="carved faux-hebrew mt-10 text-base sm:mt-12 sm:text-lg">
			Words In The Heart Can Not Be Taken
		</p>
	</div>
</section>

<!-- What it is -->
<section id="what" class="px-4 py-12 sm:px-6 sm:py-16">
	<div class="mx-auto max-w-6xl">
		<div class="mb-10 text-center">
			<h2 class="font-serif text-3xl font-bold text-bone sm:text-4xl">
				What it is
			</h2>
			<p class="mx-auto mt-3 max-w-2xl text-bone-muted">
				Four jobs, one tireless golem: discover, schedule, claim, run.
			</p>
		</div>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
			{#each pillars as pillar}
				<div
					class="rounded-2xl border border-border bg-slate-2 p-6 transition-colors hover:border-clay/50"
				>
					<div
						class="mb-4 inline-flex h-9 items-center rounded-lg bg-visor-inset px-3 font-mono text-sm text-amber"
					>
						&gt;_
					</div>
					<h3 class="mb-2 text-lg font-semibold text-bone">{pillar.title}</h3>
					<p class="text-sm leading-relaxed text-bone-muted">{pillar.body}</p>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- How it works -->
<section id="how" class="border-t border-border px-4 py-14 sm:px-6 sm:py-20">
	<div class="mx-auto max-w-4xl">
		<div class="mb-10 text-center">
			<h2 class="font-serif text-3xl font-bold text-bone sm:text-4xl">
				How it works
			</h2>
			<p class="mx-auto mt-3 max-w-2xl text-bone-muted">
				No coordination server, no shared index. Git refs and folders do the
				bookkeeping.
			</p>
		</div>
		<div class="space-y-5">
			{#each steps as step}
				<div
					class="flex gap-5 rounded-2xl border border-border bg-slate-2 p-6 sm:p-8"
				>
					<div
						class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-visor-inset font-mono text-sm font-bold text-amber"
					>
						{step.n}
					</div>
					<div>
						<h3 class="mb-2 text-lg font-semibold text-bone">{step.title}</h3>
						<p class="leading-relaxed text-bone-muted">{step.body}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Get started — three layers: adopt (skill) → work/ contract → execute (CLI + CI) -->
<section
	id="install"
	class="border-t border-border px-4 py-14 sm:px-6 sm:py-20"
>
	<div class="mx-auto max-w-4xl">
		<div class="mb-10 text-center">
			<h2 class="font-serif text-3xl font-bold text-bone sm:text-4xl">
				Get started
			</h2>
			<p class="mx-auto mt-3 max-w-2xl text-bone-muted">
				Dorfl comes in three layers, in this order. Adopt the contract with a
				skill; that gives you the file-based
				<code class="rounded bg-slate-2 px-1.5 py-0.5 font-mono text-clay-light"
					>work/</code
				> substrate; then the CLI executes against it. Adopt is a skill, execute is
				a command.
			</p>
		</div>

		<div class="space-y-5">
			<!-- Layer 1 — Adopt (a skill) -->
			<div
				class="flex gap-5 rounded-2xl border border-border bg-slate-2 p-6 sm:p-8"
			>
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-visor-inset font-mono text-sm font-bold text-amber"
				>
					01
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="mb-2 text-lg font-semibold text-bone">
						Adopt the contract (a skill)
					</h3>
					<p class="mb-4 leading-relaxed text-bone-muted">
						The front door. Install the dorfl skills, then point your agent at
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>from-idea</code
						>
						(from scratch) or
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>setup</code
						>
						(an existing repo). Runner-agnostic — nothing to install globally;
						the skills go in via
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>npx dorfl</code
						>, and adopting the contract needs no
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>dorfl</code
						> runtime.
					</p>
					<div
						class="rounded-xl border border-border bg-visor-inset p-4 sm:p-5"
					>
						<pre class="overflow-x-auto font-mono text-sm leading-relaxed"><code
								><span class="text-bone-muted"
									># install the dorfl skills into your agent (no install needed — run via npx)</span
								>
<span class="text-amber">npx dorfl skills add</span>
<span class="text-bone-muted"
									># (or install the CLI once — `npm install -g dorfl` — then `dorfl skills add`)</span
								>

<span class="text-bone-muted"># then, in your agent:</span>
<span class="text-amber">from-idea</span>   <span class="text-bone-muted"
									># from scratch: idea → scaffolded work/-contract repo + spec</span
								>
<span class="text-amber">setup</span>       <span class="text-bone-muted"
									># existing repo: onboard onto the work/ contract</span
								></code
							></pre>
					</div>
				</div>
			</div>

			<!-- Layer 2 — the work/ contract + protocol side-car -->
			<div
				class="flex gap-5 rounded-2xl border border-border bg-slate-2 p-6 sm:p-8"
			>
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-visor-inset font-mono text-sm font-bold text-amber"
				>
					02
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="mb-2 text-lg font-semibold text-bone">
						The <code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-base text-clay-light"
							>work/</code
						> contract, versioned with your code
					</h3>
					<p class="mb-4 leading-relaxed text-bone-muted">
						What adoption gives you: a durable, file-based substrate the CLI
						later consumes. One markdown file per item; status is the folder it
						lives in, never a field. No database.
					</p>
					<div
						class="rounded-xl border border-border bg-visor-inset p-4 sm:p-5"
					>
						<pre class="overflow-x-auto font-mono text-sm leading-relaxed"><code
								><span class="text-bone-muted"
									># what setup / from-idea scaffold into your repo</span
								>
<span class="text-amber">work/</span>
  <span class="text-amber">tasks/</span>       <span class="text-bone-muted"
									># backlog/ → ready/ → done/ (+ cancelled/)</span
								>
  <span class="text-amber">specs/</span>       <span class="text-bone-muted"
									># proposed/ → ready/ → tasked/ (+ dropped/)</span
								>
  <span class="text-amber">notes/</span>       <span class="text-bone-muted"
									># ideas / observations / findings — capture buckets</span
								>
  <span class="text-amber">protocol/</span>   <span class="text-bone-muted"
									># vendored WORK-CONTRACT.md, ADR-FORMAT.md, templates</span
								>
<span class="text-amber">.dorfl.json</span>   <span class="text-bone-muted"
									># the per-repo acceptance gate (verify / prepare)</span
								></code
							></pre>
					</div>
				</div>
			</div>

			<!-- Layer 3 — Execute (the CLI) + CI -->
			<div
				class="flex gap-5 rounded-2xl border border-border bg-slate-2 p-6 sm:p-8"
			>
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-visor-inset font-mono text-sm font-bold text-amber"
				>
					03
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="mb-2 text-lg font-semibold text-bone">
						Execute (the CLI) &amp; CI
					</h3>
					<p class="mb-4 leading-relaxed text-bone-muted">
						Once the contract is in place, the CLI is the runner that consumes
						it. Use
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>dorfl do</code
						>
						in one repo, or
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>dorfl run</code
						>
						across many. In CI,
						<code
							class="rounded bg-visor-inset px-1.5 py-0.5 font-mono text-sm text-clay-light"
							>dorfl intake</code
						> is the issue → spec/task front door.
					</p>
					<div
						class="rounded-xl border border-border bg-visor-inset p-4 sm:p-5"
					>
						<pre class="overflow-x-auto font-mono text-sm leading-relaxed"><code
								><span class="text-bone-muted"># install the runner</span>
<span class="text-amber">npm install -g dorfl</span>

<span class="text-bone-muted"
									># register a repo and let Dorfl pick a ready task</span
								>
<span class="text-amber">dorfl remote add &lt;url&gt;</span>
<span class="text-amber">dorfl do</span>            <span
									class="text-bone-muted"># one repo, in place</span
								>
<span class="text-amber">dorfl run</span>           <span
									class="text-bone-muted"
									># across every registered repo, in parallel</span
								>

<span class="text-bone-muted"># CI: turn an issue into a spec or task</span>
<span class="text-amber">dorfl intake</span></code
							></pre>
					</div>
				</div>
			</div>
		</div>

		<p class="mt-8 text-center text-sm text-bone-muted">
			Full docs and the <code
				class="rounded bg-slate-2 px-1.5 py-0.5 font-mono text-clay-light"
				>work/</code
			>
			contract live in the
			<a
				href={repoUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="text-clay-light underline-offset-2 hover:underline">repository</a
			>.
		</p>
	</div>
</section>

<!-- Footer -->
<footer class="border-t border-border px-4 py-10 sm:px-6">
	<div
		class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-bone-muted sm:flex-row"
	>
		<div class="flex items-center gap-2">
			<img src="{base}/icon.svg" alt="" class="h-6 w-6" />
			<span>Dorfl. It Claims Its Own Work.</span>
		</div>
		<a
			href={repoUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="flex items-center gap-2 transition-colors hover:text-bone"
		>
			<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"
				><path
					d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
				/></svg
			>
			GitHub
		</a>
	</div>
</footer>
