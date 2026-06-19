<script lang="ts">
	// The Dorfl lockup, rebuilt as live markup (mirrors
	// branding/dorfl-v9b-lockup.svg): the vector head next to the "dorfl" serif
	// wordmark and the mono "It Claims Its Own Work" tagline. Wordmark + tagline
	// are real, selectable, responsive text rather than baked-in SVG glyphs.
	import DorflHead from './DorflHead.svelte';
</script>

<div class="flex items-center justify-center gap-5 sm:gap-7">
	<DorflHead class="h-28 w-auto shrink-0 sm:h-36 md:h-44" />
	<div class="text-left">
		<div
			class="font-serif text-6xl leading-none font-bold tracking-[0.06em] text-bone sm:text-7xl md:text-8xl"
		>
			dorfl
		</div>
		<div
			class="mt-2 font-mono text-sm tracking-wide text-clay-light sm:mt-3 sm:text-base md:text-lg"
		>
			It Claims Its Own Work
		</div>
	</div>
</div>
