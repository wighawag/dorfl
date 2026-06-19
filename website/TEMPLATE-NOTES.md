# Template notes — Dorfl site

This site is an instantiation of the house template
`~/dev/github/wighawag/template-svelte-tailwind` (SvelteKit + Svelte 5 +
Tailwind v4 via `@tailwindcss/vite`, `adapter-static`). Per `website/AGENTS.md`,
**every deviation from the template is logged here**, tagged as either
**Dorfl-specific** (stays here) or a **backport candidate** (a general
improvement the human may want to fold back into the template). We do NOT edit
the template ourselves; we just record faithfully.

Reference leaner instantiation consulted while building this:
`~/dev/github/wighawag/pi-remote/site`.

## Structural shape (already blessed, NOT a deviation)

The site lives flat directly under `website/` (`src/`, `static/`,
`svelte.config.js` at this folder's root), not under `website/web/`. The
template's `web/` wrapper exists to turn a standalone repo into a monorepo;
`agent-runner` is already a pnpm monorepo, so `website/` is just another
workspace member. `website/AGENTS.md` explicitly says this is expected, so it is
not recorded as drift.

## Deviations from the template

### D1. Started from the leaner `pi-remote/site` baseline, not the full template `web/`

- **What:** The template `web/` ships a PWA stack: service worker, push
  notifications, version/install notifications, a `web-config.json` + `Head.svelte`
  meta component, a `core/` utils tree, and PWA icons under `static/pwa/`. A
  marketing landing page needs none of that. We took the trimmed `pi-remote/site`
  shape (no service worker, no notifications, no `core/` tree) and trimmed it
  further (we did not even need `core/config.ts` / the `url()` path helper, since a
  single static page can use `$app/paths`'s `base` directly).
- **Why:** A one-page static landing site should not carry PWA/service-worker
  machinery. Keep the surface minimal.
- **Tag:** Mostly **Dorfl-specific** (this is a content site, not an app). BUT see
  backport candidate B1: the template arguably wants a documented "landing/marketing"
  lean profile so people don't have to rediscover the trim each time.

### D2. No `core/` utils, no `web-config.json`, no `Head.svelte`

- **What:** SEO/OG/social meta is written inline in `src/app.html` plus a single
  `<svelte:head><title></svelte:head>` in `+page.svelte`, instead of the template's
  data-driven `Head.svelte` + `web-config.json`.
- **Why:** One page, static content. A whole config-driven head component is
  overkill; inline is clearer and has fewer moving parts to keep in sync.
- **Tag:** **Dorfl-specific.** (For a multi-route app the template's `Head.svelte`
  is the right call.)

### D3. Asset paths via `$app/paths`'s `base`, not the `url()` helper

- **What:** Static asset references use `{base}/asset.svg` (importing `base` from
  `$app/paths`) instead of importing the template's `url()` from
  `$lib/core/utils/web/path`.
- **Why:** We dropped the whole `core/` tree (D1/D2), so its `url()` helper isn't
  present. `base` from `$app/paths` is the stock SvelteKit way and is all a static
  page needs.
- **Tag:** **Dorfl-specific** (a consequence of D1).

### D3b. Hero lockup rebuilt as live Svelte, not a baked SVG

- **What:** The hero centerpiece is reimplemented as live markup
  (`src/lib/Lockup.svelte` + `src/lib/DorflHead.svelte`) instead of embedding
  `branding/dorfl-v9b-lockup.svg` as an `<img>`. `DorflHead.svelte` is a faithful
  vector transcription of the head geometry (kept as SVG so the amber visor glow
  stays crisp); the "dorfl" wordmark and "It Claims Its Own Work" tagline are real,
  selectable, responsive HTML text (serif + mono). The full-body `dorfl-v9b-hero.svg`
  art was dropped entirely (not used).
- **Why:** Live text scales/reflows responsively, is selectable and accessible, and
  recolors with the theme, where a flat SVG image does not. The brand head geometry
  is transcribed verbatim, so this consumes the brand spec without redesigning it.
- **Tag:** **Dorfl-specific** (brand content), though the pattern "render the
  wordmark/tagline as live text, keep only the mark as vector" is a reasonable house
  habit worth noting informally.

### D4. Dorfl brand theme in `app.css`

- **What:** `@theme` block uses the documented Dorfl palette (clay / amber /
  slate / bone, from `website/branding/README.md`) instead of the template's /
  reference's blue-purple-cyan brand tokens. We also dropped the template's
  `gradient-text` / `gradient-border` utilities (not on-brand for a deadpan clay
  golem) and added a single `clay-glow` backdrop helper.
- **Why:** This is the Dorfl site; the palette is locked by the brand doc.
- **Tag:** **Dorfl-specific** (brand content).

### D5. Tailwind plugins `@tailwindcss/forms` + `@tailwindcss/typography` dropped

- **What:** `pi-remote/site` (and the template lineage) pull in
  `@tailwindcss/forms` and `@tailwindcss/typography`. This site has no forms and no
  long-form prose, so neither is installed or `@plugin`-ed.
- **Why:** Keep the dependency set and CSS minimal for a single landing page.
- **Tag:** **Dorfl-specific** (add them back the moment a blog/docs/forms appear).

### D6. Brand assets excluded from prettier (`branding` in `.prettierignore`)

- **What:** Added `branding` to `.prettierignore` so `pnpm format` never rewrites
  the committed brand SVGs or `branding/README.md`.
- **Why:** `branding/` is a committed asset suite the site only _consumes_;
  `website/AGENTS.md` says not to redesign it. Without this ignore, `prettier
--write .` reflowed `branding/README.md` (34 lines changed) on the first run.
- **Tag:** **Backport candidate (B2).** Any instantiation with a committed
  `branding/` (or other read-only asset) folder hits the same trap. See below.

### D7. `static/og-image.png` is a custom 1200x630 raster, not from `build.sh`

- **What:** The favicon/icon PNGs and the 1200x630 `og-image.png` are rasterized
  for the web's specific sizes with `magick` directly, rather than consuming
  `branding/build.sh`'s generic `out/<name>.png` / `@512` / `-favicon` outputs.
  `build.sh` was still run (it works) but it does not emit a 1200x630 OG card.
- **Why:** Social cards want exactly 1200x630 on the slate background; `build.sh`
  is a brand-asset renderer, not a web-asset pipeline.
- **Tag:** **Dorfl-specific** for the exact sizes; the underlying gap (no
  documented web-asset/OG rasterization step) is noted as backport candidate B3.

## Root-of-repo change required (outside `website/`)

> `website/AGENTS.md` says "touch only `website/`". This single change is the
> unavoidable exception and is called out here for the reviewer.

### R1. Registered `website` as a workspace member in `pnpm-workspace.yaml`

- **What:** Added `- 'website'` to the repo-root `pnpm-workspace.yaml` (which
  previously listed only `packages/*`).
- **Why:** Without it, pnpm does not treat `website/` as a workspace package, so
  `pnpm install` / `pnpm --filter @agent-runner/website ...` cannot resolve it. The
  AGENTS.md framing itself states `website/` "is just another workspace member", so
  this is the wiring that makes that true. It is the minimal possible root touch
  (one line) and changes nothing about the existing `packages/*` members.
- **Reviewer note:** The root `build`/`dev` scripts stay scoped to `./packages/*`,
  so adding `website` to the workspace does NOT pull the site into the CLI's
  `build`/`dev`. The site has its own `build` / `check` / `format` / `format:check`
  scripts.

### R2. Wired the website's format gate into the root `format` / `format:check`

- **What:** The root `format` / `format:check` scripts now run
  `prettier --write/--check .` AND then delegate into the website
  (`&& pnpm --filter @agent-runner/website format[:check]`). Also added `website/`
  to the **root** `.prettierignore`.
- **Why:** The root prettier config has no plugins, but `website/.prettierrc`
  declares `prettier-plugin-svelte` / `-tailwindcss`. When root `prettier --check .`
  descended into `website/` it picked up that config and crashed with
  "Cannot find package 'prettier-plugin-svelte'". Ignoring `website/` at root alone
  would leave the site UNCHECKED by the repo gate, so instead the root gate skips it
  with root-prettier and re-enters it through the website's OWN format script (which
  has the plugins). The site stays covered by `pnpm format:check`, using its own
  config.
- **Reviewer note:** This touches two more root files (`package.json` scripts,
  `.prettierignore`). Self-contained nested workspaces with their own prettier
  plugin set are a general monorepo gotcha (see backport candidate B5).

## Candidate backports to `template-svelte-tailwind`

A short, actionable list for the human (we do not apply these):

- **B1 — A "landing / marketing" lean profile.** The full `web/` PWA stack
  (service worker, push notifications, version/install notifications, `core/` tree)
  is overkill for a static marketing page. Either a documented "strip these for a
  landing page" note, or a second minimal app preset. (`pi-remote/site` already
  re-derived this trim by hand; this is the second time, so it is worth templating.)

- **B2 — Ship `.prettierignore` pre-loaded to skip a committed asset/branding
  folder.** `prettier --write .` happily reflows committed brand `README.md` / asset
  text. Templates that anticipate a `branding/` or `assets/` folder should ignore it
  by default (or document the gotcha). Cost us a revert on first `format`.

- **B3 — A documented web-asset rasterization step (favicon.png + apple-touch +
  1200x630 OG card).** The template has `static/pwa/*` PNGs but no documented,
  repeatable "regenerate favicon/og-image from the source SVG at the right web
  sizes" recipe. A tiny script (or documented `magick` one-liners) for
  `favicon.png` (32), `icon.png` (512 / apple-touch), and `og-image.png`
  (1200x630, on brand bg) would save every instantiation from hand-rolling it.

- **B5 — Document the nested-prettier-plugin gotcha for monorepo instantiations.**
  When a workspace member (like this site) brings its own `prettier-plugin-svelte` /
  `-tailwindcss` but the monorepo root prettier does not, a root `prettier --check .`
  crashes the moment it descends into the member. The fix is twofold: ignore the
  member in the ROOT `.prettierignore` AND delegate the root `format` /
  `format:check` into the member's own format script. The `web/`-wrapped template
  sidesteps this by living one level down; a flat workspace member (the
  monorepo-already case this site is) needs the wiring spelled out. Worth a note in
  the template's monorepo/adoption docs.

- **B4 — Confirm the template's `tsconfig`/`svelte.config`/`vite.config` trio is
  the canonical minimal set.** What we used here (copied from `pi-remote/site`:
  `adapter-static` with `paths.relative=true`, `serviceWorker.register=false`,
  `vite` host `0.0.0.0` + `allowedHosts`) built and type-checked cleanly with zero
  edits. If the template's standalone config differs, reconcile toward this minimal
  flat-app version.
