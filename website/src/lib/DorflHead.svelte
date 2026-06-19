<script lang="ts">
	// The canonical Dorfl v9b head: square + jaw, amber visor with `>_` eyes and
	// a deadpan mouth, on a bit of chest. Geometry is a faithful transcription of
	// branding/dorfl-v9b-lockup.svg (the head group), kept as live vector so the
	// amber visor glow stays crisp at any size. Do not let the numbers drift.
	interface Props {
		class?: string;
	}
	let {class: className = ''}: Props = $props();
</script>

<svg
	viewBox="0 0 252 300"
	class={className}
	role="img"
	aria-label="Dorfl"
	xmlns="http://www.w3.org/2000/svg"
>
	<defs>
		<filter id="dorfl-visor-glow" x="-50%" y="-50%" width="200%" height="200%">
			<feGaussianBlur stdDeviation="3.5" result="b" />
			<feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge
			>
		</filter>
		<clipPath id="dorfl-band"
			><rect x="0" y="0" width="252" height="300" /></clipPath
		>
	</defs>

	<g clip-path="url(#dorfl-band)">
		<!-- shoulders + chest, behind the head, rising to tuck under the jaw -->
		<rect x="-12" y="248" width="264" height="210" rx="40" fill="#A4543C" />
		<path
			d="M120 248 H212 Q252 248 252 288 V458 H120 Z"
			fill="#8A4632"
			opacity="0.42"
		/>
		<line
			x1="-12"
			y1="318"
			x2="252"
			y2="318"
			stroke="#7E3D2C"
			stroke-width="5"
			opacity="0.45"
		/>

		<!-- square head with jaw -->
		<rect x="10" y="8" width="220" height="208" rx="30" fill="#A4543C" />
		<path
			d="M120 8 H200 Q230 8 230 38 V186 Q230 216 200 216 H120 Z"
			fill="#8A4632"
			opacity="0.42"
		/>
		<!-- jaw (non-negotiable: the "creature" cue) -->
		<rect x="74" y="210" width="92" height="26" rx="10" fill="#A4543C" />
		<path d="M120 210 H166 V236 H120 Z" fill="#8A4632" opacity="0.42" />

		<!-- face: recessed visor band with amber inset -->
		<rect x="46" y="64" width="148" height="72" rx="15" fill="#1C1813" />
		<rect
			x="54"
			y="72"
			width="132"
			height="56"
			rx="11"
			fill="#FFB23E"
			filter="url(#dorfl-visor-glow)"
		/>
		<!-- `>` eye -->
		<path
			d="M82 86 l21 14 l-21 14"
			fill="none"
			stroke="#1C1813"
			stroke-width="13"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<!-- `_` eye (cursor) -->
		<rect x="126" y="110" width="34" height="11" rx="5.5" fill="#1C1813" />
		<!-- deadpan mouth -->
		<rect x="91" y="172" width="58" height="10" rx="5" fill="#7E3D2C" />
	</g>
</svg>
